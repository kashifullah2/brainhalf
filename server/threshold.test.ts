import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIDENCE_THRESHOLD } from './threshold';

describe('DEFAULT_CONFIDENCE_THRESHOLD', () => {
  it('matches the schema default in migrations/0002_batches.sql', () => {
    const migrationPath = path.resolve(
      import.meta.dirname,
      '../migrations/0002_batches.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    // Look for `confidence_threshold REAL NOT NULL DEFAULT X.XX`
    const match = sql.match(
      /confidence_threshold\s+REAL\s+NOT\s+NULL\s+DEFAULT\s+([\d.]+)/i,
    );
    expect(match).not.toBeNull();

    expect(parseFloat(match![1])).toBe(DEFAULT_CONFIDENCE_THRESHOLD);
  });
});
