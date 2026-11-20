/**
 * appUpdateStoreAndGlowDrawCacheParity.test.ts
 *   ├ `data/AppUpdateStore.kt`（81 行）→ `@core/update/appUpdateStore`
 *   └ `me/trishiraj/shadowglow/GlowDrawCache.kt`（99 行）→ `@core/glass/glowDrawCache`
 *
 * `AppUpdateStore` 的端口逐行对齐得很好（573 行，连 `AtomicFile` 都复刻了），缺的只是
 * **读原文的测试** —— `tests/unit/appUpdateStore.test.ts`（458 行）里 `androidReference`
 * 与 `readFileSync` 各 0 命中。
 *
 * `GlowDrawCache` 则是**空壳**：端口在 `parityMisc.ts` 里只有两个只有构造字段的类，
 * `draw` 一个都没有，`cornerRadius` / `sigma` / `trailFraction` 三处字段还被改名。
 * 本轮补真身（E212）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APP_UPDATE_APK_FILE,
  APP_UPDATE_DIRECTORY,
  APP_UPDATE_METADATA_FILE,
  APP_UPDATE_PARTIAL_EXTENSION,
  AppUpdateStore,
  MAX_PENDING_METADATA_BYTES,
  MAX_PENDING_NOTES_CHARS,
  encodePendingMetadata,
  fileExtension,
  type AppPackageIdentity,
  type PendingAppUpdate,
  type UpdateFileStore,
} from '@core/update/appUpdateStore';
import { MAX_UPDATE_BYTES, UPDATE_REPOSITORY, makeUpdateRelease } from '@core/update/githubUpdateChecker';
import {
  GLOW_SHADOW_BUCKET,
  GlowTrailDrawCache,
  ROUND_RECT_INITIAL_SIGMA_KEY,
  ROUND_RECT_SIGNATURE_PREFIX,
  RoundRectGlowDrawCache,
  TRAIL_MIN_FRACTION,
  TRAIL_SIGNATURE,
  ktRoundToInt,
  roundRectGlowBounds,
  roundRectGlowChanged,
  roundRectGlowRadius,
  roundRectGlowSigmaInvalid,
  roundRectGlowSigmaKey,
  roundRectGlowSignature,
  trailSegmentPlan,
  trailSegmentRanges,
} from '@core/glass/glowDrawCache';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const STORE_KT = 'com/example/data/AppUpdateStore.kt';
const GLOW_KT = 'me/trishiraj/shadowglow/GlowDrawCache.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① AppUpdateStore.kt L10-17 数据类与四个固定路径
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AppUpdateStore.kt L10-17 数据类与固定路径', () => {
  const src = kt(STORE_KT);

  it('L10 `PendingAppUpdate(release, versionCode, sha256)` 三个字段', () => {
    expect(src).toContain('internal data class PendingAppUpdate(val release: UpdateRelease, val versionCode: Long, val sha256: String)');
  });

  it('L12 注释说明「永不删用户选的导出 / Downloads / 书文件」', () => {
    expect(src).toContain('/** Fixed private paths: never delete a user-selected export, Downloads, or book files. */');
  });

  it('L14-16 三个名字：`app_updates` / `update.apk` / `pending.json`', () => {
    expect(src).toContain('File(context.filesDir, "app_updates").apply { mkdirs() }');
    expect(src).toContain('File(directory, "update.apk")');
    expect(src).toContain('AtomicFile(File(directory, "pending.json"))');
    expect(APP_UPDATE_DIRECTORY).toBe('app_updates');
    expect(APP_UPDATE_APK_FILE).toBe('update.apk');
    expect(APP_UPDATE_METADATA_FILE).toBe('pending.json');
  });

  it('L17 `newTransferFile() = File(directory, "${UUID.randomUUID()}.part")`', () => {
    expect(src).toContain('fun newTransferFile() = File(directory, "${UUID.randomUUID()}.part")');
    expect(APP_UPDATE_PARTIAL_EXTENSION).toBe('part');
    expect(fileExtension('abc.part')).toBe('part');
    expect(fileExtension('no-dot')).toBe('');
  });

  it('L37 `readImportBytes(192 * 1024)` / L53 `.take(24_000)` / L80 companion 锁', () => {
    expect(src).toContain('metadata.openRead().use { it.readImportBytes(192 * 1024) }');
    expect(src).toContain('json.optString("notes").take(24_000)');
    expect(src).toContain('companion object { private val storageLock = Any() }');
    expect(MAX_PENDING_METADATA_BYTES).toBe(192 * 1024);
    expect(MAX_PENDING_NOTES_CHARS).toBe(24_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② AppUpdateStore.kt L19-34 save 的六道门与九键顺序
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AppUpdateStore.kt L19-34 save', () => {
  const src = kt(STORE_KT);

  it('L20 `pending.release.apk ?: error("更新缺少安装包")`', () => {
    expect(src).toContain('val asset = pending.release.apk ?: error("更新缺少安装包")');
  });

  it('L21 `require(officialUpdateAsset(tag, asset.name, asset.url))` —— 无 message', () => {
    expect(src).toContain('require(officialUpdateAsset(pending.release.tag, asset.name, asset.url))');
  });

  it('L22 传输文件必须**同目录**且扩展名 `part`（check，无 message）', () => {
    expect(src).toContain('check(file.parentFile?.canonicalFile == directory.canonicalFile && file.extension == "part")');
  });

  it('L23-24 两条带文案的 check', () => {
    expect(src).toContain('if (apkFile.exists()) check(apkFile.delete()) { "无法替换旧安装包" }');
    expect(src).toContain('check(file.renameTo(apkFile)) { "无法保存安装包" }');
  });

  it('L25-28 九个键的 put 顺序就是文件格式', () => {
    expect(src).toContain('JSONObject().put("tag", pending.release.tag).put("releaseUrl", pending.release.releaseUrl)');
    expect(src).toContain('.put("notes", pending.release.notes).put("name", asset.name).put("url", asset.url)');
    expect(src).toContain('.put("size", asset.size ?: JSONObject.NULL).put("digest", asset.sha256 ?: JSONObject.NULL)');
    expect(src).toContain('.put("versionCode", pending.versionCode).put("sha256", pending.sha256)');
    const json = JSON.parse(encodePendingMetadata(pendingOf())) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      'tag',
      'releaseUrl',
      'notes',
      'name',
      'url',
      'size',
      'digest',
      'versionCode',
      'sha256',
    ]);
  });

  it('L29-33 `AtomicFile` 三段：startWrite / finishWrite / failWrite+rethrow', () => {
    expect(src).toContain('val out = metadata.startWrite()');
    expect(src).toContain('metadata.finishWrite(out)');
    expect(src).toContain('} catch (e: Exception) { metadata.failWrite(out); throw e }');
  });

  it('`size` / `digest` 为 null 时写的是 `JSONObject.NULL`（JSON 里是真正的 null）', () => {
    const json = JSON.parse(
      encodePendingMetadata(pendingOf({ size: null, digest: null })),
    ) as Record<string, unknown>;
    expect(json['size']).toBeNull();
    expect(json['digest']).toBeNull();
    expect('size' in json).toBe(true);
    expect('digest' in json).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ AppUpdateStore.kt L36-54 load 的九道校验
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AppUpdateStore.kt L36-54 load', () => {
  const src = kt(STORE_KT);

  it('L39-41 三个 `getString`（tag / name / url）—— 缺一个就整条作废', () => {
    expect(src).toContain('val tag = json.getString("tag")');
    expect(src).toContain('val name = json.getString("name")');
    expect(src).toContain('val url = json.getString("url")');
  });

  it('L43-44 `releaseUrl` 必须**自己重算**并比对，不信文件里的值', () => {
    expect(src).toContain('val releaseUrl = "$UPDATE_REPOSITORY/releases/tag/$tag"');
    expect(src).toContain('require(json.getString("releaseUrl") == releaseUrl)');
    expect(`${UPDATE_REPOSITORY}/releases/tag/1.2.3`).toContain('/releases/tag/');
  });

  it('L45-46 / L49-50 sha256 与 digest 都必须是 64 位小写十六进制', () => {
    expect(src).toContain('require(Regex("[0-9a-f]{64}").matches(hash))');
    expect(src).toContain('require(digest == null || Regex("[0-9a-f]{64}").matches(digest))');
  });

  it('L47-48 `size` 显式 null 合法，否则必须落在 `1..MAX_UPDATE_BYTES`', () => {
    expect(src).toContain('val size = if (json.isNull("size")) null else json.getLong("size")');
    expect(src).toContain('require(size == null || size in 1..MAX_UPDATE_BYTES)');
    expect(MAX_UPDATE_BYTES).toBe(192 * 1024 * 1024);
  });

  it('L51-52 `versionCode > 0`', () => {
    expect(src).toContain('val code = json.getLong("versionCode")');
    expect(src).toContain('require(code > 0)');
  });

  it('L54 `runCatching { … }.getOrNull()` —— 任何一条 require 失败都返回 null，不抛', () => {
    expect(src).toContain('fun load(): PendingAppUpdate? = synchronized(storageLock) { runCatching {');
    expect(src).toContain('}.getOrNull() }');
  });

  it('九道校验逐条把坏 JSON 判成 null', async () => {
    const cases: Array<Record<string, unknown>> = [
      { ...goodJson(), tag: undefined },
      { ...goodJson(), name: 'other.apk' },
      { ...goodJson(), url: 'https://evil.example/x.apk' },
      { ...goodJson(), releaseUrl: 'https://evil.example/releases/tag/1.2.3' },
      { ...goodJson(), sha256: 'A'.repeat(64) },
      { ...goodJson(), sha256: '0'.repeat(63) },
      { ...goodJson(), size: 0 },
      { ...goodJson(), size: MAX_UPDATE_BYTES + 1 },
      { ...goodJson(), digest: 'xyz' },
      { ...goodJson(), versionCode: 0 },
      { ...goodJson(), versionCode: -1 },
    ];
    for (const json of cases) {
      expect(await loadWith(json)).toBeNull();
    }
    // 对照组：完整 JSON 能读出来
    const ok = await loadWith(goodJson());
    expect(ok).not.toBeNull();
    expect(ok?.versionCode).toBe(7);
    expect(ok?.sha256).toBe('a'.repeat(64));
  });

  it('显式 null 的 size / digest 是合法组合', async () => {
    const pending = await loadWith(goodJson({ size: null, digest: null }));
    expect(pending).not.toBeNull();
    expect(pending?.release.apk?.size).toBeNull();
    expect(pending?.release.apk?.sha256).toBeNull();
  });

  it('`notes` 超过 24_000 字符在**读**的时候截断', async () => {
    const pending = await loadWith(goodJson({ notes: 'x'.repeat(MAX_PENDING_NOTES_CHARS + 500) }));
    expect(pending?.release.notes).toHaveLength(MAX_PENDING_NOTES_CHARS);
  });

  it('元数据超过 192 KiB 直接放弃（L37 的 `readImportBytes` 上限）', async () => {
    const huge = { ...goodJson(), notes: 'x'.repeat(MAX_PENDING_METADATA_BYTES) };
    expect(await loadWith(huge)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ AppUpdateStore.kt L56-78 installedCode / cleanup / clear
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AppUpdateStore.kt L56-78 installedCode / cleanupInstalled / clear', () => {
  const src = kt(STORE_KT);

  it('L56 `@Suppress("DEPRECATION")` + L59 `if (Build.VERSION.SDK_INT >= 28)`', () => {
    expect(src).toContain('@Suppress("DEPRECATION")');
    expect(src).toContain('return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()');
  });

  it('L62 注释「True only after PackageManager confirms the saved target version was installed.」', () => {
    expect(src).toContain('/** True only after PackageManager confirms the saved target version was installed. */');
  });

  it('L65 `if (installedCode() < pending.versionCode) return false` —— 相等即**已装**', () => {
    expect(src).toContain('if (installedCode() < pending.versionCode) return false');
  });

  it('cleanupInstalled 三态：无 pending / 未装到目标版本 / 已装', async () => {
    const fs = memoryStore();
    await writeMetadata(fs, goodJson());
    expect(await new AppUpdateStore({ fs, packageIdentity: pkg(6) }).cleanupInstalled()).toBe(false);
    expect(await fs.exists('files/app_updates/pending.json')).toBe(true);
    // 恰好等于目标版本 → 清空并返回 true
    expect(await new AppUpdateStore({ fs, packageIdentity: pkg(7) }).cleanupInstalled()).toBe(true);
    expect(await fs.exists('files/app_updates/pending.json')).toBe(false);
    // 已经没有 pending → false
    expect(await new AppUpdateStore({ fs, packageIdentity: pkg(7) }).cleanupInstalled()).toBe(false);
  });

  it('L70-78 `clear()` 连 `.part` 一起清；`clearPartialFiles()` 只删**文件**且扩展名 `part`', async () => {
    expect(src).toContain('apkFile.delete()');
    expect(src).toContain('metadata.delete()');
    expect(src).toContain('clearPartialFiles()');
    expect(src).toContain('directory.listFiles()?.filter { it.isFile && it.extension == "part" }?.forEach { it.delete() }');
    const fs = memoryStore();
    await fs.writeFile('files/app_updates/update.apk', new Uint8Array(4));
    await fs.writeFile('files/app_updates/a.part', new Uint8Array(4));
    await fs.writeFile('files/app_updates/b.apk', new Uint8Array(4));
    await fs.writeFile('files/app_updates/keep.txt', new Uint8Array(4));
    const store = new AppUpdateStore({ fs, packageIdentity: pkg(1) });
    await store.clearPartialFiles();
    expect(await fs.exists('files/app_updates/a.part')).toBe(false);
    // 非 .part 的三个都还在
    expect(await fs.exists('files/app_updates/update.apk')).toBe(true);
    expect(await fs.exists('files/app_updates/b.apk')).toBe(true);
    expect(await fs.exists('files/app_updates/keep.txt')).toBe(true);
    await store.clear();
    expect(await fs.exists('files/app_updates/update.apk')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ GlowDrawCache.kt L14-31 RoundRectGlowDrawCache 的字段与初值
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GlowDrawCache.kt L14-31 RoundRect 的八个参数与初值', () => {
  const src = kt(GLOW_KT);

  it('L15-22 八个构造参数名（`cornerRadius` / `color` / `alpha`…）', () => {
    expect(src).toContain('internal class RoundRectGlowDrawCache(');
    for (const param of [
      'private val width: Float,',
      'private val height: Float,',
      'private val spread: Float,',
      'private val offsetX: Float,',
      'private val offsetY: Float,',
      'private val cornerRadius: Float,',
      'private val color: Color,',
      'private val alpha: Float,',
    ]) {
      expect(src).toContain(param);
    }
  });

  it('L26-29 四个 `previous* = Float.NaN`；L30 `signature = ""`；L31 `previousSigma = Int.MIN_VALUE`', () => {
    expect(src).toContain('private var previousLeft = Float.NaN');
    expect(src).toContain('private var previousTop = Float.NaN');
    expect(src).toContain('private var previousRight = Float.NaN');
    expect(src).toContain('private var previousBottom = Float.NaN');
    expect(src).toContain('private var signature = ""');
    expect(src).toContain('private var previousSigma = Int.MIN_VALUE');
    expect(src).toContain('private var shadow: ResolvedBlurredShadow? = null');
    expect(ROUND_RECT_INITIAL_SIGMA_KEY).toBe(-2147483648);
    // 端口：未绘制时签名是空串（不是 undefined）
    expect(new RoundRectGlowDrawCache(rectInput()).signature).toBe('');
  });

  it('L12 注释「Geometry belongs to one draw cache; a new window size or density recreates it.」', () => {
    expect(src).toContain('/** Geometry belongs to one draw cache; a new window size or density recreates it. */');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ GlowDrawCache.kt L34-62 draw 的四边 / 半径 / 签名 / σ
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GlowDrawCache.kt L36-42 四边与早退', () => {
  const src = kt(GLOW_KT);

  it('L36-41 加法顺序照抄（`-spread + totalOffsetX`）', () => {
    expect(src).toContain('val totalOffsetX = offsetX + parallaxX');
    expect(src).toContain('val totalOffsetY = offsetY + parallaxY');
    expect(src).toContain('val left = -spread + totalOffsetX');
    expect(src).toContain('val top = -spread + totalOffsetY');
    expect(src).toContain('val right = width + spread + totalOffsetX');
    expect(src).toContain('val bottom = height + spread + totalOffsetY');
    const b = roundRectGlowBounds(rectInput(), 0, 0);
    expect(b).toMatchObject({ left: -5, top: -7, right: 115, bottom: 63, visible: true });
  });

  it('L35 注释「Preserve the original order of Float operations, including translation.」', () => {
    expect(src).toContain('// Preserve the original order of Float operations, including translation.');
    // parallax 参与四边
    const b = roundRectGlowBounds(rectInput(), 10, -2);
    expect(b).toMatchObject({ left: 5, top: -9, right: 125, bottom: 61 });
  });

  it('L42 `if (right <= left || bottom <= top) return` —— 退化矩形整帧不画', () => {
    expect(src).toContain('if (right <= left || bottom <= top) return');
    // 宽度为负且 spread 撑不回来：right = -200 + 50 + 5 = -145 < left = -45
    const degenerate = { ...rectInput(), width: -200, height: 0, spread: 50 };
    expect(roundRectGlowBounds(degenerate, 0, 0).visible).toBe(false);
    expect(new RoundRectGlowDrawCache(degenerate).draw(0, 0, 4)).toBeNull();
    // 高度退化同样早退
    const flat = { ...rectInput(), width: 100, height: -200, spread: 50 };
    expect(roundRectGlowBounds(flat, 0, 0).visible).toBe(false);
  });
});

describe('GlowDrawCache.kt L43-51 changed / radius / signature', () => {
  const src = kt(GLOW_KT);

  it('L43 四值**精确**比较（NaN 起始 ⇒ 首帧必然 changed）', () => {
    expect(src).toContain('val changed = left != previousLeft || top != previousTop || right != previousRight || bottom != previousBottom');
    const a = roundRectGlowBounds(rectInput(), 0, 0);
    expect(roundRectGlowChanged({ left: Number.NaN, top: Number.NaN, right: Number.NaN, bottom: Number.NaN }, a)).toBe(true);
    expect(roundRectGlowChanged(a, a)).toBe(false);
    expect(roundRectGlowChanged(a, { ...a, left: a.left + 0.0001 })).toBe(true);
  });

  it('L46 `cornerRadius.coerceIn(0f, (right - left) / 2f)`', () => {
    expect(src).toContain('val radius = cornerRadius.coerceIn(0f, (right - left) / 2f)');
    expect(roundRectGlowRadius(8, -5, 115)).toBe(8);
    // 超过半宽 → 夹到半宽
    expect(roundRectGlowRadius(1000, -5, 115)).toBe(60);
    // 负圆角 → 0
    expect(roundRectGlowRadius(-3, -5, 115)).toBe(0);
  });

  it('L51 签名三处 `* 2f` + `roundToInt` ⇒ `RR|半像素宽|半像素高|半像素半径`', () => {
    expect(src).toContain('signature = "RR|${((right - left) * 2f).roundToInt()}|${((bottom - top) * 2f).roundToInt()}|${(radius * 2f).roundToInt()}"');
    expect(ROUND_RECT_SIGNATURE_PREFIX).toBe('RR');
    const b = roundRectGlowBounds(rectInput(), 0, 0);
    expect(roundRectGlowSignature(b, roundRectGlowRadius(8, b.left, b.right))).toBe('RR|240|140|16');
    // 半像素级差异会换签名（120.2 → 240.4 → 240；120.3 → 240.6 → 241）
    const b2 = { ...b, right: b.left + 120.3 };
    expect(roundRectGlowSignature(b2, 8)).toBe('RR|241|140|16');
  });

  it('第一帧就建签名，第二帧不变则复用（`needsResolve` 只在 changed / 换桶时为真）', () => {
    const cache = new RoundRectGlowDrawCache(rectInput());
    expect(cache.signature).toBe('');
    const first = cache.draw(0, 0, 2);
    expect(first).not.toBeNull();
    expect(cache.signature).toBe('RR|240|140|16');
    expect(first?.signature).toBe('RR|240|140|16');
    // 同一姿态同一 σ → 不重解析（返回同一个对象）
    const keyBefore = cache.sigmaKey;
    const second = cache.draw(0, 0, 2);
    expect(second).toBe(first);
    expect(cache.sigmaKey).toBe(keyBefore);
    // 换姿态 → changed（四边变了 → 重解析），但**签名不变**：签名只由宽高与半径决定
    const moved = cache.draw(3, 0, 2);
    expect(moved).not.toBe(first);
    expect(cache.signature).toBe('RR|240|140|16');
    // 改尺寸才换签名
    const resized = new RoundRectGlowDrawCache({ ...rectInput(), width: 103 });
    expect(resized.draw(0, 0, 2)?.signature).toBe('RR|246|140|16');
  });
});

describe('GlowDrawCache.kt L53-61 σ 的量化与非法处理', () => {
  const src = kt(GLOW_KT);

  it('L53 `sigma.isNaN() || sigma < 0f` ⇒ `shadow = null; previousSigma = Int.MIN_VALUE; return`', () => {
    expect(src).toContain('if (sigma.isNaN() || sigma < 0f) { shadow = null; previousSigma = Int.MIN_VALUE; return }');
    expect(roundRectGlowSigmaInvalid(Number.NaN)).toBe(true);
    expect(roundRectGlowSigmaInvalid(-0.1)).toBe(true);
    expect(roundRectGlowSigmaInvalid(0)).toBe(false);
    expect(roundRectGlowSigmaInvalid(3)).toBe(false);
  });

  it('非法 σ 之后**必须**复位哨兵值 —— 否则恢复合法时会命中一个已置空的 key', () => {
    const cache = new RoundRectGlowDrawCache(rectInput());
    expect(cache.draw(0, 0, 2)?.sigmaPx).toBe(2);
    expect(cache.sigmaKey).toBe(4);
    expect(cache.draw(0, 0, Number.NaN)).toBeNull();
    expect(cache.sigmaKey).toBe(ROUND_RECT_INITIAL_SIGMA_KEY);
    // 恢复成同一个 σ 也要重新解析（因为哨兵已复位）
    expect(cache.draw(0, 0, 2)?.sigmaPx).toBe(2);
    expect(cache.sigmaKey).toBe(4);
  });

  it('L56 `sigmaKey = (sigma * 2f).roundToInt()` —— 半像素一个桶', () => {
    expect(src).toContain('val sigmaKey = (sigma * 2f).roundToInt()');
    expect(roundRectGlowSigmaKey(0)).toBe(0);
    expect(roundRectGlowSigmaKey(1.26)).toBe(3);
    expect(roundRectGlowSigmaKey(1.3)).toBe(3);
    expect(roundRectGlowSigmaKey(1.74)).toBe(3);
    expect(roundRectGlowSigmaKey(1.8)).toBe(4);
    // 同桶不重解析、换桶重解析
    const cache = new RoundRectGlowDrawCache(rectInput());
    const a = cache.draw(0, 0, 1.3);
    expect(cache.draw(0, 0, 1.7)).toBe(a);
    expect(cache.draw(0, 0, 1.9)).not.toBe(a);
  });

  it('L54-55 注释点明「同一桶内复用解析结果不能改变一个像素」', () => {
    expect(src).toContain('// resolveBlurredShadow uses only this quantized sigma thereafter. Reusing');
    expect(src).toContain('// the resolved wrapper within the same bucket cannot alter a single pixel.');
  });

  it('L59-60 解析入参：Fill、`bucket = ANIMATED`、dx/dy 为 0', () => {
    expect(src).toContain('Fill,');
    expect(src).toContain('bucket = ShadowCacheBucket.ANIMATED');
    expect(GLOW_SHADOW_BUCKET).toBe('ANIMATED');
    const request = new RoundRectGlowDrawCache(rectInput()).draw(0, 0, 2);
    expect(request).toMatchObject({ dx: 0, dy: 0, strokeWidthPx: 0, style: 'Fill', useCache: true });
    expect(request?.effectiveAlpha).toBe(0.5);
    expect(request?.rgb).toBe(0x112233);
  });

  it('`ktRoundToInt` 与 Kotlin `Float.roundToInt()` 一致（含 -0 归一）', () => {
    expect(ktRoundToInt(0.5)).toBe(1);
    expect(ktRoundToInt(-0.5)).toBe(0);
    expect(ktRoundToInt(-1.5)).toBe(-1);
    expect(ktRoundToInt(2.49)).toBe(2);
    expect(Object.is(ktRoundToInt(-0.4), 0)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ GlowDrawCache.kt L66-99 GlowTrailDrawCache
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GlowDrawCache.kt L66-99 GlowTrailDrawCache', () => {
  const src = kt(GLOW_KT);

  it('L67-73 五个构造参数（`sigma` / `trailFraction` 原名）', () => {
    expect(src).toContain('internal class GlowTrailDrawCache(');
    expect(src).toContain('outline: Outline,');
    expect(src).toContain('strokeWidth: Float,');
    expect(src).toContain('private val sigma: Float,');
    expect(src).toContain('private val alpha: Float,');
    expect(src).toContain('trailFraction: Float,');
  });

  it('L74-80 `PathMeasure(fullPath, false)` 一次建好，`segment` 每帧 rewind 复用', () => {
    expect(src).toContain('private val measure = PathMeasure(fullPath, false)');
    expect(src).toContain('private val length = measure.length');
    expect(src).toContain('private val segment = Path()');
    expect(src).toContain('private val stroke = Stroke(strokeWidth)');
  });

  it('L77 `segmentLength = length * trailFraction.coerceIn(.01f, 1f)`', () => {
    expect(src).toContain('private val segmentLength = length * trailFraction.coerceIn(.01f, 1f)');
    expect(TRAIL_MIN_FRACTION).toBe(0.01);
    expect(trailSegmentPlan(100, 0, 0.25).segmentLength).toBe(25);
    // 小于下界 → 按 0.01
    expect(trailSegmentPlan(100, 0, 0.001).segmentLength).toBeCloseTo(1, 10);
    // 大于 1 → 按 1
    expect(trailSegmentPlan(100, 0, 5).segmentLength).toBe(100);
  });

  it('L83 `length <= 0f` ⇒ 不画', () => {
    expect(src).toContain('if (length <= 0f) return');
    const cache = new GlowTrailDrawCache(trailInput({ outlineLength: 0 }));
    expect(cache.draw(0.3)).toBeNull();
    expect(trailSegmentPlan(-5, 0.3, 0.5).visible).toBe(false);
  });

  it('L84 `(progress * length) % length` —— 进度可超过 1 圈', () => {
    expect(src).toContain('val start = (progress * length) % length');
    expect(trailSegmentPlan(100, 0.25, 0.5)).toMatchObject({ start: 25, end: 75, wraps: false });
    expect(trailSegmentPlan(100, 2.25, 0.5)).toMatchObject({ start: 25, end: 75 });
    expect(trailSegmentPlan(100, 1, 0.5)).toMatchObject({ start: 0, end: 50 });
  });

  it('L87-92 `end > length` 时拆成两段（先 [start, length]，再 [0, end-length]）', () => {
    expect(src).toContain('if (end <= length) {');
    expect(src).toContain('measure.getSegment(start, end, segment, true)');
    expect(src).toContain('measure.getSegment(start, length, segment, true)');
    expect(src).toContain('measure.getSegment(0f, end - length, segment, true)');
    const plan = trailSegmentPlan(100, 0.9, 0.25);
    expect(plan).toMatchObject({ start: 90, end: 115, wraps: true });
    expect(trailSegmentRanges(100, plan)).toEqual([
      [90, 100],
      [0, 15],
    ]);
    // 不环绕时只有一段
    expect(trailSegmentRanges(100, trailSegmentPlan(100, 0.1, 0.25))).toEqual([[10, 35]]);
  });

  it('恰好相切（`end === length`）算**不**环绕 —— 原文是 `end <= length`', () => {
    const plan = trailSegmentPlan(100, 0.75, 0.25);
    expect(plan.end).toBe(100);
    expect(plan.wraps).toBe(false);
    expect(trailSegmentRanges(100, plan)).toEqual([[75, 100]]);
  });

  it('L95-96 解析入参：`"TRAIL"`、`useCache = false`、`stroke`、`color.copy(alpha)`', () => {
    expect(src).toContain('resolveBlurredShadow(segment, bounds, "TRAIL", color.copy(alpha = alpha), sigma,');
    expect(src).toContain('0f, 0f, stroke.width, stroke, useCache = false, bucket = ShadowCacheBucket.ANIMATED) ?: return');
    expect(TRAIL_SIGNATURE).toBe('TRAIL');
    const request = new GlowTrailDrawCache(trailInput()).draw(0.1);
    expect(request).toMatchObject({
      signature: 'TRAIL',
      useCache: false,
      style: 'Stroke',
      dx: 0,
      dy: 0,
      strokeWidthPx: 3,
      effectiveAlpha: 0.4,
    });
    expect(request).not.toBeNull();
    expect(request?.ranges).toEqual([[10, 35]]);
  });

  it('L66 注释「Keep the full outline and PathMeasure; only the moving segment is rewritten.」', () => {
    expect(src).toContain('/** Keep the full outline and PathMeasure; only the moving segment is rewritten. */');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑧ 同名占位的收尾：`parityMisc.ts` 不再有空壳类
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GlowDrawCache 的真名已交还', () => {
  it('`parityMisc.ts` 里不再有两个空壳类，改为转发真身', () => {
    const misc = repoText('src/core/ui/parityMisc.ts');
    expect(misc).toContain("from '../glass/glowDrawCache'");
    // 空壳的形状：`export class RoundRectGlowDrawCache {` 后紧跟 constructor
    expect(misc).not.toContain('export class RoundRectGlowDrawCache {');
    expect(misc).not.toContain('export class GlowTrailDrawCache {');
    // 旧字段名（漂移的三处）
    expect(misc).not.toContain('readonly blurSigma: number');
    expect(misc).not.toContain('readonly lengthFraction: number');
  });

  it('真身用 Kotlin 的字段名（`cornerRadius` / `sigma` / `trailFraction`）', () => {
    const real = repoText('src/core/glass/glowDrawCache.ts');
    expect(real).toContain('readonly cornerRadius: number;');
    expect(real).toContain('readonly sigma: number;');
    expect(real).toContain('readonly trailFraction: number;');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════════════════════════ */

function rectInput(overrides: Partial<Parameters<typeof roundRectGlowBounds>[0]> & { cornerRadius?: number; rgb?: number; alpha?: number } = {}) {
  return {
    width: 100,
    height: 50,
    spread: 10,
    offsetX: 5,
    offsetY: 3,
    cornerRadius: 8,
    rgb: 0x112233,
    alpha: 0.5,
    ...overrides,
  };
}

function trailInput(overrides: Partial<{ outlineLength: number; strokeWidth: number; sigma: number; alpha: number; trailFraction: number; rgb: number }> = {}) {
  return {
    outlineLength: 100,
    strokeWidth: 3,
    sigma: 2,
    alpha: 0.4,
    trailFraction: 0.25,
    rgb: 0x445566,
    ...overrides,
  };
}

const TAG = '1.2.3';
const ASSET_NAME = `Ciallo-Reader-${TAG}.apk`;
const ASSET_URL = `${UPDATE_REPOSITORY}/releases/download/${TAG}/${ASSET_NAME}`;

function pendingOf(overrides: { size?: number | null; digest?: string | null } = {}): PendingAppUpdate {
  return {
    release: makeUpdateRelease(
      TAG,
      `${UPDATE_REPOSITORY}/releases/tag/${TAG}`,
      'notes',
      {
        name: ASSET_NAME,
        url: ASSET_URL,
        size: 'size' in overrides ? (overrides.size ?? null) : 4096,
        sha256: 'digest' in overrides ? (overrides.digest ?? null) : 'd'.repeat(64),
      },
    ),
    versionCode: 7,
    sha256: 'a'.repeat(64),
  };
}

function goodJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag: TAG,
    releaseUrl: `${UPDATE_REPOSITORY}/releases/tag/${TAG}`,
    notes: 'notes',
    name: ASSET_NAME,
    url: ASSET_URL,
    size: 4096,
    digest: 'd'.repeat(64),
    versionCode: 7,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

interface MemoryStore extends UpdateFileStore {
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;
}

function memoryStore(): MemoryStore {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['files']);
  const store: MemoryStore = {
    files,
    dirs,
    filesDir: 'files',
    async mkdirs(p: string) {
      dirs.add(p);
    },
    async exists(p: string) {
      return files.has(p) || dirs.has(p);
    },
    async isFile(p: string) {
      return files.has(p);
    },
    async size(p: string) {
      return files.get(p)?.length ?? 0;
    },
    async readFile(p: string) {
      const value = files.get(p);
      if (value === undefined) throw new Error(`ENOENT ${p}`);
      return value;
    },
    async writeFile(p: string, data: Uint8Array) {
      files.set(p, data);
    },
    async delete(p: string) {
      dirs.delete(p);
      return files.delete(p);
    },
    async list(p: string) {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes('/')) names.add(rest);
      }
      return [...names];
    },
    async rename(from: string, to: string) {
      const value = files.get(from);
      if (value === undefined) return false;
      files.delete(from);
      files.set(to, value);
      return true;
    },
    canonicalPath(p: string) {
      return p.replace(/\/+$/, '');
    },
  };
  return store;
}

const pkg = (versionCode: number): AppPackageIdentity => ({ packageName: 'com.example.novelreader', versionCode });

async function writeMetadata(fs: MemoryStore, json: Record<string, unknown>): Promise<void> {
  fs.dirs.add('files/app_updates');
  await fs.writeFile(
    `files/app_updates/${APP_UPDATE_METADATA_FILE}`,
    new TextEncoder().encode(JSON.stringify(json)),
  );
}

async function loadWith(json: Record<string, unknown>): Promise<PendingAppUpdate | null> {
  const fs = memoryStore();
  await writeMetadata(fs, json);
  return new AppUpdateStore({ fs, packageIdentity: pkg(1) }).load();
}
