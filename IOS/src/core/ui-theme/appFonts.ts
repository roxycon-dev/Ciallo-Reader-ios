/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/AppFonts.kt`
 *             (147 lines incl. trailing newline, 130 non-blank)
 *          → `src/core/ui-theme/appFonts.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`               → SKIPPED (TS has no packages)
 *   L2        (blank)                                       → SKIPPED
 *   L3        `import androidx.compose.ui.text.font.Font`   → SKIPPED: a Compose `Font` is a
 *                                                             `(resId, weight)` pair resolved by
 *                                                             the Android resource loader. On the web
 *                                                             a family is a CSS `@font-face` +
 *                                                             `font-family` name; see
 *                                                             `WebFontFace` below.
 *   L4        `import …font.FontFamily`                     → a CSS `font-family` stack string
 *   L5        `import …font.FontWeight`                     → the `weight` member of `WebFontFace`
 *   L6        `import com.example.R`                        → SKIPPED: no Android R class on the web.
 *                                                             The asset names are kept verbatim in
 *                                                             `NOTO_SANS_SC_FILE` / `NOTO_SERIF_SC_FILE`
 *   L7        (blank)                                       → SKIPPED
 *   L8-39     the long KDoc (why the families were converged  → kept verbatim in condensed form;
 *             onto one exit, why the system generic families  the SIL OFL 1.1 / subset / size /
 *             differ per OEM, the two-step plan, and the     faux-bold note and the reading-body
 *             "本次改动：阅读正文改为自带字体" section)       → switch are all preserved below
 *   L40       `object AppFonts {`                           → `APP_FONTS` (a frozen record) +
 *                                                             the `AppFontName` union
 *   L41       (blank)                                       → SKIPPED
 *   L42-45    the `// ── 〇、打包字体装配 …` banner           → kept verbatim as a comment
 *   L46       KDoc  界面 / 阅读共用的 Noto Sans SC …       → kept verbatim
 *   L47       `private val uiSans: FontFamily = runCatching {` → `uiSans` is unconditional on the
 *                                                             web: see the "ADAPTATION" note below
 *   L48       `require(R.font.noto_sans_sc_regular != 0) { "font resource stripped" }`
 *                                                             → the `@font-face` `src` is a URL the
 *                                                             browser resolves lazily; a missing /
 *                                                             stripped file simply never loads and
 *                                                             the next family in the stack is used.
 *                                                             The *literal* "font resource stripped"
 *                                                             message is preserved on
 *                                                             `FONT_RESOURCE_STRIPPED`.
 *   L49-53    `FontFamily(Font(resId = …, Normal), Font(resId = …, Bold))` (L51 comment kept)
 *                                                             → `NOTO_SANS_SC_FACES` — the same file
 *                                                             registered at both weights, i.e. faux bold
 *   L54       `}.getOrDefault(FontFamily.SansSerif)`        → the fallback is the second entry of the
 *                                                             CSS stack (`system-ui, sans-serif`)
 *   L55       (blank)                                       → SKIPPED
 *   L56       KDoc  界面 / 阅读共用的 Noto Serif SC …     → kept verbatim
 *   L57-63    `uiSerif` (`FontFamily.Serif` fallback)       → `NOTO_SERIF_SC_FACES` + `serif` tail
 *   L64       (blank)                                       → SKIPPED
 *   L65-67    the `// ── 一、界面字族 …` banner + heading   → kept verbatim
 *   L68-81    the "背景：v1.1.0 之前 …" / "现在界面字族 …" / 注意 block → kept verbatim
 *   L82       (blank)                                       → SKIPPED
 *   L83       KDoc  界面默认体 …                           → kept verbatim
 *   L84       `val Default: FontFamily = uiSans`            → `APP_FONTS.Default`
 *   L85       (blank)                                       → SKIPPED
 *   L86       KDoc  衬线体：书籍标题 …                    → kept verbatim
 *   L87       `val Serif: FontFamily = uiSerif`             → `APP_FONTS.Serif`
 *   L88       (blank)                                       → SKIPPED
 *   L89       KDoc  黑体 / 无衬线 …                        → kept verbatim
 *   L90       `val SansSerif: FontFamily = uiSans`          → `APP_FONTS.SansSerif`
 *   L91       (blank)                                       → SKIPPED
 *   L92       KDoc  等宽体：JSON 书源示例 …               → kept verbatim
 *   L93       `val Monospace: FontFamily = FontFamily.Monospace` → `APP_FONTS.Monospace`
 *   L94       (blank)                                       → SKIPPED
 *   L95-97    the `// ── 二、阅读正文字族 …` banner         → kept verbatim
 *   L98       (blank)                                       → SKIPPED
 *   L99       KDoc  阅读用衬线体：res/font/noto_serif_sc_regular.otf …  → kept verbatim
 *   L100      `val ReadingSerif: FontFamily = uiSerif`      → `APP_FONTS.ReadingSerif`
 *   L101      (blank)                                       → SKIPPED
 *   L102      KDoc  阅读用黑体：res/font/noto_sans_sc_regular.otf …  → kept verbatim
 *   L103      `val ReadingSansSerif: FontFamily = uiSans`   → `APP_FONTS.ReadingSansSerif`
 *   L104-106  the `// ── 三、阅读器「字体」设置档位表` banner → kept verbatim
 *   L107      (blank)                                       → SKIPPED
 *   L109-123  the `readingFontFamilies` KDoc (the ids are   → kept verbatim; the "不可重排" rule is
 *             persisted values, 只准往后追加, id = 4 is the  → enforced by `tests/unit/uiThemeAppFonts`
 *             custom tier and is NOT in this table)          and by `assertReadingFontIds` below
 *   L124      `fun readingFontFamilies(): List<Triple<Int, String, FontFamily>>`
 *                                                             → `readingFontFamilies()`
 *   L125      `listOf(`                                     → the array literal
 *   L126      `Triple(0, "默认字体", ReadingSansSerif)`      → verbatim
 *   L127      `Triple(1, "衬线体", ReadingSerif)`            → verbatim
 *   L128      `Triple(2, "黑体", ReadingSansSerif)`          → verbatim
 *   L129      `Triple(3, "等宽体", Monospace)`               → verbatim
 *   L130      `)` / L131 `}`                                 → n/a
 *   L132-137  the `readingFontFamily` KDoc (@param index,    → kept verbatim
 *             @param custom)                                →
 *   L138      `fun readingFontFamily(index: Int, custom: FontFamily?): FontFamily`
 *                                                             → `readingFontFamily(index, custom)`
 *   L139      `when (index) {`                              → the `switch`
 *   L140      `1 -> ReadingSerif`                            → verbatim
 *   L141      `2 -> ReadingSansSerif`                        → verbatim
 *   L142      `3 -> Monospace`                               → verbatim
 *   L143      `4 -> custom ?: ReadingSansSerif`              → verbatim
 *   L144      `else -> ReadingSansSerif`                     → verbatim
 *   L145      `}` / L146 `}`                                 → n/a
 *
 * ── ADAPTATION — a Compose `FontFamily` → a CSS `font-family` stack ───────────
 *   Compose resolves `FontFamily.Default / Serif / SansSerif / Monospace` to whatever the
 *   OEM ships, which is exactly the inconsistency this file exists to kill. On the web the
 *   equivalent failure mode is `system-ui` / `-apple-system` resolving to San Francisco /
 *   PingFang SC instead of the bundled Noto subset. The stacks below therefore put the bundled
 *   webfont FIRST and only then the platform face, which is the same order as the existing
 *   `src/styles/theme.css` L66-67 (`--font-sans` / `--font-serif`) and
 *   `src/ui/tokens.ts` L60-61. The Kotlin `FontFamily.Monospace` fallback stays the system
 *   monospace family — "保持系统等宽族（跨机型差异小、省体积）".
 *
 * ── DIVERGENCE vs the already-ported `src/core/reader/readerScreenLogic.ts` ──
 *   That module carries the same table (L341-346 `READING_FONT_FAMILIES`, L362+
 *   `readingFontFamilyCss`). Its values are IDENTICAL, including all four Chinese labels, the
 *   0/1/2/3 ids, and the index-4 → custom-or-Noto rule. The only difference is that it stores
 *   the resolved CSS string per row whereas this file resolves through the family registry.
 *   Left untouched (outside this port's write scope); flagged so the two can be merged later.
 */

/** Android `res/font/noto_sans_sc_regular.otf` — the Kotlin `R.font` name, verbatim. */
export const NOTO_SANS_SC_FILE = 'noto_sans_sc_regular.otf';

/** Android `res/font/noto_serif_sc_regular.otf` — the Kotlin `R.font` name, verbatim. */
export const NOTO_SERIF_SC_FILE = 'noto_serif_sc_regular.otf';

/**
 * Kotlin L48 `require(...) { "font resource stripped" }` — preserved as an exported literal so a
 * host that *does* validate the bundled asset can report the same text. The web port never
 * throws: a stripped file just makes the browser fall through to the next family in the stack,
 * which is the same net result as Kotlin's `.getOrDefault(FontFamily.SansSerif)`.
 */
export const FONT_RESOURCE_STRIPPED = 'font resource stripped';

/**
 * One `@font-face` registration. Android registers the **same file** in the Normal and the Bold
 * slot, so Bold / SemiBold / Medium are all rendered by synthetic emboldening (faux bold) —
 * `AppFonts.kt` L51 and L77-79. CSS does the same when only a `400` face is declared, so
 * `weight: 700` on this family is synthesised rather than a real bold cut.
 */
export interface WebFontFace {
  /** Kotlin `Font(resId = …)`. */
  readonly file: string;
  /** Kotlin `Font(weight = …)`. */
  readonly weight: number;
}

/** Kotlin L49-53. */
export const NOTO_SANS_SC_FACES: readonly WebFontFace[] = [
  { file: NOTO_SANS_SC_FILE, weight: 400 },
  // 子集无独立 Bold 文件：注册同文件到 Bold 槽位，粗体走合成加粗
  { file: NOTO_SANS_SC_FILE, weight: 700 },
];

/** Kotlin L58-62. */
export const NOTO_SERIF_SC_FACES: readonly WebFontFace[] = [
  { file: NOTO_SERIF_SC_FILE, weight: 400 },
  { file: NOTO_SERIF_SC_FILE, weight: 700 },
];

/**
 * 界面 / 阅读共用的 Noto Sans SC（Normal + Bold 两个槽位指向同一文件）。
 * The `SansSerif` tail is Kotlin's `.getOrDefault(FontFamily.SansSerif)` (`AppFonts.kt` L54).
 */
export const NOTO_SANS_SC_STACK =
  '"Noto Sans SC", "PingFang SC", "Helvetica Neue", sans-serif';

/** 界面 / 阅读共用的 Noto Serif SC（Normal + Bold）. Tail = `.getOrDefault(FontFamily.Serif)`. */
export const NOTO_SERIF_SC_STACK = '"Noto Serif SC", "Songti SC", Georgia, serif';

/**
 * 等宽体：JSON 书源示例、代码、对齐要求高的数值。保持系统等宽族（跨机型差异小、省体积）。
 *
 * Android's `FontFamily.Monospace` maps to `/system/fonts/*Mono*.ttf`. The web's system
 * monospace is platform-named, so the three usual physical faces are listed in the same order
 * `src/styles/theme.css` and `src/core/reader/readerScreenLogic.ts` L339 already use.
 */
export const MONOSPACE_STACK = '"SF Mono", "Roboto Mono", Menlo, monospace';

/** The six public families of Kotlin `object AppFonts` (L84/87/90/93/100/103). */
export type AppFontName =
  | 'Default'
  | 'Serif'
  | 'SansSerif'
  | 'Monospace'
  | 'ReadingSerif'
  | 'ReadingSansSerif';

export type AppFontFamily = Readonly<Record<AppFontName, string>>;

/**
 * 全 App 字体族的**唯一出口**。`uiSans` / `uiSerif` are the private packed families
 * (`AppFonts.kt` L47 / L57); everything public aliases them.
 *
 * 注意：**不要**在业务代码里重新出现 `FontFamily.XXX` 字面量，一律走这里。
 */
export const APP_FONTS: AppFontFamily = {
  /** 界面默认体（正文、按钮、列表等一切 chrome）= Noto Sans SC。 */
  Default: NOTO_SANS_SC_STACK,
  /** 衬线体：书籍标题、封面书名、四 Tab 页大标题 = Noto Serif SC。 */
  Serif: NOTO_SERIF_SC_STACK,
  /** 黑体 / 无衬线 = Noto Sans SC（与 [Default] 同族）。 */
  SansSerif: NOTO_SANS_SC_STACK,
  /** 等宽体：JSON 书源示例、代码、对齐要求高的数值。保持系统等宽族（跨机型差异小、省体积）。 */
  Monospace: MONOSPACE_STACK,
  /** 阅读用衬线体：`res/font/noto_serif_sc_regular.otf`。加载失败退回系统衬线族。 */
  ReadingSerif: NOTO_SERIF_SC_STACK,
  /** 阅读用黑体：`res/font/noto_sans_sc_regular.otf`。加载失败退回系统无衬线族。 */
  ReadingSansSerif: NOTO_SANS_SC_STACK,
};

/** One row of `readingFontFamilies()` — Kotlin `Triple<Int, String, FontFamily>`. */
export interface ReadingFontFamily {
  /** Kotlin `Triple.first` — the persisted `prefs.fontFamilyIndex` value. */
  readonly id: number;
  /** Kotlin `Triple.second`. */
  readonly label: string;
  /** Kotlin `Triple.third`. */
  readonly family: string;
}

/**
 * 阅读器「字体」设置里的**内置档位**表（id 与 `prefs.fontFamilyIndex` 一一对应，
 * **不可重排**）。
 *
 * 注意：`Triple.first` 是写进 SharedPreferences 的存档值，已有用户的
 * `fontFamilyIndex` 就靠它解读 —— 只准往后追加，绝不能调整顺序或改名。
 * 「自定义字体」档（id = 4）在 ReaderScreen 里单独渲染（要带「+导入」按钮），
 * 不在此表中。
 *
 * 档位映射（0 / 1 / 2 走打包字体，3 等宽保留系统通用族）：
 *  - 0 默认字体 → Noto Sans SC（与改前的系统 sans-serif 观感一致）
 *  - 1 衬线体   → Noto Serif SC
 *  - 2 黑体     → Noto Sans SC
 *  - 3 等宽体   → 系统等宽族（等宽场景对字形一致性要求低，且省体积）
 */
export function readingFontFamilies(): readonly ReadingFontFamily[] {
  return [
    { id: 0, label: '默认字体', family: APP_FONTS.ReadingSansSerif },
    { id: 1, label: '衬线体', family: APP_FONTS.ReadingSerif },
    { id: 2, label: '黑体', family: APP_FONTS.ReadingSansSerif },
    { id: 3, label: '等宽体', family: APP_FONTS.Monospace },
  ];
}

/**
 * 按 `prefs.fontFamilyIndex` 取实际字体族。
 *
 * @param index 用户选择的档位 id
 * @param custom 用户自定义字体；index == 4 时使用（Kotlin 原样走
 *               `Typeface.createFromFile`，即用户选的文件；web 端由调用方传入该族的 CSS 栈）
 */
export function readingFontFamily(index: number, custom: string | null): string {
  switch (index) {
    case 1:
      return APP_FONTS.ReadingSerif;
    case 2:
      return APP_FONTS.ReadingSansSerif;
    case 3:
      return APP_FONTS.Monospace;
    case 4:
      return custom ?? APP_FONTS.ReadingSansSerif;
    default:
      return APP_FONTS.ReadingSansSerif;
  }
}

/**
 * Runtime guard for the "只准往后追加，绝不能调整顺序或改名" rule. Throws on any drift so a
 * refactor cannot silently invalidate persisted `fontFamilyIndex` values.
 */
export function assertReadingFontIds(families: readonly ReadingFontFamily[] = readingFontFamilies()): void {
  const expected = ['0:默认字体', '1:衬线体', '2:黑体', '3:等宽体'];
  const actual = families.map((f) => `${f.id}:${f.label}`);
  const drift = expected.filter((row, i) => actual[i] !== row);
  if (drift.length > 0 || actual.length !== expected.length) {
    throw new Error(`reading font ids drifted: ${actual.join(', ')} (expected ${expected.join(', ')})`);
  }
}
