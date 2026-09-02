// ---------------------------------------------------------------------------
// PATCH / DELETE /api/templates/:templateId
// ---------------------------------------------------------------------------

import { fail, json, readJson, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';
import { enforceRateLimit, userIdentity } from '../../../server/rate-limit';
import { isOcrMode } from '../../../server/ocr-prompts';
import {

  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EXPECTED_FIELDS_LENGTH,
  cleanTemplateStr,
  toDto,
  type TemplateRow,
} from '../../../server/templates';

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
  // Integer, not merely finite: `1.5` passed the old check and then matched no row,
  // so a malformed id surfaced as "not found" instead of "not valid".
  if (!Number.isInteger(templateId) || templateId < 1) {
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
  const name = cleanTemplateStr(body?.name, MAX_NAME_LENGTH) || existing.name;
  const baseMode = cleanTemplateStr(body?.baseMode, 30) || existing.base_mode;
  if (!isOcrMode(baseMode)) {
    return fail(`Invalid base mode "${baseMode}".`, 400);
  }

  const prompt = body?.prompt !== undefined
    ? (cleanTemplateStr(body.prompt, MAX_PROMPT_LENGTH) || null)
    : existing.prompt;
  const description = body?.description !== undefined
    ? (cleanTemplateStr(body.description, MAX_DESCRIPTION_LENGTH) || null)
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
  // Integer, not merely finite: `1.5` passed the old check and then matched no row,
  // so a malformed id surfaced as "not found" instead of "not valid".
  if (!Number.isInteger(templateId) || templateId < 1) {
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
  // Integer, not merely finite: `1.5` passed the old check and then matched no row,
  // so a malformed id surfaced as "not found" instead of "not valid".
  if (!Number.isInteger(templateId) || templateId < 1) {
    return fail('Invalid template ID.', 400);
  }

  // Incrementing use_count is cheap, but an unbounded POST is a write amplification
  // vector. Cap it like other lightweight mutations.
  const limited = await enforceRateLimit(
    env,
    `templates/${templateId}/use`,
    userIdentity(auth.user.id),
    { limit: 60, windowSeconds: 60 },
  );
  if (limited) return limited;

  await env.DB.prepare(
    `UPDATE extraction_templates
        SET use_count = use_count + 1, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
  )
    .bind(templateId, auth.user.id)
    .run();

  return json({ ok: true }, 200, authHeaders(auth));
};
