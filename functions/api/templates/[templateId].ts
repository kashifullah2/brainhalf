// ---------------------------------------------------------------------------
// PATCH / DELETE /api/templates/:templateId
// ---------------------------------------------------------------------------

import { fail, json, readJson, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';

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
// PATCH /api/templates/:templateId — update a template
// ---------------------------------------------------------------------------

interface UpdateBody {
  name?: unknown;
  baseMode?: unknown;
  prompt?: unknown;
  description?: unknown;
  expectedFields?: unknown;
}

export const onRequestPatch: PagesFunction<AppEnv> = async ({ params, request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const templateId = Number(params.templateId);
  if (!Number.isFinite(templateId) || templateId < 1) {
    return fail('Invalid template ID.', 400);
  }

  // Ownership check.
  const existing = await env.DB.prepare(
    `SELECT * FROM extraction_templates WHERE id = ? AND user_id = ?`,
  )
    .bind(templateId, auth.user.id)
    .first<TemplateRow>();

  if (!existing) return fail('Template not found.', 404);

  const body = await readJson<UpdateBody>(request);
  const name = cleanStr(body?.name, MAX_NAME_LENGTH) || existing.name;
  const baseMode = cleanStr(body?.baseMode, 30) || existing.base_mode;
  if (!ALLOWED_MODES.has(baseMode)) {
    return fail(`Invalid base mode "${baseMode}".`, 400);
  }

  const prompt = body?.prompt !== undefined
    ? (cleanStr(body.prompt, MAX_PROMPT_LENGTH) || null)
    : existing.prompt;
  const description = body?.description !== undefined
    ? (cleanStr(body.description, MAX_DESCRIPTION_LENGTH) || null)
    : existing.description;

  let expectedFieldsStr = existing.expected_fields;
  if (Array.isArray(body?.expectedFields)) {
    expectedFieldsStr = (body.expectedFields as unknown[])
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map((f) => f.trim())
      .join(',')
      .slice(0, MAX_EXPECTED_FIELDS_LENGTH) || null;
  }

  await env.DB.prepare(
    `UPDATE extraction_templates
        SET name = ?, base_mode = ?, prompt = ?, description = ?,
            expected_fields = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
  )
    .bind(name, baseMode, prompt, description, expectedFieldsStr, templateId, auth.user.id)
    .run();

  const updated = await env.DB.prepare(
    `SELECT * FROM extraction_templates WHERE id = ? AND user_id = ?`,
  )
    .bind(templateId, auth.user.id)
    .first<TemplateRow>();

  if (!updated) return fail('Template not found after update.', 500);
  return json(toDto(updated), 200, authHeaders(auth));
};

// ---------------------------------------------------------------------------
// DELETE /api/templates/:templateId — delete a template
// ---------------------------------------------------------------------------

export const onRequestDelete: PagesFunction<AppEnv> = async ({ params, request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const templateId = Number(params.templateId);
  if (!Number.isFinite(templateId) || templateId < 1) {
    return fail('Invalid template ID.', 400);
  }

  const result = await env.DB.prepare(
    `DELETE FROM extraction_templates WHERE id = ? AND user_id = ?`,
  )
    .bind(templateId, auth.user.id)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return fail('Template not found.', 404);
  }

  return json({ deleted: true }, 200, authHeaders(auth));
};

// ---------------------------------------------------------------------------
// POST /api/templates/:templateId — increment use_count
// ---------------------------------------------------------------------------

export const onRequestPost: PagesFunction<AppEnv> = async ({ params, request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const templateId = Number(params.templateId);
  if (!Number.isFinite(templateId) || templateId < 1) {
    return fail('Invalid template ID.', 400);
  }

  await env.DB.prepare(
    `UPDATE extraction_templates
        SET use_count = use_count + 1, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
  )
    .bind(templateId, auth.user.id)
    .run();

  return json({ ok: true }, 200, authHeaders(auth));
};
