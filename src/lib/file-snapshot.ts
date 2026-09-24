export type SnapshotFiles = Record<string, string>;

export interface FileSnapshotPage {
  type: 'files_snapshot';
  protocol: 2;
  requestId: string;
  revision: number;
  files: SnapshotFiles;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
}

export interface FileSnapshotRequest {
  type: 'get_files';
  requestId: string;
  offset: number;
  revision?: number;
}

export const MAX_SNAPSHOT_TOTAL_BYTES = 64 * 1024 * 1024;

export class FileSnapshotAssembler {
  private active: {
    requestId: string;
    baseline: SnapshotFiles;
    files: SnapshotFiles;
    offset: number;
    revision?: number;
    bytes: number;
  } | null = null;

  begin(files: SnapshotFiles): FileSnapshotRequest {
    const requestId = crypto.randomUUID();
    this.active = { requestId, baseline: { ...files }, files: Object.create(null), offset: 0, bytes: 0 };
    return { type: 'get_files', requestId, offset: 0 };
  }

  matches(requestId: unknown): boolean {
    return this.active !== null && this.active.requestId === requestId;
  }

  cancel(): void {
    this.active = null;
  }

  accept(page: FileSnapshotPage, current: SnapshotFiles): { files?: SnapshotFiles; request?: FileSnapshotRequest } {
    const active = this.active;
    if (!active || page.requestId !== active.requestId) return {};
    if (page.protocol !== 2 || !Number.isSafeInteger(page.revision) || page.revision < 0 ||
      (active.revision !== undefined && page.revision !== active.revision) ||
      page.offset !== active.offset || !Number.isSafeInteger(page.nextOffset) ||
      page.nextOffset < page.offset || (page.hasMore && page.nextOffset <= page.offset) ||
      typeof page.hasMore !== 'boolean' || !page.files || typeof page.files !== 'object' || Array.isArray(page.files) ||
      Object.values(page.files).some(value => typeof value !== 'string')) {
      this.cancel();
      throw new Error('Invalid or inconsistent workspace snapshot; existing files were preserved.');
    }
    active.bytes += new TextEncoder().encode(JSON.stringify(page.files)).length;
    if (active.bytes > MAX_SNAPSHOT_TOTAL_BYTES) {
      this.cancel();
      throw new Error('Workspace snapshot exceeds the safe transfer size; existing files were preserved.');
    }
    Object.assign(active.files, page.files);
    active.revision = page.revision;
    active.offset = page.nextOffset;
    if (page.hasMore) {
      return { request: { type: 'get_files', requestId: active.requestId, offset: active.offset, revision: active.revision } };
    }
    const files: SnapshotFiles = { ...active.files };
    for (const path of new Set([...Object.keys(active.baseline), ...Object.keys(current)])) {
      if (current[path] !== active.baseline[path]) {
        if (Object.prototype.hasOwnProperty.call(current, path)) files[path] = current[path];
        else delete files[path];
      }
    }
    this.cancel();
    return { files };
  }
}
