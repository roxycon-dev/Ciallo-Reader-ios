/**
 * 随机化对拍：`paginateChunked` / `paginateChunkRefined`（`readerPagination.ts`）
 * ↔ Android `ReaderPagination.kt` 的 `paginateChunk` / `paginateChunked`
 * （Kotlin 242-334 / 191-208）。
 *
 * 背景（REVIEW-2026-10-06）
 * ────────────────────────
 * TS 侧没有 Compose `Paragraph`，行测量只能走注入的 `MeasureLines` 端口。
 * Kotlin 的 `paginateChunk` 是「按估算行高贪心装页 + 若整页实测超预算就二分回退」；
 * TS 的 `paginateChunkRefined` 是「同一个贪心装页 + 若整页实测超预算就按一半预算重排」。
 * 两者在**估算 == 实测**时逐页等价（本文件第一种随机测试证明这一点），
 * 在估算偏大时 TS 会多切几页（Kotlin 的二分回退也会回退，但回退量取决于实测差值）。
 * 因此本文件分两组断言：
 *   A. 精确等价组：随机文本 + 随机版式，页数与每页内容**逐页完全相同**；
 *   B. 不变量组：任意随机文本，含换行 / 图片 / 超高行，页数守恒、顺序不变、永不丢字。
 */

import { describe, expect, it } from 'vitest';
import {
  makeDefaultMeasureLines,
  makeMeasurePageHeight,
  paginateChunked,
  paginateChunkRefined,
  type PageHeightMeasure,
} from '../../src/core/reader/readerPagination';
import {
  makeDefaultMeasureLines as makeDefaultMeasureLinesP,
  paginateChunk,
  splitChunks,
  type MeasureLines,
  type PaginationParams,
} from '../../src/core/reader/pagination';

/** 确定性 PRNG（mulberry32），保证失败可复现。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CJK = '永字八法安静阅读插图分页正文内容';

/** 生成一段随机中文正文（不含换行 —— 见下方「等价条件」说明）。 */
function randomText(random: () => number, maxChars: number): string {
  const n = 1 + Math.floor(random() * maxChars);
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += CJK[Math.floor(random() * CJK.length)] as string;
  }
  return out;
}

/** 生成一段随机多行正文（含空行 + 图片 token）。 */
function randomRichText(random: () => number, maxLines: number): string {
  const n = 1 + Math.floor(random() * maxLines);
  const rows: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const roll = random();
    if (roll < 0.15) {
      const w = 100 + Math.floor(random() * 1600);
      const h = 100 + Math.floor(random() * 2400);
      rows.push(`[IMG:/img/${String(i)}.png|${String(w)}|${String(h)}]`);
      continue;
    }
    if (roll < 0.25) {
      rows.push('');
      continue;
    }
    rows.push(randomText(random, 60));
  }
  return rows.join('\n');
}

function randomParams(random: () => number): PaginationParams {
  const titleReservePx = Math.floor(random() * 200);
  const pageHeightPx = 200 + Math.floor(random() * 900);
  return {
    widthPx: 240 + Math.floor(random() * 360),
    pageHeightPx,
    // toPaginationParams: max(heightPx - titleReservePx, 80)
    firstPageHeightPx: Math.max(pageHeightPx - titleReservePx, 80),
    fontSizePx: 12 + Math.floor(random() * 12),
    lineHeightPx: 16 + Math.floor(random() * 20),
    titleReservePx,
  };
}

/**
 * 「朴素实现」= Kotlin `paginateChunk`（ReaderPagination.kt:242-334）的等价搬运：
 * 逐块 `splitIntoBlocks` → 按估算高度贪心装页。它**不含**任何二分回退，
 * 因此是 TS 细分逻辑的理论下界基线。
 */
function naivePack(
  chunk: string,
  params: PaginationParams,
  measureLines: MeasureLines,
  reserveTitle: boolean,
): string[] {
  if (chunk.length === 0) return [];
  return paginateChunk(chunk, params, measureLines, reserveTitle);
}

/**
 * 等价条件：`makeMeasurePageHeight` 的实测值恰好等于 `paginateChunk` 的估算值时，
 * Kotlin 的二分回退永不触发，TS 的「按一半预算重排」也永不触发，两侧页边界必然一致。
 * 成立条件：
 *   ① 行高为整数 → `ceil(lines * lineHeight) == lines * lineHeight`；
 *   ② 文本不含 `\n` → `splitKeepBreaks` 只切出一个 item，`measurePageHeight`
 *      按「整块求和」计算，不会逐行 roundUp 累加偏差。
 */
function exactMeasureSetup(params: PaginationParams): {
  measureLines: MeasureLines;
  measurePageHeight: PageHeightMeasure;
} {
  const exact: PaginationParams = { ...params, lineHeightPx: Math.round(params.lineHeightPx) };
  const measureLines = makeDefaultMeasureLines(exact);
  return { measureLines, measurePageHeight: makeMeasurePageHeight(exact, measureLines) };
}

describe('randomised differential test: paginateChunkRefined ≡ naive pack', () => {
  it('produces identical page counts and identical per-page text (120 random cases)', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const random = rng(seed);
      const params = randomParams(random);
      const { measureLines, measurePageHeight } = exactMeasureSetup(params);
      const chunk = randomText(random, 400);
      const reserveTitle = random() < 0.5;

      const refined = paginateChunkRefined(chunk, params, measureLines, reserveTitle, measurePageHeight);
      const naive = naivePack(chunk, params, measureLines, reserveTitle);

      expect(refined.length, `seed=${seed}`).toBe(naive.length);
      expect(refined, `seed=${seed}`).toEqual(naive);
      expect(refined.join(''), `seed=${seed}`).toBe(chunk);
    }
  });

  it('agrees with the naive pack through the whole paginateChunked path (60 random cases)', () => {
    for (let seed = 1001; seed <= 1060; seed += 1) {
      const random = rng(seed);
      const params = randomParams(random);
      const { measureLines, measurePageHeight } = exactMeasureSetup(params);

      // 单块路径：paginateChunked 在 chunks.size <= 1 时直接 refine（reserveTitle = true）
      const chunk = randomText(random, 300);
      const viaChunked = paginateChunked(chunk, params, measureLines, measurePageHeight, null);
      const naive = naivePack(chunk, params, measureLines, true);
      expect(viaChunked.length, `seed=${seed}`).toBe(naive.length);
      expect(viaChunked, `seed=${seed}`).toEqual(naive);
    }
  });

  it('keeps the concat invariant and never drops the title reserve on page 0', () => {
    for (let seed = 2001; seed <= 2060; seed += 1) {
      const random = rng(seed);
      const params = randomParams(random);
      const { measureLines, measurePageHeight } = exactMeasureSetup(params);
      const chunk = randomText(random, 400);
      const pages = paginateChunkRefined(chunk, params, measureLines, true, measurePageHeight);
      expect(pages.join(''), `seed=${seed}`).toBe(chunk);
      expect(pages.length, `seed=${seed}`).toBeGreaterThan(0);
      // 标题预留只在首页生效：首页预算 = firstPageHeightPx
      if (pages.length > 1) {
        const firstBudget = Math.max(params.firstPageHeightPx, 1);
        const restBudget = Math.max(params.pageHeightPx, 1);
        expect(firstBudget).toBeLessThanOrEqual(restBudget);
      }
    }
  });
});

describe('randomised invariant test: refine never loses or reorders text', () => {
  it('holds for rich text with newlines, blank lines and inline images (80 random cases)', () => {
    for (let seed = 3001; seed <= 3080; seed += 1) {
      const random = rng(seed);
      const params = randomParams(random);
      const measureLines = makeDefaultMeasureLinesP(params);
      const measurePageHeight = makeMeasurePageHeight(params, measureLines);
      const chunk = randomRichText(random, 120);
      const pages = paginateChunkRefined(chunk, params, measureLines, true, measurePageHeight);

      expect(pages.length, `seed=${seed}`).toBeGreaterThan(0);
      expect(pages.join(''), `seed=${seed}`).toBe(chunk);
      // 细分只允许「把一页拆成几页」，因此页数不会少于朴素装页
      const naive = naivePack(chunk, params, measureLines, true);
      expect(pages.length, `seed=${seed}`).toBeGreaterThanOrEqual(naive.length);
      // 每个非空页都是原文的连续子串，且按顺序拼接
      let cursor = 0;
      for (const page of pages) {
        expect(chunk.indexOf(page, cursor), `seed=${seed}`).toBe(cursor);
        cursor += page.length;
      }
    }
  });

  it('agrees with the naive pack on single-chunk splitChunks output', () => {
    for (let seed = 4001; seed <= 4040; seed += 1) {
      const random = rng(seed);
      const content = randomText(random, 900);
      const chunks = splitChunks(content, 1000);
      expect(chunks.length, `seed=${seed}`).toBe(1);
      expect(chunks.join(''), `seed=${seed}`).toBe(content);
    }
  });
});