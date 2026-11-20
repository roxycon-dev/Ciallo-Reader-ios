/**
 * anilistModelsAndNearbyConnectorParity.test.ts
 *   ├ `source/anilist/AniListModels.kt`（100 行）→ `@core/source/anilist/anilistModels`
 *   └ `transfer/NearbyConnector.kt`（100 行）→ `@core/transfer/nearbyConnector`
 *
 * 两个文件都有实现，缺的都是**读原文的测试**，而 `NearbyConnector` 的端口还是个
 * 「简化玩具版」—— 本轮按原文重写，逐条对照见 E210：
 *
 *   · 两个 `onStage` 文案都是编的（原文只有 L40 一条「正在建立附近网络」）；
 *   · L41-55 的整段协商（读现有组 → 移除 → `pauseDiscovery` → `connect` → 轮询到组出现）不存在；
 *   · `pauseDiscovery` / `removeGroup` / `waitForRemoval` / `readGroup` / `action` / `watch` /
 *     `refresh` / `cancelConnection` 全缺；
 *   · `stop()` 恒 `cancelPending()`，而原文只有 `disconnect = true` 才碰系统连接。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListMediaTitlesKt,
  AniListTitleType,
  MAX_VARIANTS,
  SearchVariantBuilder,
  buildSearchVariants,
  toTitleRows,
  type AniListMediaTitles,
} from '@core/source/anilist/anilistModels';
import { normalize } from '@core/data/titleNormalizer';
import { query as keywordQuery } from '@core/source/keyword/keywordModels';
import {
  ConflatedSignal,
  NEARBY_ERROR_CLEANUP_FAILED,
  NEARBY_ERROR_CONNECT_FAILED,
  NEARBY_ERROR_READ_FAILED,
  NEARBY_ERROR_STALE_GROUP,
  NEARBY_ERROR_TIMEOUT,
  NEARBY_NEGOTIATION_MS,
  NEARBY_POLL_MS,
  NEARBY_READ_GROUP_TIMEOUT_MS,
  NEARBY_STAGE_NEGOTIATING,
  NEARBY_WAIT_REMOVAL_TIMEOUT_MS,
  NearbyConnector,
  nearbyGroupContainsMember,
  type NearbyConnectorOptions,
  type NearbyGroup,
  type NearbyPlatform,
} from '@core/transfer/nearbyConnector';

import { androidReference } from '../helpers/androidReference';
import { readFileSync } from 'node:fs';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const ANILIST_KT = 'source/anilist/AniListModels.kt';
const NEARBY_KT = 'transfer/NearbyConnector.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① AniListModels.kt L13-27 实体与四个标题类型
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AniListModels.kt L13-27 AniListTitleRow / AniListTitleType', () => {
  const src = kt(ANILIST_KT);

  it('L13-19 五个字段，`titleType` 注释列出四个取值', () => {
    expect(src).toContain('data class AniListTitleRow(');
    expect(src).toContain('val mediaId: Int,');
    expect(src).toContain('val titleType: String,      // ROMAJI / ENGLISH / NATIVE / SYNONYM');
    expect(src).toContain('val rawTitle: String,');
    expect(src).toContain('val normalizedTitle: String,');
    expect(src).toContain('val compactTitle: String,');
  });

  it('L22-27 四个常量逐字', () => {
    expect(src).toContain('object AniListTitleType {');
    expect(src).toContain('const val ROMAJI = "ROMAJI"');
    expect(src).toContain('const val ENGLISH = "ENGLISH"');
    expect(src).toContain('const val NATIVE = "NATIVE"');
    expect(src).toContain('const val SYNONYM = "SYNONYM"');
    expect(AniListTitleType).toEqual({
      ROMAJI: 'ROMAJI',
      ENGLISH: 'ENGLISH',
      NATIVE: 'NATIVE',
      SYNONYM: 'SYNONYM',
    });
  });

  it('L29-33 `AniListSyncPage(media, hasMore)` 两个字段', () => {
    expect(src).toContain('data class AniListSyncPage(');
    expect(src).toContain('val media: List<AniListMediaTitles>,');
    expect(src).toContain('val hasMore: Boolean,');
  });

  it('L36-41 `AniListMediaTitles` 的五个字段（四个可空 + synonyms 列表）', () => {
    expect(src).toContain('data class AniListMediaTitles(');
    expect(src).toContain('val mediaId: Int,');
    expect(src).toContain('val romaji: String?,');
    expect(src).toContain('val english: String?,');
    expect(src).toContain('val native: String?,');
    expect(src).toContain('val synonyms: List<String>,');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② AniListModels.kt L44-64 toRows
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AniListModels.kt L44-64 AniListMediaTitles.toRows()', () => {
  const src = kt(ANILIST_KT);
  const media = (patch: Partial<AniListMediaTitles> = {}): AniListMediaTitles => ({
    mediaId: 7,
    romaji: null,
    english: null,
    native: null,
    synonyms: [],
    ...patch,
  });

  it('L47 `if (raw.isNullOrBlank()) return` —— null / 空串 / 纯空白都跳过', () => {
    expect(src).toContain('if (raw.isNullOrBlank()) return');
    expect(toTitleRows(media())).toEqual([]);
    expect(toTitleRows(media({ romaji: '' }))).toEqual([]);
    expect(toTitleRows(media({ romaji: '   ' }))).toEqual([]);
    expect(toTitleRows(media({ english: '\t\n' }))).toEqual([]);
  });

  it('L52 `rawTitle = raw.trim()` 但 L53-54 的归一化吃**原始值**', () => {
    expect(src).toContain('rawTitle = raw.trim(),');
    expect(src).toContain('normalizedTitle = TitleNormalizer.normalize(raw),');
    expect(src).toContain('compactTitle = TitleNormalizer.compact(raw),');
    // 内部双空格：rawTitle 保留，normalize 折叠成单空格
    const [row] = toTitleRows(media({ romaji: '  Spice   and  Wolf  ' }));
    expect(row?.rawTitle).toBe('Spice   and  Wolf');
    expect(row?.normalizedTitle).toBe('spice and wolf');
    expect(row?.compactTitle).toBe('spiceandwolf');
  });

  it('L49-51 每行的 mediaId / titleType 来自入参与展开的常量', () => {
    expect(src).toContain('mediaId = mediaId,');
    expect(src).toContain('titleType = type,');
    const rows = toTitleRows(media({ mediaId: 42, romaji: 'Romaji', english: 'English', native: '原作' }));
    expect(rows.map((r) => r.mediaId)).toEqual([42, 42, 42]);
    expect(rows.map((r) => r.titleType)).toEqual(['ROMAJI', 'ENGLISH', 'NATIVE']);
  });

  it('L58-61 展开顺序：ROMAJI → ENGLISH → NATIVE → synonyms', () => {
    expect(src).toContain('add(AniListTitleType.ROMAJI, romaji)');
    expect(src).toContain('add(AniListTitleType.ENGLISH, english)');
    expect(src).toContain('add(AniListTitleType.NATIVE, native)');
    expect(src).toContain('synonyms.forEach { add(AniListTitleType.SYNONYM, it) }');
    const rows = toTitleRows(
      media({ romaji: 'A1', english: 'B1', native: 'N1', synonyms: ['S1', 'S2'] }),
    );
    expect(rows.map((r) => `${r.titleType}:${r.rawTitle}`)).toEqual([
      'ROMAJI:A1',
      'ENGLISH:B1',
      'NATIVE:N1',
      'SYNONYM:S1',
      'SYNONYM:S2',
    ]);
  });

  it('L62-63 `filter { it.normalizedTitle.isNotEmpty() }` —— 归一化后为空的行没有匹配价值', () => {
    expect(src).toContain('return rows.filter { it.normalizedTitle.isNotEmpty() }');
    // `''` 已被 isNullOrBlank 拦掉；这里要的是「非空白但归一化成空」的情况 →
    // 纯标点在 normalize 后变成空格再被 filter 掉
    const rows = toTitleRows(media({ romaji: '!!!', english: 'Real Title' }));
    expect(rows.map((r) => r.rawTitle)).toEqual(['Real Title']);
    expect(rows.every((r) => r.normalizedTitle !== '')).toBe(true);
    // 断言用的「非空但归一化为空」样本本身
    expect('!!!'.trim()).not.toBe('');
    expect(normalize('!!!')).toBe('');
  });

  it('`AniListMediaTitlesKt.toRows` 是同一个函数（调用点等价）', () => {
    expect(AniListMediaTitlesKt.toRows).toBe(toTitleRows);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ AniListModels.kt L72-99 SearchVariantBuilder
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AniListModels.kt L73-99 SearchVariantBuilder.build', () => {
  const src = kt(ANILIST_KT);

  it('L76 `MAX_VARIANTS = 6`，且 L74-75 的注释说明是「5 → 6」', () => {
    expect(src).toContain('const val MAX_VARIANTS = 6');
    expect(src).toContain('// 第十一轮第 6 条：5 → 6——原始词 + 原名/英文/罗马音 + 1 个同义标题，');
    expect(MAX_VARIANTS).toBe(6);
    expect(SearchVariantBuilder.MAX_VARIANTS).toBe(6);
  });

  it('L87 `if (out.size >= MAX_VARIANTS) return` 在**最前面**（连原始词也受上限约束）', () => {
    expect(src).toContain('if (out.size >= MAX_VARIANTS) return');
    // 上限 6：第 7 个有效候选被丢
    const many = Array.from({ length: 10 }, (_, i) => `候选词${String(i)}`);
    expect(buildSearchVariants('原始词', many)).toHaveLength(6);
    expect(buildSearchVariants('原始词', many)[0]).toBe('原始词');
  });

  it('L88-89 `trim()` 后为空则跳过', () => {
    expect(src).toContain('val trimmed = candidate.trim()');
    expect(src).toContain('if (trimmed.isEmpty()) return');
    expect(buildSearchVariants('  ', [])).toEqual([]);
    expect(buildSearchVariants(' 词 ', ['  ', '另一个词'])).toEqual(['词', '另一个词']);
  });

  it('L90 `if (!original && !TitleNormalizer.usableVariant(trimmed)) return` —— 原始词**不**受长度限制', () => {
    expect(src).toContain('if (!original && !TitleNormalizer.usableVariant(trimmed)) return');
    // 单字原始词保留（usableVariant 要求归一化后 ≥ 2）
    expect(buildSearchVariants('狼', [])).toEqual(['狼']);
    // 单字候选被丢
    expect(buildSearchVariants('狼', ['羊'])).toEqual(['狼']);
    // 两字候选保留
    expect(buildSearchVariants('狼', ['羊与'])).toEqual(['狼', '羊与']);
  });

  it('L91-92 去重键是 `KeywordKeys.query(...)` —— 归一化级，不是字符串级', () => {
    expect(src).toContain('val key = com.example.source.keyword.KeywordKeys.query(trimmed)');
    expect(src).toContain('if (key.isEmpty() || !seen.add(key)) return');
    // 大小写 / 空白 / 标点差异都算同一个 key
    expect(keywordQuery('Spice and Wolf')).toBe(keywordQuery('  spice AND wolf  '));
    expect(buildSearchVariants('Spice and Wolf', ['spice AND wolf', 'Spice and Wolf'])).toEqual([
      'Spice and Wolf',
    ]);
  });

  it('L95-97 原始词先 offer（恒在首位），命中的标题按给的顺序追加', () => {
    expect(src).toContain('offer(originalKeyword, original = true)');
    expect(src).toContain('matchedRawTitles.forEach { offer(it) }');
    expect(buildSearchVariants(' original ', ['First', 'Second'])).toEqual([
      'original',
      'First',
      'Second',
    ]);
  });

  it('`SearchVariantBuilder.build` 与 `buildSearchVariants` 是同一个函数', () => {
    expect(SearchVariantBuilder.build).toBe(buildSearchVariants);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ NearbyConnector.kt L9-27 类型与常量
   ══════════════════════════════════════════════════════════════════════════════ */

describe('NearbyConnector.kt L9-27 类型与默认窗口', () => {
  const src = kt(NEARBY_KT);

  it('L9 `NearbyGroup(owner, host, localAddress, members: Set<String>)`', () => {
    expect(src).toContain('internal data class NearbyGroup(val owner:Boolean,val host:String,val localAddress:String?,val members:Set<String>)');
  });

  it('L12-18 `NearbyPlatform` 的五个方法', () => {
    expect(src).toContain('fun group(callback:(NearbyGroup?)->Unit)');
    expect(src).toContain('fun pauseDiscovery(callback:()->Unit)');
    expect(src).toContain('fun connect(address:String,callback:(String?)->Unit)');
    expect(src).toContain('fun removeGroup(callback:(String?)->Unit)');
    expect(src).toContain('fun cancelPending()');
  });

  it('L23 `pollMillis = 750` / `negotiationMillis = 35_000`', () => {
    expect(src).toContain('private val pollMillis:Long=750,private val negotiationMillis:Long=35_000)');
    expect(NEARBY_POLL_MS).toBe(750);
    expect(NEARBY_NEGOTIATION_MS).toBe(35_000);
  });

  it('L87 / L85 两个 `withTimeoutOrNull` 窗口：1_500 / 5_000', () => {
    expect(src).toContain('private suspend fun readGroup():NearbyGroup?=withTimeoutOrNull(1_500)');
    expect(src).toContain('check(withTimeoutOrNull(5_000)');
    expect(NEARBY_READ_GROUP_TIMEOUT_MS).toBe(1_500);
    expect(NEARBY_WAIT_REMOVAL_TIMEOUT_MS).toBe(5_000);
  });

  it('L40 / L30 / L59 / L61 / L81 / L85 六条文案逐字', () => {
    expect(src).toContain('onStage(tr("正在建立附近网络"))');
    expect(src).toContain('onError(e.message?:com.example.i18n.tr("附近连接状态读取失败"))');
    expect(src).toContain('onError(com.example.i18n.tr("附近网络未建立，系统连接请求已超时。可重新连接"))');
    expect(src).toContain('onError(e.message?:com.example.i18n.tr("附近连接未能建立"))');
    expect(src).toContain('onError(e.message?:com.example.i18n.tr("附近网络清理失败"))');
    expect(src).toContain('tr("旧的附近网络尚未断开，请稍后重新连接")');
    expect(NEARBY_STAGE_NEGOTIATING).toBe('正在建立附近网络');
    expect(NEARBY_ERROR_READ_FAILED).toBe('附近连接状态读取失败');
    expect(NEARBY_ERROR_TIMEOUT).toBe('附近网络未建立，系统连接请求已超时。可重新连接');
    expect(NEARBY_ERROR_CONNECT_FAILED).toBe('附近连接未能建立');
    expect(NEARBY_ERROR_CLEANUP_FAILED).toBe('附近网络清理失败');
    expect(NEARBY_ERROR_STALE_GROUP).toBe('旧的附近网络尚未断开，请稍后重新连接');
  });

  it('L43 `members.any { it.equals(address, true) }` —— 大小写不敏感', () => {
    expect(src).toContain('existing.members.any {it.equals(address,true)}');
    const group: NearbyGroup = { owner: false, host: 'h', localAddress: null, members: new Set(['AA-BB-CC']) };
    expect(nearbyGroupContainsMember(group, 'aa-bb-cc')).toBe(true);
    expect(nearbyGroupContainsMember(group, 'AA-BB-CC')).toBe(true);
    expect(nearbyGroupContainsMember(group, 'aa-bb-cd')).toBe(false);
    expect(nearbyGroupContainsMember({ ...group, members: new Set() }, 'aa-bb-cc')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ NearbyConnector.kt L28-99 状态机（fake timers）
   ══════════════════════════════════════════════════════════════════════════════ */

interface Harness {
  readonly platform: NearbyPlatform;
  readonly calls: string[];
  readonly stages: string[];
  readonly errors: string[];
  readonly groups: NearbyGroup[];
  /** 平台 `group()` 的返回值（`null` = 没有组）。 */
  current: NearbyGroup | null;
  /** `group()` 是否永不回调（模拟平台挂死）。 */
  muteGroup: boolean;
  connectError: string | null;
  removeError: string | null;
  /** `removeGroup` 后是否真的把组清掉。 */
  removeClearsGroup: boolean;
}

function harness(): Harness {
  const calls: string[] = [];
  const stages: string[] = [];
  const errors: string[] = [];
  const groups: NearbyGroup[] = [];
  const state: Harness = {
    calls,
    stages,
    errors,
    groups,
    current: null,
    muteGroup: false,
    connectError: null,
    removeError: null,
    removeClearsGroup: true,
    platform: {
      group(callback) {
        calls.push('group');
        if (state.muteGroup) return;
        callback(state.current);
      },
      pauseDiscovery(callback) {
        calls.push('pauseDiscovery');
        callback();
      },
      connect(address, callback) {
        calls.push(`connect:${address}`);
        if (state.connectError === null && state.current === null && state.groups.length > 0) {
          state.current = state.groups.shift() ?? null;
        }
        callback(state.connectError);
      },
      removeGroup(callback) {
        calls.push('removeGroup');
        if (state.removeClearsGroup) state.current = null;
        callback(state.removeError);
      },
      cancelPending() {
        calls.push('cancelPending');
      },
    },
  };
  return state;
}

const group = (host: string, members: string[] = []): NearbyGroup => ({
  owner: false,
  host,
  localAddress: null,
  members: new Set(members),
});

/** 让 microtask 全部跑完（fake timers 下 `advanceTimersByTimeAsync(0)` 会 flush）。 */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function connector(h: Harness, patch: Partial<NearbyConnectorOptions> = {}) {
  return new NearbyConnector({
    platform: h.platform,
    onGroup: (g) => h.groups.push(g),
    onStage: (s) => h.stages.push(s),
    onError: (e) => h.errors.push(e),
    pollMillis: 10,
    negotiationMillis: 100,
    readGroupTimeoutMillis: 5,
    waitRemovalTimeoutMillis: 40,
    ...patch,
  });
}

describe('NearbyConnector.kt L28-32 observe / refresh', () => {
  const src = kt(NEARBY_KT);

  it('L29 `if(job?.isActive==true)return` —— 已在跑就不再起第二个循环', async () => {
    expect(src).toContain('if(job?.isActive==true)return');
    const h = harness();
    const c = connector(h);
    c.observe();
    await flush();
    const first = h.calls.length;
    c.observe();
    await flush();
    // 第二次 observe 没有新增 group 调用（除第一轮已排的）
    expect(h.calls.length).toBe(first);
  });

  it('L93-98 `watch()` 在 group 为 null 时**什么都不做**（旧端口多了一次 onStage）', async () => {
    expect(src).toContain('readGroup()?.let(onGroup)');
    expect(src).not.toContain('等待同网设备');
    const h = harness();
    const c = connector(h);
    c.observe();
    await flush();
    expect(h.groups).toEqual([]);
    expect(h.stages).toEqual([]);
    // 组出现 → onGroup（之后进入 `watch()`，每轮轮询都会再报一次，原文如此）
    h.current = group('h1', ['a']);
    await vi.advanceTimersByTimeAsync(30);
    expect(h.groups[0]?.host).toBe('h1');
  });

  it('L32 `refresh()` 立即唤醒正在 `pause()` 的循环（CONFLATED）', async () => {
    expect(src).toContain('fun refresh() {wake.trySend(Unit)}');
    const h = harness();
    const c = connector(h, { pollMillis: 10_000 });
    c.observe();
    await flush();
    const before = h.calls.filter((x) => x === 'group').length;
    c.refresh();
    await flush();
    // 不用等 10 秒就多了一轮
    expect(h.calls.filter((x) => x === 'group').length).toBe(before + 1);
  });

  it('`ConflatedSignal` 的容量是 1：连发两次只唤醒一次', async () => {
    const signal = new ConflatedSignal();
    signal.trySend();
    signal.trySend();
    expect(signal.isSignalled).toBe(true);
    await signal.receive();
    expect(signal.isSignalled).toBe(false);
    await expect(Promise.race([signal.receive(), Promise.resolve('idle')])).resolves.toBe('idle');
  });
});

describe('NearbyConnector.kt L33-64 connect 的整段协商', () => {
  const src = kt(NEARBY_KT);

  it('L40 stage 文案是「正在建立附近网络」（不是「正在协商直连」）', async () => {
    expect(src).toContain('onStage(tr("正在建立附近网络"))');
    const h = harness();
    h.groups.push(group('h1', ['aa']));
    const c = connector(h);
    c.connect('aa');
    await flush();
    expect(h.stages).toEqual(['正在建立附近网络']);
    expect(h.stages).not.toContain('正在协商直连');
  });

  it('L47-48 顺序是 `pauseDiscovery` → `connect`，之后才轮询到组', async () => {
    const h = harness();
    h.groups.push(group('h1', ['aa']));
    const c = connector(h);
    c.connect('aa');
    await flush();
    const pauseAt = h.calls.indexOf('pauseDiscovery');
    const connectAt = h.calls.indexOf('connect:aa');
    expect(pauseAt).toBeGreaterThan(-1);
    expect(connectAt).toBeGreaterThan(pauseAt);
    // 协商成功后进入 `watch()`，每轮都会再 onGroup —— 只钉第一条
    expect(h.groups[0]?.host).toBe('h1');
  });

  it('L43-44 已经建成同一组 → 直接 onGroup，**不**移除、**不** pauseDiscovery、**不** connect', async () => {
    expect(src).toContain('val existing=readGroup()');
    const h = harness();
    h.current = group('same', ['AA']);
    const c = connector(h);
    c.connect('aa');
    await flush();
    expect(h.groups[0]?.host).toBe('same');
    expect(h.calls).not.toContain('removeGroup');
    expect(h.calls).not.toContain('pauseDiscovery');
    expect(h.calls.some((x) => x.startsWith('connect:'))).toBe(false);
  });

  it('L46 已有**别的**组 → 先 `removeGroup` + `waitForRemoval()` 再往下走', async () => {
    expect(src).toContain('if(existing!=null){action {platform.removeGroup(it)};waitForRemoval()}');
    const h = harness();
    h.current = group('old', ['zz']);
    h.groups.push(group('new', ['aa']));
    const c = connector(h);
    c.connect('aa');
    await flush();
    const removeAt = h.calls.indexOf('removeGroup');
    const pauseAt = h.calls.indexOf('pauseDiscovery');
    expect(removeAt).toBeGreaterThan(-1);
    expect(pauseAt).toBeGreaterThan(removeAt);
    expect(h.groups[0]?.host).toBe('new');
  });

  it('L84-86 旧组 5 秒内没断开 → 「旧的附近网络尚未断开，请稍后重新连接」', async () => {
    expect(src).toContain('旧的附近网络尚未断开，请稍后重新连接');
    const h = harness();
    h.current = group('old', ['zz']);
    h.removeClearsGroup = false;
    const c = connector(h, { waitRemovalTimeoutMillis: 40 });
    c.connect('aa');
    await vi.advanceTimersByTimeAsync(200);
    expect(h.errors).toContain('旧的附近网络尚未断开，请稍后重新连接');
    // 没继续往下走：没有 pauseDiscovery / connect
    expect(h.calls).not.toContain('pauseDiscovery');
  });

  it('L58-59 协商超时 → `cancelPending()` + 超时文案', async () => {
    expect(src).toContain('platform.cancelPending();onError(com.example.i18n.tr("附近网络未建立，系统连接请求已超时。可重新连接"))');
    const h = harness();
    h.muteGroup = true;
    const c = connector(h, { negotiationMillis: 60, readGroupTimeoutMillis: 5 });
    c.connect('aa');
    await vi.advanceTimersByTimeAsync(200);
    expect(h.errors).toContain('附近网络未建立，系统连接请求已超时。可重新连接');
    expect(h.calls).toContain('cancelPending');
  });

  it('L61 平台报错 → `cancelPending()` + 平台文案（不是「未能建立」的兜底）', async () => {
    expect(src).toContain('catch(e:Exception){platform.cancelPending();onError(e.message?:com.example.i18n.tr("附近连接未能建立"))}');
    const h = harness();
    h.connectError = '系统拒绝了连接请求';
    const c = connector(h);
    c.connect('aa');
    await flush(10);
    expect(h.errors).toContain('系统拒绝了连接请求');
    expect(h.calls).toContain('cancelPending');
  });

  it('L35 已在连接时**不早退**：先 `cancelPending()` 再重新发起', async () => {
    expect(src).toContain('if(connecting)platform.cancelPending()');
    const h = harness();
    h.muteGroup = true;
    const c = connector(h, { negotiationMillis: 10_000 });
    c.connect('aa');
    await flush();
    const connectCalls = h.calls.filter((x) => x.startsWith('connect:')).length;
    c.connect('aa');
    await flush();
    expect(h.calls).toContain('cancelPending');
    expect(h.calls.filter((x) => x.startsWith('connect:')).length).toBe(connectCalls);
  });

  it('L34 `job?.cancel()` —— 重新连接会掐掉上一个观察循环', async () => {
    // 原文 CRLF：跨行处一律 `\r?\n`
    expect(src).toMatch(/job\?\.cancel\(\)\r?\n\s+if\(connecting\)platform\.cancelPending\(\)/);
    const h = harness();
    h.current = group('g', ['aa']);
    const c = connector(h, { pollMillis: 20 });
    c.observe();
    await vi.advanceTimersByTimeAsync(50);
    const before = h.groups.length;
    c.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.groups.length).toBe(before);
  });
});

describe('NearbyConnector.kt L65-83 stop / cancelConnection', () => {
  const src = kt(NEARBY_KT);

  it('L65 `stop(disconnect = false)` 默认**不** cancelPending、**不** removeGroup', async () => {
    expect(src).toContain('fun stop(disconnect:Boolean=false)');
    expect(src).toContain('if(disconnect)platform.cancelPending()');
    expect(src).toContain('if(disconnect)platform.removeGroup {}');
    const h = harness();
    const c = connector(h);
    c.observe();
    await flush();
    c.stop();
    await flush();
    expect(h.calls).not.toContain('cancelPending');
    expect(h.calls).not.toContain('removeGroup');
  });

  it('`stop(true)` 两个都做（`removeGroup {}` 传空回调）', async () => {
    const h = harness();
    const c = connector(h);
    c.observe();
    await flush();
    c.stop(true);
    await flush();
    expect(h.calls).toContain('cancelPending');
    expect(h.calls).toContain('removeGroup');
  });

  it('L67 `epoch++` —— 每次 stop / connect 都推进 epoch', async () => {
    expect(src).toContain('epoch++');
    const h = harness();
    const c = connector(h);
    expect(c.currentEpoch).toBe(0);
    c.stop();
    expect(c.currentEpoch).toBe(1);
    h.muteGroup = true;
    c.connect('aa');
    expect(c.currentEpoch).toBe(2);
  });

  it('L72-83 `cancelConnection()`：stop → cancelPending → removeGroup → 恢复观察', async () => {
    expect(src).toContain('fun cancelConnection() {');
    expect(src).toContain('if(token==epoch)watch()');
    const h = harness();
    h.current = group('old', ['zz']);
    const c = connector(h);
    c.cancelConnection();
    await flush(10);
    const cancelAt = h.calls.indexOf('cancelPending');
    const removeAt = h.calls.indexOf('removeGroup');
    expect(cancelAt).toBeGreaterThan(-1);
    expect(removeAt).toBeGreaterThan(cancelAt);
    const groupAt = h.calls.lastIndexOf('group');
    expect(groupAt).toBeGreaterThan(removeAt);
  });

  it('L81 清理期异常 → 「附近网络清理失败」的兜底文案', async () => {
    expect(src).toContain('catch(e:Exception){onError(e.message?:com.example.i18n.tr("附近网络清理失败"))}');
    // 平台 removeGroup 报错 → action 抛错 → 走兜底分支
    const h = harness();
    h.current = group('old', ['zz']);
    h.removeError = '';
    const c = connector(h);
    c.cancelConnection();
    await flush(10);
    expect(h.errors).toContain('附近网络清理失败');
  });
});
