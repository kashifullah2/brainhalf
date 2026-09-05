import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ulid } from 'ulidx';

const projects = new Hono<{ Bindings: Env; Variables: { user: any } }>();

projects.use('*', authMiddleware);

projects.get('/', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const url = new URL(c.req.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;

  const results = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json({ projects: results });
});

projects.post('/', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const body = await c.req.json();

  const project = {
    id: ulid(),
    userId: user.id,
    title: body.title || 'Untitled Game',
    description: body.description || '',
    gameType: body.gameType || '2d',
    engine: body.engine || 'phaser',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [created] = await db.insert(schema.projects).values(project).returning();
  return c.json(created, 201);
});

projects.get('/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));

  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json(project);
});

projects.patch('/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  // Whitelist only safe fields — never allow userId, id, createdAt to be overwritten
  const allowedFields: Record<string, any> = {};
  const whitelist = ['title', 'description', 'gameType', 'engine', 'isPublished', 'isPrivate', 'thumbnailUrl', 'status'] as const;
  for (const key of whitelist) {
    if (key in body) allowedFields[key] = body[key];
  }

  const [updated] = await db
    .update(schema.projects)
    .set({
      ...allowedFields,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)))
    .returning();

  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

projects.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');

  const [deleted] = await db
    .delete(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)))
    .returning();

  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

projects.get('/:id/files', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');

  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const files = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, id));

  return c.json({ files });
});

projects.post('/:id/files', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const [existingFile] = await db.select().from(schema.projectFiles).where(and(eq(schema.projectFiles.projectId, id), eq(schema.projectFiles.filePath, body.filePath)));

  if (existingFile) {
    const [updated] = await db.update(schema.projectFiles).set({ fileContent: body.fileContent, updatedAt: new Date() }).where(eq(schema.projectFiles.id, existingFile.id)).returning();
    return c.json(updated);
  } else {
    const [created] = await db.insert(schema.projectFiles).values({
      id: ulid(),
      projectId: id,
      filePath: body.filePath,
      fileContent: body.fileContent,
      fileType: body.fileType || 'text/plain',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return c.json(created, 201);
  }
});

/** Max checkpoints retained per project (oldest are pruned). */
const MAX_CHECKPOINTS_PER_PROJECT = 20;

interface CheckpointFile {
  filePath: string;
  fileContent: string;
  fileType?: string;
}

// Create a checkpoint (named snapshot of the supplied files).
projects.post('/:id/checkpoints', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ label?: string; files?: CheckpointFile[] }>();

  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) return c.json({ error: 'No files to checkpoint' }, 400);

  const [created] = await db.insert(schema.checkpoints).values({
    id: ulid(),
    projectId: id,
    userId: user.id,
    label: (body.label || 'Checkpoint').slice(0, 200),
    filesJson: JSON.stringify(files),
    fileCount: files.length,
    createdAt: new Date(),
  }).returning();

  // Prune old checkpoints beyond the retention cap.
  const all = await db.select({ id: schema.checkpoints.id })
    .from(schema.checkpoints)
    .where(eq(schema.checkpoints.projectId, id))
    .orderBy(desc(schema.checkpoints.createdAt));
  if (all.length > MAX_CHECKPOINTS_PER_PROJECT) {
    const toDelete = all.slice(MAX_CHECKPOINTS_PER_PROJECT);
    for (const old of toDelete) {
      await db.delete(schema.checkpoints).where(eq(schema.checkpoints.id, old.id));
    }
  }

  return c.json({ id: created.id, label: created.label, fileCount: created.fileCount, createdAt: created.createdAt }, 201);
});

// List checkpoints (metadata only — no file bodies).
projects.get('/:id/checkpoints', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');

  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const rows = await db.select({
    id: schema.checkpoints.id,
    label: schema.checkpoints.label,
    fileCount: schema.checkpoints.fileCount,
    createdAt: schema.checkpoints.createdAt,
  })
    .from(schema.checkpoints)
    .where(eq(schema.checkpoints.projectId, id))
    .orderBy(desc(schema.checkpoints.createdAt));

  return c.json({ checkpoints: rows });
});

// Restore a checkpoint: replaces project_files with the snapshot and returns it.
projects.post('/:id/checkpoints/:checkpointId/restore', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');
  const checkpointId = c.req.param('checkpointId');

  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const [checkpoint] = await db.select().from(schema.checkpoints)
    .where(and(eq(schema.checkpoints.id, checkpointId), eq(schema.checkpoints.projectId, id)));
  if (!checkpoint) return c.json({ error: 'Checkpoint not found' }, 404);

  let files: CheckpointFile[] = [];
  try {
    files = JSON.parse(checkpoint.filesJson) as CheckpointFile[];
  } catch {
    return c.json({ error: 'Corrupt checkpoint data' }, 500);
  }

  // Replace the live file set with the snapshot.
  await db.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, id));
  for (const f of files) {
    await db.insert(schema.projectFiles).values({
      id: ulid(),
      projectId: id,
      filePath: f.filePath,
      fileContent: f.fileContent,
      fileType: f.fileType || 'text/plain',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  await db.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, id));

  return c.json({ files });
});

projects.get('/:id/export', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');
  
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const files = await db.select().from(schema.projectFiles).where(eq(schema.projectFiles.projectId, id));
  
  // A real implementation would use fflate or JSZip to create a zip blob.
  // For now, we return JSON format that clients can zip on frontend.
  return c.json({ project, files, message: "Use frontend library to zip these files" });
});

export default projects;
