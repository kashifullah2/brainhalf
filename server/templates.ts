/**
 * Shared extraction-template types and helpers.
 *
 * The template handlers were duplicated between
 * functions/api/templates/index.ts and functions/api/templates/[templateId].ts.
 * Moving the common model here keeps the two routes in sync.
 */

export const MAX_TEMPLATES = 50;
export const MAX_NAME_LENGTH = 100;
export const MAX_PROMPT_LENGTH = 4000;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_EXPECTED_FIELDS_LENGTH = 1000;

export const ALLOWED_MODES = new Set([
  'invoice', 'receipt', 'fulltext', 'keyvalue', 'table',
  'handwriting', 'multilingual', 'custom', 'vqa',
]);

export interface TemplateRow {
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

export interface TemplateDto {
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

export function toDto(row: TemplateRow): TemplateDto {
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

export function cleanTemplateStr(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
