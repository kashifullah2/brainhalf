// ---------------------------------------------------------------------------
// CRUD for extraction templates.
//
// GET    /api/templates         → list all templates for the user
// POST   /api/templates         → create a new template
// PATCH  /api/templates/:id     → update an existing template
// DELETE /api/templates/:id     → delete a template
//
// Templates live alongside the built-in presets (invoice, receipt, etc.) and
// appear as "Saved Templates" in the upload flow.
// ---------------------------------------------------------------------------

import { fail, json, readJson, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';

const MAX_TEMPLATES = 50;
const MAX_NAME_LENGTH = 100;
const MAX_PROMPT_LENGTH = 4000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_EXPECTED_FIELDS_LENGTH = 1000;

const ALLOWED_MODES = new Set([
  'invoice', 'receipt', 'fulltext', 'keyvalue', 'table',
  'handwriting', 'multilingual', 'custom', 'vqa',
]);

interface TemplateRow {
  id: number;
  user_id: string;
  name: string;
  base_mode: string;
  prompt: string | null;
  description: string | null;
  expected_fields: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

interface TemplateDto {
  id: number;
  name: string;
  baseMode: string;
  prompt: string | null;
  description: string | null;
  expectedFields: string[];
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    name: row.name,
    baseMode: row.base_mode,
    prompt: row.prompt,
    description: row.description,
    expectedFields: row.expected_fields
      ? row.expected_fields.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    useCount: row.use_count,
    createdAt: `${row.created_at.replace(' ', 'T')}Z`,
    updatedAt: `${row.updated_at.replace(' ', 'T')}Z`,
  };
}

function cleanStr(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// ---------------------------------------------------------------------------
// GET /api/templates — list all user templates
// ---------------------------------------------------------------------------
export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT * FROM extraction_templates WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
  )
    .bind(auth.user.id)
    .all<TemplateRow>();

  return json((results ?? []).map(toDto), 200, authHeaders(auth));
};

// ---------------------------------------------------------------------------
// POST /api/templates — create a new template
// ---------------------------------------------------------------------------
interface CreateBody {
  name?: unknown;
  baseMode?: unknown;
  prompt?: unknown;
  description?: unknown;
  expectedFields?: unknown;
}

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJson<CreateBody>(request);
  const name = cleanStr(body?.name, MAX_NAME_LENGTH);
  if (!name) return fail('Template name is required.', 400);

  const baseMode = cleanStr(body?.baseMode, 30) || 'custom';
  if (!ALLOWED_MODES.has(baseMode)) {
    return fail(`Invalid base mode "${baseMode}".`, 400);
  }

  const prompt = cleanStr(body?.prompt, MAX_PROMPT_LENGTH) || null;
  const description = cleanStr(body?.description, MAX_DESCRIPTION_LENGTH) || null;

  let expectedFieldsStr: string | null = null;
  if (Array.isArray(body?.expectedFields)) {
    expectedFieldsStr = (body.expectedFields as unknown[])
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map((f) => f.trim())
      .join(',')
      .slice(0, MAX_EXPECTED_FIELDS_LENGTH) || null;
  }

  // Enforce per-user cap.
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM extraction_templates WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ count: number }>();

  if ((count?.count ?? 0) >= MAX_TEMPLATES) {
    return fail(`You can have at most ${MAX_TEMPLATES} saved templates.`, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO extraction_templates (user_id, name, base_mode, prompt, description, expected_fields)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(auth.user.id, name, baseMode, prompt, description, expectedFieldsStr)
    .run();

  const id = Number(result.meta.last_row_id);

  const row = await env.DB.prepare(
    `SELECT * FROM extraction_templates WHERE id = ? AND user_id = ?`,
  )
    .bind(id, auth.user.id)
    .first<TemplateRow>();

  if (!row) return fail('Failed to create template.', 500);

  return json(toDto(row), 201, authHeaders(auth));
};

// ---------------------------------------------------------------------------
// PATCH /api/templates — route dispatcher (Cloudflare Pages requires separate
// files for dynamic segments; we handle :id via query param for simplicity)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DELETE /api/templates — same approach
// ---------------------------------------------------------------------------
