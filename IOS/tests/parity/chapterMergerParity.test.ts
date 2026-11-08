// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLogicalChapters, type Chapter } from '../../src/core/data/chapterMerger';
import { naturalOrderCompare } from '../../src/core/data/naturalOrderCompare';

interface ChapterMergerFixtureCase {
  name: string;
  input: Chapter[];
  logical: Chapter[];
  physicalToLogical: number[];
  physicalToLogicalOffset: number[];
  logicalToPhysicalOrders?: number[][];
}

interface NaturalOrderFixturePair {
  a: string;
  b: string;
  cmp: -1 | 0 | 1;
}

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../parity/fixtures',
);

describe('chapterMerger parity vs Android fixtures', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDir, 'chapterMerger.generated.json'), 'utf8'),
  ) as { cases: ChapterMergerFixtureCase[] };

  it('has the required cases', () => {
    const names = fixture.cases.map((c) => c.name);
    expect(names).toContain('single-chapter');
    expect(names).toContain('merge-continuation');
    expect(names).toContain('max-4-parts-then-new');
    expect(names).toContain('title-cleanup-xu2');
  });

  for (const c of fixture.cases) {
    it(`case ${c.name}`, () => {
      const result = buildLogicalChapters(c.input);
      expect(result.chapters).toEqual(c.logical);
      expect(result.physicalToLogical).toEqual(c.physicalToLogical);
      expect(result.physicalToLogicalOffset).toEqual(c.physicalToLogicalOffset);
      if (c.logicalToPhysicalOrders) {
        expect(result.logicalToPhysicalOrders).toEqual(c.logicalToPhysicalOrders);
      }
    });
  }
});

describe('naturalOrder parity vs Android fixtures', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDir, 'naturalOrder.generated.json'), 'utf8'),
  ) as { pairs: NaturalOrderFixturePair[] };

  it('has pairs', () => {
    expect(fixture.pairs.length).toBeGreaterThan(0);
  });

  for (const p of fixture.pairs) {
    it(`compare(${JSON.stringify(p.a)}, ${JSON.stringify(p.b)}) === ${p.cmp}`, () => {
      expect(naturalOrderCompare(p.a, p.b)).toBe(p.cmp);
      const reverse = p.cmp === 0 ? 0 : -p.cmp;
      expect(naturalOrderCompare(p.b, p.a)).toBe(reverse);
    });
  }
});
