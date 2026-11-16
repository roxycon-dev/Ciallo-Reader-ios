import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('works', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (a TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('x');
    const rows = db.prepare('SELECT a FROM t').all() as Array<{ a: string }>;
    expect(rows).toEqual([{ a: 'x' }]);
  });
});
