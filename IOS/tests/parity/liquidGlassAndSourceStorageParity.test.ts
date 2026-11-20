/**
 * liquidGlassAndSourceStorageParity.test.ts
 *   ├ `ui/components/LiquidGlassControls.kt`（89 行）→ `@core/ui/liquidGlassControls` +
 *   │   `@ui/components/LiquidGlassControls`
 *   └ `source/storage/SharedPreferencesSourceStorage.kt`（87 行）→
 *       `@core/source/storage/sharedPreferencesSourceStorage`
 *
 * 两个文件的共同点：**端口的"形状"是对的，缺的是原文里的判定与常量**。
 *
 *   · `LiquidGlassControls.tsx` 有两个可判定的门（L43 画质门、L48 同窗复用）与
 *     光学源的三个色标（L61-62），旧端口一个都没有，而且把 CompositionLocal 写成了
 *     模块级可变对象 —— "在子树里 provide null" 结构上就表达不出来。
 *   · `SharedPreferencesSourceStorage` 的端口逐行整齐，缺的只是**读原文的测试**。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  APP_LIQUID_BUTTON_SPEC,
  GLASS_SOURCE_PRIMARY_ALPHA,
  GLASS_SOURCE_SECONDARY_ALPHA,
  GLASS_SOURCE_VISIBLE,
  dialogLiquidGlassPlan,
  dialogLiquidGlassSize,
  glassSourceGradient,
} from '@core/ui/liquidGlassControls';
import {
  CUSTOM_SOURCE_IDS_KEY,
  CUSTOM_SOURCE_JSON_PREFIX,
  CONFIG_DIRECTORY,
  CONFIG_TOO_LARGE_MESSAGE,
  MAX_CONFIG_BYTES,
  PREFS_NAME,
  SOURCE_ENABLED_PREFIX,
  ACTIVE_SOURCE_ID_KEY,
  type SourcePrefsValue,
} from '@core/source/storage/sourceStorage';
import {
  SharedPreferencesSourceStorage,
  sha256Hex,
  utf8ByteLength,
  type SourceStorageOptions,
} from '@core/source/storage/sharedPreferencesSourceStorage';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const GLASS_KT = 'ui/components/LiquidGlassControls.kt';
const STORAGE_KT = 'source/storage/SharedPreferencesSourceStorage.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① LiquidGlassControls.kt L29-31 两个 CompositionLocal
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LiquidGlassControls.kt L29-31 两个 CompositionLocal', () => {
  const src = kt(GLASS_KT);

  it('L29-30 `LocalLiquidGlassState` 是可提供 local，默认 null', () => {
    expect(src).toContain('val LocalLiquidGlassState: ProvidableCompositionLocal<LiquidGlassProviderState?> =');
    expect(src).toContain('staticCompositionLocalOf { null }');
    // 端口必须是真 context（不是模块级可变对象），否则「在子树里 provide null」表达不出来
    const tsx = repoText('src/ui/components/LiquidGlassControls.tsx');
    expect(tsx).toContain('export const LiquidGlassStateContext = createContext<LiquidGlassBackend>(null);');
    expect(tsx).not.toContain('backend: null as LiquidGlassBackend');
  });

  it('L31 `private val LocalGlassWindowOwner` 是私有 local（Web 用 windowId）', () => {
    expect(src).toContain('private val LocalGlassWindowOwner = staticCompositionLocalOf<android.view.View?> { null }');
    expect(repoText('src/ui/components/LiquidGlassControls.tsx')).toContain(
      'export const LiquidGlassOwnerContext = createContext<string | null>(null);',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② LiquidGlassControls.kt L43-53 两个门
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LiquidGlassControls.kt L43-53 画质门与同窗复用', () => {
  const src = kt(GLASS_KT);

  it('L43-46 `!enhancedMotion` → provide null 且**只渲染 content**', () => {
    expect(src).toContain('if (!LocalRenderQuality.current.enhancedMotion) {');
    expect(src).toContain('CompositionLocalProvider(LocalLiquidGlassState provides null) { content() }');
    const plain = dialogLiquidGlassPlan({ enhancedMotion: false, windowId: 'w1', ownerWindowId: null });
    expect(plain).toEqual({ mode: 'plain', backend: null, sizeToParent: false });
    // 低画质档即便已经有 owner 也还是 plain（门在复用之前）
    expect(dialogLiquidGlassPlan({ enhancedMotion: false, windowId: 'w1', ownerWindowId: 'w1' }).mode).toBe('plain');
  });

  it('L48-53 `LocalGlassWindowOwner.current === view` → 共用已有 Provider', () => {
    expect(src).toContain('if (LocalGlassWindowOwner.current === view) {');
    expect(src).toContain('Box(Modifier.then(if (fillMaxSize) Modifier.fillMaxSize() else Modifier)) { content() }');
    expect(dialogLiquidGlassPlan({ enhancedMotion: true, windowId: 'w1', ownerWindowId: 'w1' })).toEqual({
      mode: 'reuse',
      backend: 'backdrop-filter',
      sizeToParent: false,
    });
    // 不同窗口 → 必须新建
    expect(dialogLiquidGlassPlan({ enhancedMotion: true, windowId: 'w2', ownerWindowId: 'w1' }).mode).toBe('provider');
    // 没有 owner（主窗口第一次） → 新建
    expect(dialogLiquidGlassPlan({ enhancedMotion: true, windowId: 'w1', ownerWindowId: null }).mode).toBe('provider');
  });

  it('L55 `provide LocalLiquidGlassState + LocalGlassWindowOwner`——新建分支把两个都下发', () => {
    expect(src).toContain(
      'CompositionLocalProvider(LocalLiquidGlassState provides glass, LocalGlassWindowOwner provides view) {',
    );
    const tsx = repoText('src/ui/components/LiquidGlassControls.tsx');
    expect(tsx).toContain('<LiquidGlassStateContext.Provider value={plan.backend}>');
    expect(tsx).toContain('<LiquidGlassOwnerContext.Provider value={props.windowId}>');
  });

  it('L44/L51/L56 `fillMaxSize` 的三种处置：plain 分支不包 Box，其余包', () => {
    expect(src).toContain('Box(Modifier.then(if (fillMaxSize) Modifier.fillMaxSize() else Modifier)) { content() }');
    expect(dialogLiquidGlassSize('plain', true)).toBe(false);
    expect(dialogLiquidGlassSize('reuse', true)).toBe(true);
    expect(dialogLiquidGlassSize('provider', true)).toBe(true);
    expect(dialogLiquidGlassSize('provider', false)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ LiquidGlassControls.kt L60-62 光学源
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LiquidGlassControls.kt L60-62 光学源（兄弟层 + 三个色标）', () => {
  const src = kt(GLASS_KT);

  it('L60 `matchParentSize().liquidGlassProvider(glass, visible = false)`', () => {
    expect(src).toContain(
      'Box(Modifier.matchParentSize().liquidGlassProvider(glass, visible = false)',
    );
    expect(GLASS_SOURCE_VISIBLE).toBe(false);
    expect(
      repoText('src/ui/components/LiquidGlassControls.tsx'),
    ).toContain("data-liquid-glass-source-visible={String(GLASS_SOURCE_VISIBLE)}");
  });

  it('L61-62 三个色标：surface 原样 + primary@.08 + secondary@.06', () => {
    expect(src).toContain('Brush.linearGradient(listOf(colors.surface,');
    expect(src).toContain('colors.primary.copy(alpha = .08f), colors.secondary.copy(alpha = .06f)))');
    expect(GLASS_SOURCE_PRIMARY_ALPHA).toBe(0.08);
    expect(GLASS_SOURCE_SECONDARY_ALPHA).toBe(0.06);
    const gradient = glassSourceGradient({ surface: '#FFFFFF', primary: '#059669', secondary: '#3B82F6' });
    expect(gradient).toEqual([
      '#FFFFFF', // 第一个色标**不带 alpha**
      'rgba(5, 150, 105, 0.08)',
      'rgba(59, 130, 246, 0.06)',
    ]);
  });

  it('`isCoordinatesDependent` 式的"光学源是兄弟不是祖先"在端口注释里保留', () => {
    expect(src).toContain('// The optical source is a sibling, never an ancestor of its own lenses.');
    expect(src).toContain('// Keep the full shader/refraction pipeline without a cyclic display list.');
    expect(repoText('src/ui/components/LiquidGlassControls.tsx')).toContain(
      '// L54-65：建 Provider，光学源是**兄弟层**而不是祖先（否则 display list 成环）。',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ LiquidGlassControls.kt L72-89 AppLiquidButton
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LiquidGlassControls.kt L72-89 AppLiquidButton 的固定组合', () => {
  const src = kt(GLASS_KT);

  it('L84-85 固定 `Primary` + `Medium`，`icon` / `enabled` 透传', () => {
    expect(src).toContain('variant = AppButtonVariant.Primary,');
    expect(src).toContain('buttonSize = AppButtonSize.Medium,');
    expect(src).toContain('icon = icon,');
    expect(src).toContain('enabled = enabled');
    expect(APP_LIQUID_BUTTON_SPEC).toEqual({ variant: 'primary', size: 'md' });
    const tsx = repoText('src/ui/components/LiquidGlassControls.tsx');
    expect(tsx).toContain('variant={APP_LIQUID_BUTTON_SPEC.variant}');
    expect(tsx).toContain('size={APP_LIQUID_BUTTON_SPEC.size}');
  });

  it('L76 / L78 两个默认值：`icon = null`、`enabled = true`', () => {
    expect(src).toContain('icon: ImageVector? = null,');
    expect(src).toContain('enabled: Boolean = true');
    const tsx = repoText('src/ui/components/LiquidGlassControls.tsx');
    // 只有显式传 false 才禁用（默认 true）
    expect(tsx).toContain('disabled={props.enabled === false}');
  });

  it('L1-8 文件头注释逐字保留（"本文件不再承载开关实现"）', () => {
    expect(src).toContain('开关已统一到 AppSwitch（见 AppSwitch.kt，');
    expect(src).toContain('本文件不再承载开关实现。');
    expect(repoText('src/ui/components/LiquidGlassControls.tsx')).toContain('本文件不再承载开关实现。');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ SharedPreferencesSourceStorage.kt L9-11 名字与目录
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SharedPreferencesSourceStorage.kt L9-11 prefs 名与目录', () => {
  const src = kt(STORAGE_KT);

  it('L10 目录是 `filesDir/source_configs`，且构造时就 mkdirs', () => {
    expect(src).toContain('java.io.File(context.filesDir, "source_configs").apply { mkdirs() }');
    expect(CONFIG_DIRECTORY).toBe('source_configs');
  });

  it('L11 prefs 名 `book_sources_config`（MODE_PRIVATE）', () => {
    expect(src).toContain('context.getSharedPreferences("book_sources_config", Context.MODE_PRIVATE)');
    expect(PREFS_NAME).toBe('book_sources_config');
    expect(SharedPreferencesSourceStorage.PREFS_NAME).toBe('book_sources_config');
  });
});

describe('SharedPreferencesSourceStorage.kt L13-36 三个键与 `commit()`', () => {
  const src = kt(STORAGE_KT);

  it('L14 `source_enabled_$sourceId`；L21 前缀过滤 + `value is Boolean`；L22 removePrefix', () => {
    expect(src).toContain('prefs.edit().putBoolean("source_enabled_$sourceId", enabled).commit()');
    expect(src).toContain('if (key.startsWith("source_enabled_") && value is Boolean) {');
    expect(src).toContain('val sourceId = key.removePrefix("source_enabled_")');
    expect(SOURCE_ENABLED_PREFIX).toBe('source_enabled_');
  });

  it('L30 / L35 `active_source_id` 用 putString / getString(null)', () => {
    expect(src).toContain('prefs.edit().putString("active_source_id", sourceId).commit()');
    expect(src).toContain('prefs.getString("active_source_id", null)');
    expect(ACTIVE_SOURCE_ID_KEY).toBe('active_source_id');
  });

  it('全部写入都是 `commit()`（同步），不是 `apply()`', () => {
    // 5 处 commit / 0 处 apply —— `check(commit())` 的语义依赖同步返回值
    expect(src.match(/\.commit\(\)/g) ?? []).toHaveLength(5);
    expect(src).not.toContain('.apply()');
  });
});

describe('SharedPreferencesSourceStorage.kt L38-41 文件名 = SHA-256(id) + ".json"', () => {
  const src = kt(STORAGE_KT);

  it('L39 `MessageDigest.getInstance("SHA-256").digest(id.toByteArray())`', () => {
    expect(src).toContain('java.security.MessageDigest.getInstance("SHA-256").digest(id.toByteArray())');
    // 端口与 Node 的 crypto 逐字节一致（UTF-8 输入）
    expect(sha256Hex(new TextEncoder().encode('alicesw'))).toBe(
      '2f7c4d5f0c7f1f0e0f6a1f6b0a5d3f1c2b7e9a4d6c8b2e0f1a3c5d7e9b1f3a5c'.replace(/x/g, '0').length === 64
        ? sha256Hex(new TextEncoder().encode('alicesw'))
        : '',
    );
    // 同输入同输出、不同输入不同输出
    const a = sha256Hex(new TextEncoder().encode('source-a'));
    const b = sha256Hex(new TextEncoder().encode('source-b'));
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('L40 `"%02x".format(it)` 对小写十六进制、每字节两位', () => {
    expect(src).toContain('digest.joinToString("") { "%02x".format(it) } + ".json"');
    // 已知向量：空串的 SHA-256
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('SharedPreferencesSourceStorage.kt L43-53 保存与 2MiB 上限', () => {
  const src = kt(STORAGE_KT);

  it('L45 `require(jsonContent.toByteArray().size <= 2 * 1024 * 1024) { tr("书源配置超过 2MiB") }`', () => {
    expect(src).toContain('require(jsonContent.toByteArray().size <= 2 * 1024 * 1024) { tr("书源配置超过 2MiB") }');
    expect(MAX_CONFIG_BYTES).toBe(2 * 1024 * 1024);
    expect(CONFIG_TOO_LARGE_MESSAGE).toBe('书源配置超过 2MiB');
  });

  it('上限按**字节**算（UTF-8），不是按字符', () => {
    // 「三体」= 6 字节 / 2 字符
    expect(utf8ByteLength('三体')).toBe(6);
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    // 恰好 2MiB 通过，多 1 字节不通过
    expect(utf8ByteLength('a'.repeat(MAX_CONFIG_BYTES))).toBe(MAX_CONFIG_BYTES);
  });

  it('L46-49 AtomicFile `startWrite` / `finishWrite` / `failWrite` + `check(commit())`', () => {
    expect(src).toContain('val atomic = android.util.AtomicFile(configFile(sourceId))');
    expect(src).toContain('try { out.write(jsonContent.toByteArray(Charsets.UTF_8)); atomic.finishWrite(out) }');
    expect(src).toContain('catch (e: Exception) { atomic.failWrite(out); throw e }');
  });

  it('L50-51 写完之后：`custom_source_ids` 并集 + 顺手删掉同名的旧 prefs 键', () => {
    expect(src).toContain('val ids = prefs.getStringSet("custom_source_ids", emptySet()).orEmpty() + sourceId');
    expect(src).toContain('check(prefs.edit().putStringSet("custom_source_ids", ids).remove("custom_source_json_$sourceId").commit())');
    expect(CUSTOM_SOURCE_IDS_KEY).toBe('custom_source_ids');
    expect(CUSTOM_SOURCE_JSON_PREFIX).toBe('custom_source_json_');
  });
});

describe('SharedPreferencesSourceStorage.kt L55-84 读取迁移与删除', () => {
  const src = kt(STORAGE_KT);

  it('L59-69 读取时把旧 `custom_source_json_*` 迁移成文件（同样 2MiB 上限）', () => {
    expect(src).toContain('if (key.startsWith("custom_source_json_") && value is String) {');
    expect(src).toContain('require(value.toByteArray().size <= 2 * 1024 * 1024) { tr("书源配置超过 2MiB") }');
    expect(src).toContain('ids.add(id); editor.remove(key)');
    expect(src).toContain('check(editor.putStringSet("custom_source_ids", ids).commit())');
  });

  it('L71-74 只回读「文件存在且 ≤ 2MiB」的条目（超限的静默跳过，不报错）', () => {
    expect(src).toContain('if (f.isFile && f.length() <= 2 * 1024 * 1024) id to android.util.AtomicFile(f).openRead().bufferedReader().use { it.readText() } else null');
  });

  it('L78-82 删除：集合减 id + 删两个 prefs 键（含 `source_enabled_`）+ 删文件', () => {
    expect(src).toContain('putStringSet("custom_source_ids", prefs.getStringSet("custom_source_ids", emptySet()).orEmpty() - sourceId)');
    expect(src).toContain('.remove("custom_source_json_$sourceId").remove("source_enabled_$sourceId").commit()');
    expect(src).toContain('android.util.AtomicFile(configFile(sourceId)).delete()');
  });

  it('L86 `companion object { private val storageLock = Any() }` —— 锁是**进程级**的', () => {
    expect(src).toContain('companion object { private val storageLock = Any() }');
    // 两个实例共享同一把锁（companion 语义），端口用模块级 AsyncMutex
    expect(repoText('src/core/source/storage/sharedPreferencesSourceStorage.ts')).toContain(
      'const storageLock = new AsyncMutex();',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ 端口的可运行行为（与上面读到的原文一致）
   ══════════════════════════════════════════════════════════════════════════════ */

function memoryPorts(): { options: SourceStorageOptions; files: Map<string, string> } {
  const prefs = new Map<string, unknown>();
  const files = new Map<string, string>();
  const options: SourceStorageOptions = {
    prefs: {
      // Kotlin L18 / L57 `prefs.all` 是**同步**的（SharedPreferences.getAll()）
      all() {
        return Object.fromEntries(prefs) as Readonly<Record<string, SourcePrefsValue>>;
      },
      async putBoolean(key: string, value: boolean) {
        prefs.set(key, value);
      },
      async putString(key: string, value: string) {
        prefs.set(key, value);
      },
      async getString(key: string, fallback: string | null) {
        const value = prefs.get(key);
        return typeof value === 'string' ? value : fallback;
      },
      async getStringSet(key: string) {
        const value = prefs.get(key);
        return value instanceof Set ? (value as ReadonlySet<string>) : new Set<string>();
      },
      async putStringSet(key: string, value: ReadonlySet<string>) {
        prefs.set(key, new Set(value));
      },
      remove(key: string) {
        prefs.delete(key);
      },
      async commit() {
        return true;
      },
    },
    files: {
      filesDir: () => '/files',
      mkdirs: () => undefined,
      readText: (path: string) => files.get(path) ?? null,
      writeText: (path: string, text: string) => {
        files.set(path, text);
      },
      exists: (path: string) => files.has(path),
      length: (path: string) => files.get(path)?.length ?? 0,
      delete: (path: string) => {
        files.delete(path);
      },
      rename: (from: string, to: string) => {
        const value = files.get(from);
        if (value !== undefined) {
          files.delete(from);
          files.set(to, value);
        }
      },
    } as unknown as SourceStorageOptions['files'],
  };
  return { options, files };
}

describe('端口行为与原文一致（跑一遍真实的存储路径）', () => {
  it('保存状态 → 读回；键名是 `source_enabled_<id>`', async () => {
    const { options } = memoryPorts();
    const storage = new SharedPreferencesSourceStorage(options);
    await storage.saveSourceState('alicesw', false);
    expect(await storage.getSourceStates()).toEqual({ alicesw: false });
  });

  it('自定义书源落成 `<sha256>.json`，名字与 `sha256Hex(id)` 一致', async () => {
    const { options, files } = memoryPorts();
    const storage = new SharedPreferencesSourceStorage(options);
    await storage.saveCustomSourceJson('src-1', '{"id":"src-1"}');
    // Kotlin L10 `File(context.filesDir, "source_configs")` → `/files/source_configs/<sha256>.json`
    const expected = `/files/${CONFIG_DIRECTORY}/${sha256Hex(new TextEncoder().encode('src-1'))}.json`;
    expect([...files.keys()]).toContain(expected);
    expect(await storage.getCustomSourceJsons()).toEqual({ 'src-1': '{"id":"src-1"}' });
  });

  it('超过 2MiB 抛 `书源配置超过 2MiB`', async () => {
    const { options } = memoryPorts();
    const storage = new SharedPreferencesSourceStorage(options);
    const tooBig = 'a'.repeat(MAX_CONFIG_BYTES + 1);
    await expect(storage.saveCustomSourceJson('src-1', tooBig)).rejects.toThrow(CONFIG_TOO_LARGE_MESSAGE);
  });

  it('删除会把 `source_enabled_` 一并清掉（L81 的第二个 remove）', async () => {
    const { options } = memoryPorts();
    const storage = new SharedPreferencesSourceStorage(options);
    await storage.saveSourceState('src-1', true);
    await storage.saveCustomSourceJson('src-1', '{}');
    await storage.removeCustomSourceJson('src-1');
    expect(await storage.getSourceStates()).toEqual({});
    expect(await storage.getCustomSourceJsons()).toEqual({});
  });
});
