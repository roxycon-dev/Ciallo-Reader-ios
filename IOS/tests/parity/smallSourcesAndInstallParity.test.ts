/**
 * smallSourcesAndInstallParity.test.ts —— 第六批**小文件**（合计 140 行，4 个文件）。
 *
 *   · `source/ComicSource.kt`（34）—— 四个默认方法（文字章节 / 图片头 / 懒解析 / 解析后头）
 *   · `data/AppUpdateInstaller.kt`（37）—— canInstall / permissionIntent / installationIntent
 *   · `data/EncryptedSecretStore.kt`（37）—— 密钥存储失败即拒绝，迁移只做一次
 *   · `com/ramotion/fluidslider/FluidSliderCompose.kt`（32）—— 包装层的**死参数**与自己的 formatLabel
 *
 * 本轮的真缺口（E170）：包装层的 `formatLabel` 与库内默认标签不是同一个函数 ——
 * 包装层是 `roundToInt` + `%`，库内是 `toInt` 截断、无后缀。端口此前只有后者。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ComicSource } from '@core/source/comicSource';
import { createComicChapter } from '@core/source/comicChapter';
import { ParseError } from '@core/source/sourceException';
import {
  ACTION_MANAGE_UNKNOWN_APP_SOURCES,
  ACTION_SECURITY_SETTINGS,
  ACTION_VIEW,
  AndroidAppUpdateInstaller,
  APK_CLIP_LABEL,
  APK_MIME_TYPE,
  FLAG_GRANT_READ_URI_PERMISSION,
  UNKNOWN_SOURCES_SDK,
} from '@core/update/appUpdateInstaller';
import type { UpdateFileStore } from '@core/update/appUpdateStore';
import { EncryptedSecretStore, type LegacySharedPreferences } from '@core/data/encryptedSecretStore';
import {
  FLUID_SLIDER,
  FLUID_SLIDER_COMPOSE_DEFAULTS,
  fluidSliderBubbleText,
  fluidSliderPercentLabel,
} from '@core/components/fluidSlider';
import type { SecureStore } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/**
 * 直接用**真** `ComicSource.prototype`：四个默认方法就是实现里的那四个，
 * 两个抽象方法（getChapters / getChapterImages）不在这里重写 —— 本组用例只验默认值。
 */
function fakeSource(): ComicSource {
  return Object.create(ComicSource.prototype) as ComicSource;
}

describe('ComicSource.kt：四个默认方法', () => {
  const KT = kt('source/ComicSource.kt');

  it('接口继承 BookSource；两个抽象方法 + 四个默认实现', () => {
    expect(KT).toContain('interface ComicSource : BookSource');
    expect(KT).toContain('suspend fun getChapters(bookId: String): SourceResult<List<ComicChapter>>');
    expect(KT).toContain('suspend fun getChapterImages(chapterId: String): SourceResult<List<String>>');
    expect(KT).toContain('suspend fun getChapterText(chapterId: String): SourceResult<String>');
    expect(KT).toContain('suspend fun getChapterImageHeaders(');
    expect(KT).toContain('suspend fun resolveChapterImage(url: String): String? = null');
    expect(KT).toContain('suspend fun getResolvedHeaders(url: String): Map<String, String> = emptyMap()');
  });

  it('getChapterText 默认返回 ParseError「该书源不支持文字章节」', () => {
    expect(KT).toContain(
      'SourceResult.Error(SourceException.ParseError(tr("该书源不支持文字章节")))',
    );
    return expect(fakeSource().getChapterText('c1')).resolves.toMatchObject({
      kind: 'error',
      exception: expect.any(ParseError) as unknown,
    });
  });

  it('getChapterImageHeaders / getResolvedHeaders 默认空表，resolveChapterImage 默认 null', async () => {
    expect(KT).toContain('): Map<String, Map<String, String>> = emptyMap()');
    const source = fakeSource();
    await expect(source.getChapterImageHeaders('c1', ['https://x/1.jpg'])).resolves.toEqual({});
    await expect(source.getResolvedHeaders('https://x/1.jpg')).resolves.toEqual({});
    await expect(source.resolveChapterImage('https://x/1.jpg')).resolves.toBeNull();
  });

  it('文字章节的正文以 `\\n\\n` 分段（KDoc 约定）', () => {
    expect(KT).toContain('返回章节正文纯文本（段落以 \\n\\n 分隔）');
    // 默认实现连着 KDoc 一起被移植（TS 侧注释逐字）
    const TS = readFileSync('src/core/source/comicSource.ts', 'utf8');
    expect(TS).toContain('章节式文字源：返回章节正文纯文本（段落以 \\n\\n 分隔）');
    expect(TS).toContain('该书源不支持文字章节');
    expect(createComicChapter({ id: 'c', title: 't' }).order).toBe(0);
  });
});

describe('AppUpdateInstaller.kt：三条安装路径', () => {
  const KT = kt('data/AppUpdateInstaller.kt');

  function installer(options: {
    sdkInt: number;
    canRequest?: () => boolean;
    installNonMarket?: () => number;
    isFile?: (path: string) => boolean;
  }) {
    const env = {
      sdkInt: options.sdkInt,
      packageName: 'com.example.novelreader',
      canRequestPackageInstalls: options.canRequest ?? (() => true),
      installNonMarketApps: options.installNonMarket ?? (() => 0),
    };
    return new AndroidAppUpdateInstaller({
      env,
      contentUri: (file: string) => `content://provider/${file}`,
      // 只用到 `isFile`；其余 UpdateFileStore 成员本组用例用不到
      fs: { isFile: async (path: string) => options.isFile?.(path) ?? true } as unknown as UpdateFileStore,
    });
  }

  it('canInstall：API 26+ 读 canRequestPackageInstalls，旧版读 INSTALL_NON_MARKET_APPS == 1', async () => {
    expect(KT).toContain('if (Build.VERSION.SDK_INT >= 26) context.packageManager.canRequestPackageInstalls()');
    expect(KT).toContain('Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 1');
    expect(UNKNOWN_SOURCES_SDK).toBe(26);
    await expect(installer({ sdkInt: 26, canRequest: () => true }).canInstall()).resolves.toBe(true);
    await expect(installer({ sdkInt: 33, canRequest: () => false }).canInstall()).resolves.toBe(false);
    await expect(installer({ sdkInt: 25, installNonMarket: () => 1 }).canInstall()).resolves.toBe(true);
    await expect(installer({ sdkInt: 25, installNonMarket: () => 0 }).canInstall()).resolves.toBe(false);
  });

  it('canInstall 任何异常都吞成 false（`runCatching{}.getOrDefault(false)`）', async () => {
    expect(KT).toContain('}.getOrDefault(false)');
    await expect(
      installer({
        sdkInt: 26,
        canRequest: () => {
          throw new Error('binder died');
        },
      }).canInstall(),
    ).resolves.toBe(false);
    await expect(
      installer({
        sdkInt: 21,
        installNonMarket: () => {
          throw new Error('settings gone');
        },
      }).canInstall(),
    ).resolves.toBe(false);
  });

  it('permissionIntent：26+ → MANAGE_UNKNOWN_APP_SOURCES 带 package: URI；否则 SECURITY_SETTINGS', () => {
    expect(KT).toContain('Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))');
    expect(KT).toContain('else Intent(Settings.ACTION_SECURITY_SETTINGS)');
    const modern = installer({ sdkInt: 34 }).permissionIntent();
    expect(modern).toEqual({
      action: ACTION_MANAGE_UNKNOWN_APP_SOURCES,
      data: 'package:com.example.novelreader',
      type: null,
      flags: 0,
      clipLabel: null,
    });
    const legacy = installer({ sdkInt: 23 }).permissionIntent();
    expect(legacy.action).toBe(ACTION_SECURITY_SETTINGS);
    expect(legacy.data).toBeNull();
  });

  it('installationIntent：包不存在直接抛；存在则 VIEW + apk MIME + READ 授权 + clipData 标签', async () => {
    expect(KT).toContain('check(file.isFile) { tr("安装包已不存在，请重新下载") }');
    expect(KT).toContain('Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")');
    expect(KT).toContain('.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)');
    expect(KT).toContain('clipData = ClipData.newRawUri("Ciallo Reader 安装包", uri)');

    await expect(
      installer({ sdkInt: 34, isFile: () => false }).installationIntent('/x.apk'),
    ).rejects.toThrow('安装包已不存在，请重新下载');

    const intent = await installer({ sdkInt: 34 }).installationIntent('/x.apk');
    expect(intent).toEqual({
      action: ACTION_VIEW,
      data: 'content://provider//x.apk',
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      clipLabel: APK_CLIP_LABEL,
    });
    expect(APK_MIME_TYPE).toBe('application/vnd.android.package-archive');
    expect(APK_CLIP_LABEL).toBe('Ciallo Reader 安装包');
  });
});

describe('EncryptedSecretStore.kt：失败即拒绝', () => {
  const KT = kt('data/EncryptedSecretStore.kt');

  function memoryStore(initial: Record<string, string> = {}): SecureStore & {
    data: Map<string, string>;
    failSet: boolean;
  } {
    const data = new Map(Object.entries(initial));
    const store = {
      data,
      failSet: false,
      async get(key: string): Promise<string | null> {
        return data.get(key) ?? null;
      },
      async set(key: string, value: string): Promise<void> {
        if (store.failSet) throw new Error('keystore');
        data.set(key, value);
      },
      async remove(key: string): Promise<void> {
        data.delete(key);
      },
    };
    return store as unknown as SecureStore & { data: Map<string, string>; failSet: boolean };
  }

  function legacyStore(initial: Record<string, string>, options: { failRemove?: boolean } = {}) {
    const data = new Map(Object.entries(initial));
    const legacy: LegacySharedPreferences & { data: Map<string, string>; puts: number } = {
      data,
      puts: 0,
      getString: (key: string) => data.get(key) ?? null,
      edit: () => ({
        putString: (key: string, value: string) => {
          legacy.puts += 1;
          data.set(key, value);
          return true;
        },
        remove: (key: string) => {
          if (options.failRemove === true) return false;
          data.delete(key);
          return true;
        },
      }),
    };
    return legacy;
  }

  it('secure 不可用：read 返回 null，write 抛「系统安全存储不可用」', async () => {
    expect(KT).toContain('A failed keystore never permits a plaintext read or write.');
    expect(KT).toContain('val secure = prefs ?: return@synchronized null');
    expect(KT).toContain('val secure = prefs ?: error("系统安全存储不可用，无法保存 API 密钥")');
    const store = new EncryptedSecretStore(null);
    await expect(store.read('k')).resolves.toBeNull();
    await expect(store.write('k', 'v')).rejects.toThrow('系统安全存储不可用，无法保存 API 密钥');
  });

  it('read：命中最新的安全存储值就不再碰 legacy', async () => {
    const secure = memoryStore({ k: 'new' });
    const legacy = legacyStore({ k: 'old' });
    const store = new EncryptedSecretStore(secure, legacy);
    await expect(store.read('k')).resolves.toBe('new');
    expect(legacy.puts).toBe(0);
    expect(legacy.data.get('k')).toBe('old'); // 未被清理
  });

  it('read：安全存储没有时从 legacy 迁移一次并删除旧值', async () => {
    expect(KT).toContain('check(secure.edit().putString(key, old).commit()) { "密钥迁移失败" }');
    expect(KT).toContain('check(legacy.edit().remove(key).commit()) { "旧密钥清理失败" }');
    const secure = memoryStore();
    const legacy = legacyStore({ k: 'old' });
    const store = new EncryptedSecretStore(secure, legacy);
    await expect(store.read('k')).resolves.toBe('old');
    expect(secure.data.get('k')).toBe('old');
    expect(legacy.data.has('k')).toBe(false);
  });

  it('迁移写失败 / 旧值清理失败：都吞成 null（`runCatching{}.getOrNull()`）', async () => {
    expect(KT).toContain('}.getOrNull()');
    const failWrite = memoryStore();
    failWrite.failSet = true;
    await expect(new EncryptedSecretStore(failWrite, legacyStore({ k: 'old' })).read('k')).resolves.toBeNull();

    const failRemove = memoryStore();
    await expect(
      new EncryptedSecretStore(failRemove, legacyStore({ k: 'old' }, { failRemove: true })).read('k'),
    ).resolves.toBeNull();
  });

  it('write：值没变就不写；变了才写；写失败抛「API 密钥保存失败」', async () => {
    expect(KT).toContain('if (secure.getString(key, null) != value) check(secure.edit().putString(key, value).commit()) { "API 密钥保存失败" }');
    const secure = memoryStore({ k: 'same' });
    const store = new EncryptedSecretStore(secure);
    await store.write('k', 'same');
    expect(secure.data.get('k')).toBe('same');
    await store.write('k', 'next');
    expect(secure.data.get('k')).toBe('next');

    const failing = memoryStore();
    failing.failSet = true;
    await expect(new EncryptedSecretStore(failing).write('k', 'v')).rejects.toThrow('API 密钥保存失败');
  });

  it('remove 任何异常都吞掉（`runCatching { prefs?.edit()?.remove(key)?.apply() }`）', async () => {
    expect(KT).toContain('fun remove(key: String) { runCatching { prefs?.edit()?.remove(key)?.apply() } }');
    const secure = memoryStore({ k: 'v' });
    await new EncryptedSecretStore(secure).remove('k');
    expect(secure.data.has('k')).toBe(false);
    const broken = {
      get: async () => null,
      set: async () => undefined,
      remove: async () => {
        throw new Error('keystore');
      },
    } as unknown as SecureStore;
    await expect(new EncryptedSecretStore(broken).remove('k')).resolves.toBeUndefined();
    await expect(new EncryptedSecretStore(null).remove('k')).resolves.toBeUndefined();
  });
});

describe('FluidSliderCompose.kt：包装层的死参数与自己的 formatLabel', () => {
  const KT = readFileSync(
    androidReference('app/src/main/java/com/ramotion/fluidslider/FluidSliderCompose.kt'),
    'utf8',
  );

  it('12 个形参，但只转发 6 个给 LiquidSlider', () => {
    expect(KT).toContain('fun FluidSlider(');
    for (const param of [
      'position: Float',
      'onPositionChange: (Float) -> Unit',
      'onPositionChangeFinished: (() -> Unit)? = null',
      'onDraggingChange: ((Boolean) -> Unit)? = null',
      'modifier: Modifier = Modifier',
      'barHeightDp: Int = 48',
      'bubbleText: String? = null',
      'startText: String? = "0"',
      'endText: String? = "100"',
      'colorBar: Color = Color(0xFF6168E7)',
      'colorBubble: Color = Color.White',
      'colorBubbleText: Color = Color.Black',
      'colorBarText: Color = Color.White.copy(alpha = 0.7f)',
      'durationMillis: Int = 400',
    ]) {
      expect(KT).toContain(param);
    }

    // 转发块内只有这 6 个具名参数，barHeightDp / color* / durationMillis 都不在
    const callStart = KT.indexOf('LiquidSlider(');
    const callEnd = KT.indexOf(')', KT.indexOf('formatLabel'));
    const call = KT.slice(callStart, callEnd);
    for (const live of ['value =', 'onValueChange =', 'modifier =', 'onValueChangeFinished =', 'onDraggingChange =', 'formatLabel =']) {
      expect(call).toContain(live);
    }
    for (const dead of ['barHeightDp', 'startText', 'endText', 'colorBar', 'colorBubble', 'colorBubbleText', 'durationMillis']) {
      expect(call).not.toContain(dead);
    }
  });

  it('死参数的默认值只作记录，端口不提供可调入口', () => {
    expect(FLUID_SLIDER_COMPOSE_DEFAULTS).toEqual({
      barHeightDp: 48,
      startText: '0',
      endText: '100',
      colorBar: 0xff6168e7,
      colorBubble: 0xffffffff,
      colorBubbleText: 0xff000000,
      colorBarTextRgb: 0xffffff,
      colorBarTextAlpha: 0.7,
      durationMillis: 400,
    });
    // 库内常量与包装层默认值一致（所以「不转发」在默认情况下看不出来）
    expect(FLUID_SLIDER.COLOR_BAR).toBe(FLUID_SLIDER_COMPOSE_DEFAULTS.colorBar);
    expect(FLUID_SLIDER.ANIMATION_DURATION).toBe(FLUID_SLIDER_COMPOSE_DEFAULTS.durationMillis);
    expect(FLUID_SLIDER.TEXT_START).toBe(FLUID_SLIDER_COMPOSE_DEFAULTS.startText);
    expect(FLUID_SLIDER.TEXT_END).toBe(FLUID_SLIDER_COMPOSE_DEFAULTS.endText);
    // 但 barHeightDp 的默认 48 与库内 NORMAL 档不同 —— 这也证明它没被转发
    expect(FLUID_SLIDER_COMPOSE_DEFAULTS.barHeightDp).not.toBe(FLUID_SLIDER.SLIDER_WIDTH * 0 + 56);
  });

  it('formatLabel 是 `roundToInt` + `%`，与库内的截断标签**不是**同一个函数', () => {
    expect(KT).toContain('formatLabel = { bubbleText ?: "${(it * 100).roundToInt()}%" }');

    // 包装层：四舍五入 + %
    expect(fluidSliderPercentLabel(0)).toBe('0%');
    expect(fluidSliderPercentLabel(0.5)).toBe('50%');
    expect(fluidSliderPercentLabel(0.126)).toBe('13%');
    expect(fluidSliderPercentLabel(0.124)).toBe('12%');
    expect(fluidSliderPercentLabel(1)).toBe('100%');
    // 越界按库内语义夹到 0..1
    expect(fluidSliderPercentLabel(1.7)).toBe('100%');
    expect(fluidSliderPercentLabel(-0.2)).toBe('0%');
    // 外部给了 bubbleText 就原样用
    expect(fluidSliderPercentLabel(0.5, '无限')).toBe('无限');
    expect(fluidSliderPercentLabel(0.5, '')).toBe('');

    // 库内：截断、无 %
    expect(fluidSliderBubbleText(0.126)).toBe('12');
    expect(fluidSliderBubbleText(0.5)).toBe('50');
    // 两者在 0.126 上必须不同（这正是本轮补的东西）
    expect(fluidSliderPercentLabel(0.126)).not.toBe(fluidSliderBubbleText(0.126));
    expect(fluidSliderPercentLabel(0.126)).toBe(`${fluidSliderBubbleText(0.126).replace('12', '13')}%`);
  });
});
