import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIDENCE_THRESHOLD } from './threshold';

describe('DEFAULT_CONFIDENCE_THRESHOLD', () => {
  it('matches the schema default in migrations/0002_batches.sql', () => {
    const migrationPath = path.resolve(__dirname, '../migrations/0002_batches.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Look for `confidence_threshold REAL NOT NULL DEFAULT X.XX`
    const match = sql.match(/confidence_threshold\s+REAL\s+NOT\s+NULL\s+DEFAULT\s+([\d.]+)/i);
    expect(match).not.toBeNull();
    
    const schemaDefault = parseFloat(match![1]);
    expect(schemaDefault).toBe(DEFAULT_CONFIDENCE_THRESHOLD);
  });
});
