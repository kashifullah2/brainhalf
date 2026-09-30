import { PILOT_LIMITS, RuntimeError, type ProjectEnvironment, type ProjectUpload } from './types';
import { requireAdmission, type PilotAdmission } from './pilot';

type UploadRow = {
  id: string; environment: ProjectEnvironment; user_id: string; name: string;
  content_type: string; size: number; created: number; state: string;
};
interface StorageQuota {
  reserveStorage(id: string, bytes: number): Promise<PilotAdmission>;
  releaseStorage(id: string): Promise<void>;
}

export class ProjectUploads {
  constructor(private storage: DurableObjectStorage, private bucket: R2Bucket, private quota: StorageQuota, private alias: string, private projectId: string) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, environment TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL, state TEXT NOT NULL)");
    storage.sql.exec('CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(environment,user_id,created)');
  }
  private key(row: UploadRow) { return `${this.alias}/uploads/${row.environment}/${row.id}`; }
  /** Quota-ledger id. Unlike the R2 key it must not contain the alias: a slug
   *  rename changes the alias, and the delete-time release has to find the
   *  exact reservation id that was recorded at upload time. */
  private quotaId(row: UploadRow) { return `upload:${this.projectId}:${row.environment}/${row.id}`; }
  private publicRow(row: UploadRow): ProjectUpload {
    return { id: row.id, name: row.name, contentType: row.content_type, size: row.size, createdAt: row.created, url: `/api/storage/${row.id}` };
  }
  private async writable() {
    if (await this.storage.get<boolean>('deleted')) throw new RuntimeError('Project was deleted.', 410);
  }
  private async remove(row: UploadRow) {
    this.storage.sql.exec("UPDATE uploads SET state='deleting' WHERE id=?", row.id);
    await this.bucket.delete(this.key(row));
    await this.quota.releaseStorage(this.quotaId(row));
    // Best-effort release for reservations recorded under the old alias-based
    // scheme before the stable quota id existed. Unknown ids are a no-op.
    await this.quota.releaseStorage(this.key(row)).catch(() => {});
    this.storage.sql.exec('DELETE FROM uploads WHERE id=?', row.id);
  }
  async removeAll() {
    for (const row of this.storage.sql.exec<UploadRow>('SELECT * FROM uploads').toArray()) await this.remove(row);
  }
  async removeForUsers(userIds: string[]) {
    for (const user of userIds) {
      for (const row of this.storage.sql.exec<UploadRow>('SELECT * FROM uploads WHERE user_id=?', user).toArray()) await this.remove(row);
    }
  }
  private async recover() {
    const rows = this.storage.sql.exec<UploadRow>("SELECT * FROM uploads WHERE state='deleting' OR (state='pending' AND created<?) LIMIT 20", Date.now() - 900_000).toArray();
    for (const row of rows) {
      if (row.state === 'deleting') { await this.remove(row); continue; }
      const object = await this.bucket.head(this.key(row));
      if (object && object.size === row.size) this.storage.sql.exec("UPDATE uploads SET state='ready' WHERE id=? AND state='pending'", row.id);
      else await this.remove(row);
    }
  }
  async handle(request: Request, environment: ProjectEnvironment, userId: string | null, admin = false): Promise<Response> {
    if (!userId && !admin) throw new RuntimeError('Sign in to access files.', 401);
    await this.writable();
    const url = new URL(request.url);
    const base = admin ? '/uploads' : '/api/storage';
    if (url.pathname === base && request.method === 'GET') {
      await this.recover();
      const rows = admin
        ? this.storage.sql.exec<UploadRow>("SELECT * FROM uploads WHERE environment=? AND state='ready' ORDER BY created DESC LIMIT 100", environment).toArray()
        : this.storage.sql.exec<UploadRow>("SELECT * FROM uploads WHERE environment=? AND user_id=? AND state='ready' ORDER BY created DESC LIMIT 100", environment, userId!).toArray();
      return Response.json({ files: rows.map(row => this.publicRow(row)), maxFileBytes: PILOT_LIMITS.uploadBytes, maxFiles: PILOT_LIMITS.uploadFiles });
    }
    if (!admin && url.pathname === base && request.method === 'POST') return this.upload(request, environment, userId!);
    const id = url.pathname.slice(base.length + 1);
    if (!url.pathname.startsWith(`${base}/`) || !/^[a-f0-9-]{36}$/.test(id)) throw new RuntimeError('File not found.', 404);
    const row = this.storage.sql.exec<UploadRow>('SELECT * FROM uploads WHERE id=? AND environment=?', id, environment).toArray()[0];
    if (!row || (!admin && row.user_id !== userId)) throw new RuntimeError('File not found.', 404);
    if (request.method === 'DELETE') { await this.remove(row); return Response.json({ ok: true }); }
    if (!['GET', 'HEAD'].includes(request.method)) throw new RuntimeError('Method not allowed.', 405);
    if (row.state !== 'ready') throw new RuntimeError('The file is still being stored or removed. Retry shortly.', 409);
    const object = await this.bucket.get(this.key(row));
    if (!object) throw new RuntimeError('File contents are unavailable.', 404);
    const inline = /^image\/(png|jpeg|gif|webp)$/.test(row.content_type);
    const headers = new Headers({
      'Content-Type': row.content_type, 'Content-Length': String(object.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    if (request.method === 'HEAD') { await object.body.cancel(); return new Response(null, { headers }); }
    return new Response(object.body, { headers });
  }
  private async upload(request: Request, environment: ProjectEnvironment, userId: string) {
    let name: string;
    try { name = decodeURIComponent(request.headers.get('x-file-name') || 'upload'); } catch { throw new RuntimeError('Invalid file name.'); }
    // eslint-disable-next-line no-control-regex -- Reject control bytes in user-supplied filenames.
    if (!name.trim() || name.length > 160 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new RuntimeError('Use a file name of 1–160 characters without path separators.');
    const contentType = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType) || contentType.length > 100) throw new RuntimeError('Invalid file type.');
    if (Number(request.headers.get('content-length') || 0) > PILOT_LIMITS.uploadBytes) throw new RuntimeError('Each file must be 5 MB or smaller.', 413);
    const reader = request.body?.getReader();
    if (!reader) throw new RuntimeError('Choose a file to upload.');
    const chunks: Uint8Array[] = []; let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30_000);
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > PILOT_LIMITS.uploadBytes) { await reader.cancel(); throw new RuntimeError('Each file must be 5 MB or smaller.', 413); }
        chunks.push(part.value);
      }
      if (timedOut) throw new RuntimeError('Upload timed out. Try the file again.', 408);
    } finally { clearTimeout(timer); reader.releaseLock(); }
    if (!size) throw new RuntimeError('Empty files cannot be uploaded.');
    await this.writable();
    const count = this.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM uploads WHERE environment=?', environment).toArray()[0].count;
    if (count >= PILOT_LIMITS.uploadFiles) throw new RuntimeError('This project environment has reached its file limit.', 429);
    const row: UploadRow = { id: crypto.randomUUID(), environment, user_id: userId, name: name.trim(), content_type: contentType, size, created: Date.now(), state: 'pending' };
    // Persist intent before any external write. Pending files count against the limit.
    this.storage.sql.exec('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?)', row.id, row.environment, row.user_id, row.name, row.content_type, row.size, row.created, row.state);
    try {
      requireAdmission(await this.quota.reserveStorage(this.quotaId(row), size));
      await this.writable();
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const stored = await this.bucket.put(this.key(row), bytes, { httpMetadata: { contentType } });
      if (!stored) throw new RuntimeError('File storage did not complete. Try again.', 502);
      await this.writable();
      this.storage.sql.exec("UPDATE uploads SET state='ready' WHERE id=?", row.id);
      return Response.json({ file: this.publicRow(row) }, { status: 201 });
    } catch (error) {
      try { await this.remove(row); } catch { /* Persisted intent lets the next list/delete retry cleanup. */ }
      throw error;
    }
  }
}
