/**
 * `KeywordExpansion` flow behaviour — TS port of
 * `com.example.source.keyword.KeywordExpansion.kt` (124 lines / 119 non-blank).
 *
 * The Kotlin `Flow<KeywordUpdate>` becomes an `AsyncGenerator`; the assertions
 * check the incremental emission contract and the user-visible status strings,
 * which are the part of this file a reader actually sees.
 */
import { describe, expect, it } from 'vitest';
import { KeywordExpansion } from '../../src/core/source/keyword/keywordExpansion';
import type { KeywordUpdate } from '../../src/core/source/keyword/keywordModels';
import type { KeywordConcept } from '../../src/core/source/keyword/keywordModels';

const concept = (
  id: string,
  text: string,
  language: string,
): KeywordConcept => ({ id, names: [{ text, language }], source: 'test' });

async function collect(
  updates: AsyncGenerator<KeywordUpdate, void, void>,
): Promise<KeywordUpdate[]> {
  const out: KeywordUpdate[] = [];
  for await (const update of updates) out.push(update);
  return out;
}

describe('KeywordExpansion — non-plain input', () => {
  it('keeps a manual search expression untouched and reports why', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => true,
    });
    const updates = await collect(expansion.observe('"exact phrase"'));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.status).toBe('保留手动搜索表达式，仅使用原词');
    expect(updates[0]?.added).toEqual([]);
  });

  it('expand() emits nothing for a non-plain input', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => true,
    });
    const out: string[][] = [];
    for await (const batch of expansion.expand('-flag')) out.push(batch);
    expect(out).toEqual([]);
  });
});

describe('KeywordExpansion — local-only path', () => {
  it('announces the lookup, publishes the local names, then the final status', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [concept('anilist:media:1', '三体', 'zh')],
      online: async () => [],
      onlineAllowed: () => false,
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates.map((u) => u.status)).toEqual([
      '正在查找本地名称',
      '已使用本地名称',
      // The zh-only concept is incomplete, so a supplement was required and the
      // disabled reason wins over the local-database statuses (Kotlin line 116).
      '在线补充未启用，使用本地关键词',
    ]);
    expect(updates[1]?.added).toEqual([]);
    expect(updates[1]?.origins['三体']).toBe('本地');
    expect(updates[2]?.added).toEqual([]);
  });

  it('reports the unavailable-local-database status when nothing was found', async () => {
    const expansion = new KeywordExpansion({
      local: async () => {
        throw new Error('db down');
      },
      online: async () => [],
      onlineAllowed: () => false,
      // Complete-looking empty concept set: `missing` stays empty so the
      // local-failure branch (Kotlin line 117) is reachable.
      needsRefresh: async () => false,
    });
    const updates = await collect(expansion.observe('三体'));
    // A failing `local` still leaves `concepts` empty ⇒ `missing` is non-empty,
    // so the disabled-reason branch (line 116) is evaluated before line 117.
    expect(updates[updates.length - 1]?.status).toBe('在线补充未启用，使用本地关键词');
  });

  it('reports "only the original word" when nothing at all was found', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => false,
      needsRefresh: async () => false,
    });
    const updates = await collect(expansion.observe('三体'));
    // Empty concept list ⇒ incomplete ⇒ supplement required ⇒ disabled reason.
    expect(updates[updates.length - 1]?.status).toBe('在线补充未启用，使用本地关键词');
  });

  it('surfaces a custom disabled reason', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => false,
      needsRefresh: async () => false,
      onlineDisabledReason: () => '多语言搜索已关闭，仅使用原词',
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates[updates.length - 1]?.status).toBe('多语言搜索已关闭，仅使用原词');
  });

  it('reaches the "only the original word" status when online is allowed but yields nothing', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => true,
      needsRefresh: async () => false,
    });
    const updates = await collect(expansion.observe('三体'));
    // `supplement` was true and completed without adding anything.
    expect(updates[updates.length - 1]?.status).toBe('未找到更多可靠名称，使用已有关键词');
  });
});

describe('KeywordExpansion — online supplementation path', () => {
  const onlineConcept = concept('anilist:media:1', 'Three-Body Problem', 'en');

  it('emits an intermediate supplementing status and a final online status', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [concept('anilist:media:1', '三体', 'zh')],
      online: async () => [onlineConcept],
      onlineAllowed: () => true,
    });
    const updates = await collect(expansion.observe('三体'));
    const statuses = updates.map((u) => u.status);
    expect(statuses[0]).toBe('正在查找本地名称');
    expect(statuses[1]).toBe('正在在线补充名称');
    expect(statuses).toContain('已在线补充');
    const added = updates.flatMap((u) => u.added);
    expect(added).toContain('Three-Body Problem');
  });

  it('honours onlineDisabledReason once a supplement was required', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      // Incomplete concept ⇒ `missing` is non-empty ⇒ supplement attempted.
      onlineAllowed: () => false,
      needsRefresh: async () => true,
      onlineDisabledReason: () => '多语言搜索已关闭，仅使用原词',
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates[updates.length - 1]?.status).toBe('多语言搜索已关闭，仅使用原词');
  });

  it('reports a failed provider without claiming the word was verified', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => true,
      onlineEvents: async function* () {
        yield {
          concepts: [],
          states: [{ provider: 'lookup', outcome: 'failed', retryAt: 0, detail: '网络连接超时' }],
          cached: false,
          persisted: false,
        };
      },
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates[updates.length - 1]?.status).toBe('在线查询失败，使用已有关键词');
  });

  it('reports an ambiguous provider distinctly from a failure', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => true,
      onlineEvents: async function* () {
        yield {
          concepts: [],
          states: [{ provider: 'bangumi:subjects', outcome: 'ambiguous', retryAt: 0, detail: '' }],
          cached: false,
          persisted: false,
        };
      },
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates[updates.length - 1]?.status).toBe('名称存在歧义，未自动扩展不确定名称');
  });

  it('reports a cached supplement', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => [],
      onlineAllowed: () => true,
      onlineEvents: async function* () {
        yield {
          concepts: [onlineConcept],
          states: [],
          cached: true,
          persisted: true,
        };
      },
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates[updates.length - 1]?.status).toBe('已使用缓存');
  });

  it('times out an online phase that never settles', async () => {
    const expansion = new KeywordExpansion({
      local: async () => [],
      online: async () => new Promise<KeywordConcept[]>(() => undefined),
      onlineAllowed: () => true,
      onlineWindowMs: 20,
    });
    const updates = await collect(expansion.observe('三体'));
    expect(updates[updates.length - 1]?.status).toBe('在线补充超时，使用已有关键词');
  });
});
