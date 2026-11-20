/**
 * transferConnectionAndGodSettingsParity.test.ts
 *   ├ `transfer/TransferConnection.kt`（84 行）→ `@core/transfer/transferConnection`
 *   └ `god/GodMomentSettingsStore.kt`（84 行）→ `@core/god/godRankingSettings`
 *
 * `TransferConnection.kt` 在端口里**被另一个东西顶了名**：`nearby.ts` 里那个同名的
 * `class TransferConnection` 是 WebSocket 包装（`send` / `onData` / `close`），
 * 而 Kotlin 是 TCP + TLS 的连接工厂。`grep` 命中、矩阵判 `port`，真正的
 * `connectNearby` / `acceptNearby` / `secure` 与五条中文错误一个都没有（E207）。
 *
 * `GodMomentSettingsStore.kt` 的三个 getter/setter 早就有了，缺的是
 * `exportPortable` / `importPortable`（L27-38）—— 备份归档里那份 `god` 设置。
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONNECT_NEARBY_STEPS,
  NEARBY_BOTH_SENDING_MESSAGE,
  NEARBY_CONNECT_TIMEOUT_MS,
  NEARBY_DEVICE_MISMATCH_MESSAGE,
  NEARBY_HANDSHAKE_TIMEOUT_MS,
  NEARBY_SELF_CONNECTION_MESSAGE,
  NEARBY_SO_TIMEOUT_MS,
  TLS_SESSION_INVALID_MESSAGE,
  TRANSFER_CANCELLED_MESSAGE,
  TRANSFER_CONNECT_TIMEOUT_MS,
  TRANSFER_HANDSHAKE_TIMEOUT_MS,
  TRANSFER_STAGE_CONNECTING,
  TRANSFER_STAGE_SECURING,
  acceptNearbyPlan,
  connectNearbyPlan,
  connectionFailureMessage,
  nearbyRejection,
  secureChecks,
  tlsModeFor,
  tlsSessionInvalid,
} from '@core/transfer/transferConnection';
import {
  GOD_PORTABLE_KEYS,
  exportGodPortableSettings,
  getGodGyroParallaxEnabled,
  getGodHintCapsuleEnabled,
  getGodRankingStyle,
  importGodPortableSettings,
  setGodGyroParallaxEnabled,
  setGodHintCapsuleEnabled,
  setGodRankingStyle,
} from '@core/god/godRankingSettings';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const CONN_KT = 'transfer/TransferConnection.kt';
const GOD_KT = 'god/GodMomentSettingsStore.kt';

afterEach(() => {
  setGodRankingStyle('podium');
  setGodHintCapsuleEnabled(true);
  setGodGyroParallaxEnabled(true);
});

/* ══════════════════════════════════════════════════════════════════════════════
   ① TransferConnection.kt L16-33 connectNearby 的三条拒绝
   ══════════════════════════════════════════════════════════════════════════════ */

describe('TransferConnection.kt L26-28 三条拒绝（异常类型各不相同）', () => {
  const src = kt(CONN_KT);
  const offer = (patch: { id?: string; sending?: boolean; busy?: boolean } = {}) => ({
    id: 'peer',
    name: 'n',
    sending: false,
    busy: false,
    ...patch,
  });

  it('L26 `require(remote.id != local.id)` → 「附近连接指向了本机」', () => {
    expect(src).toContain('require(remote.id!=local.id){tr("附近连接指向了本机")}');
    expect(NEARBY_SELF_CONNECTION_MESSAGE).toBe('附近连接指向了本机');
    const rejection = nearbyRejection(offer({ id: 'a' }), offer({ id: 'a' }), null);
    expect(rejection).toEqual({ kind: 'self', message: '附近连接指向了本机' });
  });

  it('L27 `expectedId != null && remote.id != expectedId` → `SecurityException`', () => {
    expect(src).toContain('if(expectedId!=null && remote.id!=expectedId)throw SecurityException(tr("附近网络中的设备与所选设备不一致"))');
    expect(NEARBY_DEVICE_MISMATCH_MESSAGE).toBe('附近网络中的设备与所选设备不一致');
    expect(nearbyRejection(offer({ id: 'a' }), offer({ id: 'b' }), 'c')).toEqual({
      kind: 'mismatch',
      message: '附近网络中的设备与所选设备不一致',
    });
    // expectedId 为 null 时不校验
    expect(nearbyRejection(offer({ id: 'a' }), offer({ id: 'b' }), null)).toBeNull();
    // 一致时也不拦
    expect(nearbyRejection(offer({ id: 'a' }), offer({ id: 'b' }), 'b')).toBeNull();
  });

  it('L28 `local.sending && remote.sending && !remote.busy` → `IllegalStateException`', () => {
    expect(src).toContain('if(local.sending && remote.sending && !remote.busy)throw IllegalStateException(tr("双方都选择了发送，请让一台设备选择接收"))');
    expect(NEARBY_BOTH_SENDING_MESSAGE).toBe('双方都选择了发送，请让一台设备选择接收');
    expect(nearbyRejection(offer({ id: 'a', sending: true }), offer({ id: 'b', sending: true }), null)).toEqual({
      kind: 'bothSending',
      message: '双方都选择了发送，请让一台设备选择接收',
    });
    // 对端 busy 时放行（它正准备接收）
    expect(
      nearbyRejection(offer({ id: 'a', sending: true }), offer({ id: 'b', sending: true, busy: true }), null),
    ).toBeNull();
    // 只有一方在发也放行
    expect(nearbyRejection(offer({ id: 'a', sending: true }), offer({ id: 'b' }), null)).toBeNull();
  });

  it('顺序：本机 → 设备不符 → 双方都在发（先命中先返回）', () => {
    // 三条同时成立时，报「本机」
    expect(nearbyRejection(offer({ id: 'x', sending: true }), offer({ id: 'x', sending: true }), 'y')?.kind).toBe('self');
  });
});

describe('TransferConnection.kt L29-31 / L41-45 抢锁与 busy 回落', () => {
  const src = kt(CONN_KT);
  const offer = { id: 'p', name: 'n', sending: false, busy: false };

  it('L29 连接侧：`!shouldStart || !claim()` → 关掉并返回 null（不抛）', () => {
    expect(src).toContain('if(!NearbyHandshake.shouldStart(local,remote) || !claim()){raw.close();return null}');
    expect(connectNearbyPlan(true, true).proceed).toBe(true);
    expect(connectNearbyPlan(true, false).proceed).toBe(false);
    expect(connectNearbyPlan(false, true).proceed).toBe(false);
    // 不继续时不 track（否则取消表里留着一个已关闭的 socket）
    expect(connectNearbyPlan(false, false).track).toBe(false);
  });

  it('L41 接受侧：抢锁失败 → **`copy(busy = true)` 写回对端**再放弃', () => {
    expect(src).toContain('if(start && !claim()){local=local.copy(busy=true);start=false}');
    const rejected = acceptNearbyPlan(offer, true, false);
    expect(rejected.start).toBe(false);
    expect(rejected.proceed).toBe(false);
    // 关键：写回去的那份 offer 带 busy
    expect(rejected.local).toEqual({ ...offer, busy: true });
    // `shouldStart` 本来就是假时**不改** busy
    const notStarted = acceptNearbyPlan(offer, false, false);
    expect(notStarted.local).toEqual(offer);
    // 抢到锁时原样写回
    expect(acceptNearbyPlan(offer, true, true).local).toEqual(offer);
  });

  it('两侧 TLS 模式相反：连接侧 client、接受侧 server', () => {
    expect(connectNearbyPlan(true, true).client).toBe(true);
    expect(acceptNearbyPlan(offer, true, true).client).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② TransferConnection.kt L48-63 两个 stage 与 IOException 文案
   ══════════════════════════════════════════════════════════════════════════════ */

describe('TransferConnection.kt L53-62 stage 与失败文案', () => {
  const src = kt(CONN_KT);

  it('L53 / L56 两个 stage 文案逐字（都过 `tr()`）', () => {
    expect(src).toContain('stage(tr("正在连接设备"))');
    expect(src).toContain('stage(tr("正在建立加密连接"))');
    expect(TRANSFER_STAGE_CONNECTING).toBe('正在连接设备');
    expect(TRANSFER_STAGE_SECURING).toBe('正在建立加密连接');
  });

  it('L60 判据是 `raw.isConnected`：连上了但握手挂了 vs 压根没连上', () => {
    expect(src).toContain('if(e is IOException)throw IOException(if(raw.isConnected)"设备已连接，但加密握手失败：${e.message}" else "无法连接设备：${e.message}",e)');
    expect(connectionFailureMessage(true, 'timeout')).toBe('设备已连接，但加密握手失败：timeout');
    expect(connectionFailureMessage(false, 'timeout')).toBe('无法连接设备：timeout');
    // 没有 cause 时不留 `null` 字面量
    expect(connectionFailureMessage(false, null)).toBe('无法连接设备：');
    expect(connectionFailureMessage(false, null)).not.toContain('null');
  });

  it('L49 两个默认超时 4_000 / 8_000', () => {
    expect(src).toContain('connectTimeout:Int=4_000,handshakeTimeout:Int=8_000');
    expect(TRANSFER_CONNECT_TIMEOUT_MS).toBe(4_000);
    expect(TRANSFER_HANDSHAKE_TIMEOUT_MS).toBe(8_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ TransferConnection.kt L22-23 / L31 Nearby 的三个超时
   ══════════════════════════════════════════════════════════════════════════════ */

describe('TransferConnection.kt L22-23 / L31 Nearby 的超时档', () => {
  const src = kt(CONN_KT);

  it('connect 2000 / soTimeout 1500 / handshake 8000 —— 与普通互传的 4000/8000 不同', () => {
    expect(src).toContain('raw.connect(InetSocketAddress(route.host,route.port),2_000)');
    expect(src).toContain('raw.soTimeout=1_500');
    expect(NEARBY_CONNECT_TIMEOUT_MS).toBe(2_000);
    expect(NEARBY_SO_TIMEOUT_MS).toBe(1_500);
    expect(NEARBY_HANDSHAKE_TIMEOUT_MS).toBe(8_000);
    // 2000 ≠ 4000：Nearby 是「附近」，不该等普通互传那么久
    expect(NEARBY_CONNECT_TIMEOUT_MS).not.toBe(TRANSFER_CONNECT_TIMEOUT_MS);
  });

  it('两侧握手超时都是 8000', () => {
    expect(connectNearbyPlan(true, true).handshakeTimeoutMs).toBe(8_000);
    expect(acceptNearbyPlan({ id: 'p', name: 'n', sending: false, busy: false }, true, true).handshakeTimeoutMs).toBe(8_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ TransferConnection.kt L68-83 secure
   ══════════════════════════════════════════════════════════════════════════════ */

describe('TransferConnection.kt L68-83 secure 的四道检查', () => {
  const src = kt(CONN_KT);

  it('L74 `if (!client) tls.needClientAuth = true` —— 服务端必须校验客户端证书', () => {
    expect(src).toContain('if(!client)tls.needClientAuth=true');
    expect(tlsModeFor(true)).toEqual({ useClientMode: true, needClientAuth: false });
    expect(tlsModeFor(false)).toEqual({ useClientMode: false, needClientAuth: true });
  });

  it('L72 / L78 **两处** `isClosed` 检查，都抛「连接已取消」', () => {
    expect((src.match(/if\(tls\.isClosed\)throw java\.net\.SocketException\(tr\("连接已取消"\)\)/g) ?? []).length).toBe(2);
    expect(TRANSFER_CANCELLED_MESSAGE).toBe('连接已取消');
    // 握手前取消
    expect(secureChecks({ closedBeforeHandshake: true, closedAfterHandshake: false, session: { isValid: true, protocol: 'TLSv1.3' } })).toBe('连接已取消');
    // 握手后取消
    expect(secureChecks({ closedBeforeHandshake: false, closedAfterHandshake: true, session: { isValid: true, protocol: 'TLSv1.3' } })).toBe('连接已取消');
  });

  it('L79 `!isValid || protocol == "NONE"` → 「加密握手未完成或已取消」', () => {
    expect(src).toContain('if(!tls.session.isValid || tls.session.protocol=="NONE")');
    expect(TLS_SESSION_INVALID_MESSAGE).toBe('加密握手未完成或已取消');
    expect(tlsSessionInvalid({ isValid: false, protocol: 'TLSv1.3' })).toBe(true);
    expect(tlsSessionInvalid({ isValid: true, protocol: 'NONE' })).toBe(true);
    expect(tlsSessionInvalid({ isValid: true, protocol: 'TLSv1.3' })).toBe(false);
    expect(
      secureChecks({ closedBeforeHandshake: false, closedAfterHandshake: false, session: { isValid: true, protocol: 'NONE' } }),
    ).toBe('加密握手未完成或已取消');
    // 全部通过
    expect(secureChecks({ closedBeforeHandshake: false, closedAfterHandshake: false, session: { isValid: true, protocol: 'TLSv1.2' } })).toBeNull();
  });

  it('L75 `TransferTls.configure(tls)` 与 L76 `soTimeout = timeout` 都在握手前', () => {
    expect(src).toContain('TransferTls.configure(tls)');
    expect(src).toContain('tls.soTimeout=timeout');
    const configureIndex = src.indexOf('TransferTls.configure(tls)');
    const handshakeIndex = src.indexOf('tls.startHandshake()');
    expect(configureIndex).toBeGreaterThan(0);
    expect(configureIndex).toBeLessThan(handshakeIndex);
  });

  it('`connectNearby` 的十个步骤顺序（端口给出常量表供宿主按序执行）', () => {
    expect(CONNECT_NEARBY_STEPS).toEqual([
      'trackProbe',
      'bindLocalAddress',
      'connect',
      'soTimeout',
      'writeLocalOffer',
      'readRemoteOffer',
      'validate',
      'claim',
      'track',
      'secure',
    ]);
    // 源码里 `trackProbe` 在 `bind` 之前、`validate` 在 `claim` 之前
    const probe = src.indexOf('trackProbe(raw)');
    const bind = src.indexOf('route.localAddress?.let');
    const validate = src.indexOf('require(remote.id!=local.id)');
    const claim = src.indexOf('!claim()');
    expect(probe).toBeLessThan(bind);
    expect(validate).toBeLessThan(claim);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ 同名占位：真名已交还
   ══════════════════════════════════════════════════════════════════════════════ */

describe('TransferConnection 的真名已交还（旧端口是 WebSocket 包装）', () => {
  it('`nearby.ts` 里的包装类改名 `NearbySocketChannel`，不再叫 TransferConnection', () => {
    const nearby = repoText('src/core/transfer/nearby.ts');
    expect(nearby).toContain('export class NearbySocketChannel {');
    expect(nearby).not.toContain('export class TransferConnection {');
  });

  it('真身模块导出 `connectNearbyPlan` / `acceptNearbyPlan` / `secureChecks`', () => {
    const real = repoText('src/core/transfer/transferConnection.ts');
    expect(real).toContain('export function connectNearbyPlan(');
    expect(real).toContain('export function acceptNearbyPlan(');
    expect(real).toContain('export function secureChecks(');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ GodMomentSettingsStore.kt L16 / L40-44 三个键
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GodMomentSettingsStore.kt L16 / L40-44 DataStore 名与键名', () => {
  const src = kt(GOD_KT);

  it('L16 文件/存储名 `god_moment_prefs`，与 SharedPreferences 体系并存', () => {
    expect(src).toContain('preferencesDataStore(name = "god_moment_prefs")');
    expect(repoText('src/core/god/godRankingSettings.ts')).toContain("const STORAGE_KEY = 'god_moment_prefs';");
  });

  it('L41-43 三个键名逐字：`ranking_style` / `last_page_hint` / `gyro_parallax`', () => {
    expect(src).toContain('val RANKING_STYLE = stringPreferencesKey("ranking_style")');
    expect(src).toContain('val HINT_CAPSULE = booleanPreferencesKey("last_page_hint")');
    expect(src).toContain('val GYRO_PARALLAX = booleanPreferencesKey("gyro_parallax")');
    expect(GOD_PORTABLE_KEYS).toEqual(['ranking_style', 'last_page_hint', 'gyro_parallax']);
  });

  it('L63 / L68 两个布尔默认 true；L59 风格默认 PODIUM', () => {
    expect(src).toContain('.map { it[Keys.HINT_CAPSULE] ?: true }');
    expect(src).toContain('.map { it[Keys.GYRO_PARALLAX] ?: true }');
    expect(src).toContain('.guarded(GodRankingStyle.PODIUM, "rankingStyle")');
    expect(getGodHintCapsuleEnabled()).toBe(true);
    expect(getGodGyroParallaxEnabled()).toBe(true);
    expect(getGodRankingStyle()).toBe('podium');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ GodMomentSettingsStore.kt L27-38 exportPortable / importPortable
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GodMomentSettingsStore.kt L27-38 便携导出与导入', () => {
  const src = kt(GOD_KT);

  it('L28-30 导出三个键，风格取 `rankingStyle.first().code`', () => {
    expect(src).toContain('.put("ranking_style", rankingStyle.first().code)');
    expect(src).toContain('.put("last_page_hint", hintCapsuleEnabled.first())');
    expect(src).toContain('.put("gyro_parallax", gyroParallaxEnabled.first())');
    setGodRankingStyle('vinyl');
    setGodHintCapsuleEnabled(false);
    setGodGyroParallaxEnabled(true);
    expect(exportGodPortableSettings()).toEqual({
      ranking_style: 'vinyl',
      last_page_hint: false,
      gyro_parallax: true,
    });
  });

  it('L34 `GodRankingStyle.of(value.getString("ranking_style")).code` —— 未知值归一到 podium', () => {
    expect(src).toContain('it[Keys.RANKING_STYLE] = GodRankingStyle.of(value.getString("ranking_style")).code');
    importGodPortableSettings({ ranking_style: '不存在', last_page_hint: false, gyro_parallax: false });
    expect(getGodRankingStyle()).toBe('podium');
    expect(getGodHintCapsuleEnabled()).toBe(false);
    expect(getGodGyroParallaxEnabled()).toBe(false);
  });

  it('L35-36 `getBoolean` 严读：缺键或类型不对就抛（不静默取默认）', () => {
    expect(src).toContain('it[Keys.HINT_CAPSULE] = value.getBoolean("last_page_hint")');
    expect(src).toContain('it[Keys.GYRO_PARALLAX] = value.getBoolean("gyro_parallax")');
    setGodRankingStyle('polaroid');
    expect(() => importGodPortableSettings({ last_page_hint: true, gyro_parallax: true })).toThrow('ranking_style');
    expect(() => importGodPortableSettings({ ranking_style: 'podium', gyro_parallax: true })).toThrow('last_page_hint');
    expect(() => importGodPortableSettings({ ranking_style: 'podium', last_page_hint: true })).toThrow('gyro_parallax');
    // 类型不对同样拒绝（Kotlin `getBoolean` 会抛）
    expect(() =>
      importGodPortableSettings({ ranking_style: 'podium', last_page_hint: 'yes', gyro_parallax: true }),
    ).toThrow();
    // 失败时**不改**已有值（事务语义：整份拒绝）
    expect(getGodRankingStyle()).toBe('polaroid');
  });

  it('导出 → 导入 往返一致', () => {
    setGodRankingStyle('vinyl');
    setGodHintCapsuleEnabled(true);
    setGodGyroParallaxEnabled(false);
    const exported = exportGodPortableSettings();
    setGodRankingStyle('podium');
    setGodHintCapsuleEnabled(false);
    setGodGyroParallaxEnabled(true);
    importGodPortableSettings(exported as unknown as Record<string, unknown>);
    expect(exportGodPortableSettings()).toEqual(exported);
  });
});
