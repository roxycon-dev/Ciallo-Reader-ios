/**
 * i18n 的「语言状态 + 文案表类」。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/i18n/Strings.kt`（1.6.4 / versionCode 264，只读）。
 *
 * 移植对照：
 * - `enum class AppLanguage(val tag: String)`（Kotlin:24-32）→ `AppLanguage` 类型 + 同名常量对象；
 *   tag 就是值本身，`AppLanguage.EN === 'en'`，与 Kotlin 的 `AppLanguage.EN.tag` 等价。
 * - `AppLanguage.Companion.of(tag)`（Kotlin:29-31）→ `appLanguageOf()`：
 *   `startsWith("en", ignoreCase = true)` 逐字照抄，`"EN-us"` / `"en_US"` / `"english"` 都算 EN。
 * - `object AppLocale { var language by mutableStateOf(...) }`（Kotlin:38-43）
 *   → 模块内单值 + 监听器集合。Compose 的 `mutableStateOf` 换成**不依赖 React/DOM** 的
 *   `getAppLanguage` / `setAppLanguage` / `subscribeAppLanguage`（core 层禁止 React/DOM/Capacitor，
 *   见 `eslint.config.js` 的 `no-restricted-imports` / `no-restricted-globals`）。
 * - `class StringTable`（Kotlin:57-217）→ 同名 class，45 个方法 + `isEnglish` 逐条照抄分支顺序。
 * - `rememberStrings()`（Kotlin:269-270）原本读 `LocalStrings.current` 这个 Compose compositionLocal；
 *   Compose 专有设施不移植，这里等价实现为「按当前语言现取一张表」。
 * - `val LocalStrings = compositionLocalOf { StringTable(AppLanguage.ZH) }`（Kotlin:219）
 *   **不移植**：Compose 组合期专用，Web 侧没有对应概念；需要表时用 `rememberStrings()` 或
 *   `new StringTable(getAppLanguage())`，语义一致。
 * - `private fun table()`（Kotlin:225）→ 同名私有函数，供下面 37 个顶层便捷入口复用。
 *
 * 与 `strings.ts` 是**受控循环引用**：本文件在函数体里读 `EN`（调用期才取值），
 * `strings.ts` 在函数体里读 `getAppLanguage` / `StringTable`（同样调用期才取值），
 * 两边模块顶层都不触碰对方绑定，ESM 初始化顺序安全。
 */

import { EN } from './strings';

/** Kotlin `enum class AppLanguage(val tag: String)`：值即 tag。 */
export type AppLanguage = 'zh' | 'en';

export const AppLanguage: { readonly ZH: AppLanguage; readonly EN: AppLanguage } = {
  ZH: 'zh',
  EN: 'en',
};

/** 语言切换监听器。触发时机 = `setAppLanguage` 真的换了语言（同值不通知，对齐 `mutableStateOf`）。 */
export type AppLanguageListener = (language: AppLanguage) => void;

let currentLanguage: AppLanguage = AppLanguage.ZH;

const languageListeners = new Set<AppLanguageListener>();

/**
 * Kotlin `AppLanguage.of(tag)`（Strings.kt:29-31）：
 * `if (tag != null && tag.startsWith("en", ignoreCase = true)) EN else ZH`。
 * 大小写不敏感；`null` / `undefined` / 空串一律 ZH。
 */
export function appLanguageOf(tag: string | null | undefined): AppLanguage {
  return tag !== null && tag !== undefined && tag.toLowerCase().startsWith('en')
    ? AppLanguage.EN
    : AppLanguage.ZH;
}

/** 当前界面语言。Kotlin `AppLocale.language`。 */
export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

/** 切语言。同值调用不通知监听器（对齐 `mutableStateOf` 的结构相等短路）。 */
export function setAppLanguage(language: AppLanguage): void {
  if (language === currentLanguage) return;
  currentLanguage = language;
  for (const listener of [...languageListeners]) listener(currentLanguage);
}

/** 订阅语言切换，返回退订函数。 */
export function subscribeAppLanguage(listener: AppLanguageListener): () => void {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

/**
 * Kotlin `AppLocale.t(source)`（Strings.kt:42）与顶层 `tr(source)`（Strings.kt:54）：
 * 英文查表、缺失回退中文原文；中文原样返回。
 *
 * 词表是白名单：没有条目的字符串原样返回，所以它可以安全地包住「可能是数据」的位置
 * （书名、分类名、文件名），不会把用户数据翻译掉。
 */
export function tr(source: string): string {
  return currentLanguage === AppLanguage.EN ? (EN[source] ?? source) : source;
}

/**
 * 一个语言的文案表。Kotlin `class StringTable(private val language: AppLanguage)`
 * （Strings.kt:57-217），45 个方法逐条照抄：中文先判、英文再分单复数，拼接空格一个不改。
 */
export class StringTable {
  private readonly language: AppLanguage;

  constructor(language: AppLanguage) {
    this.language = language;
  }

  /** Kotlin:59 —— 英文查表、缺失回退原文。 */
  t(source: string): string {
    return this.language === AppLanguage.EN ? (EN[source] ?? source) : source;
  }

  /** Kotlin:61 `val isEnglish: Boolean get() = ...`。 */
  get isEnglish(): boolean {
    return this.language === AppLanguage.EN;
  }

  /** Kotlin:67-68「3 本」/「1 book」/「3 books」。 */
  books(count: number): string {
    if (!this.isEnglish) return `${count} 本`;
    return count === 1 ? '1 book' : `${count} books`;
  }

  /** Kotlin:70-71「第 3 / 140 章」。 */
  chapters(index: number, total: number): string {
    if (!this.isEnglish) return `第 ${index} / ${total} 章`;
    return `Ch. ${index} / ${total}`;
  }

  /** Kotlin:73-74。 */
  readPercent(percent: number): string {
    if (!this.isEnglish) return `已读 ${percent}%`;
    return `Read ${percent}%`;
  }

  /** Kotlin:76 —— 中文是「著」+**两个空格**。 */
  byAuthor(author: string): string {
    if (!this.isEnglish) return `著  ${author}`;
    return `by ${author}`;
  }

  /** Kotlin:78。 */
  version(name: string): string {
    if (!this.isEnglish) return `版本 ${name}`;
    return `Version ${name}`;
  }

  /** Kotlin:80-81 —— 英文单数是 `1 day streak`（day 无 s）。 */
  streak(days: number): string {
    if (!this.isEnglish) return `连续 ${days} 天`;
    return days === 1 ? '1 day streak' : `${days} day streak`;
  }

  /** Kotlin:83-84。 */
  todayMinutes(minutes: number): string {
    if (!this.isEnglish) return `今日已阅读 ${minutes} 分钟`;
    return `Read ${minutes} min today`;
  }

  /** Kotlin:91-92「3/140 章」——注意这里没有空格，`chapterLabel` 有。 */
  chapterCounter(index: number, total: number): string {
    if (!this.isEnglish) return `${index}/${total} 章`;
    return `Ch. ${index}/${total}`;
  }

  /** Kotlin:95。 */
  chapterLabel(index: number): string {
    if (!this.isEnglish) return `第 ${index} 章`;
    return `Chapter ${index}`;
  }

  /** Kotlin:98。 */
  pageLabel(index: number): string {
    if (!this.isEnglish) return `第 ${index} 页`;
    return `Page ${index}`;
  }

  /** Kotlin:100-101。 */
  pageCounter(index: number, total: number): string {
    if (!this.isEnglish) return `第 ${index} / ${total} 页`;
    return `Page ${index} / ${total}`;
  }

  /** Kotlin:104-105。 */
  stepCounter(step: number, total: number): string {
    if (!this.isEnglish) return `第 ${step} 步，共 ${total} 步`;
    return `Step ${step} of ${total}`;
  }

  /** Kotlin:108 —— 中文是全角冒号「：」。 */
  dayReadLog(day: string): string {
    if (!this.isEnglish) return `${day}阅读记录：`;
    return `${day} reading log:`;
  }

  /** Kotlin:111-112。 */
  weekMinutes(minutes: number): string {
    if (!this.isEnglish) return `本周共 ${minutes} 分钟`;
    return minutes === 1 ? '1 min this week' : `${minutes} min this week`;
  }

  /** Kotlin:115-117 —— 英文用 em dash（U+2014）而不是连字符。 */
  restReminder(minutes: number): string {
    if (!this.isEnglish) return `已持续阅读 ${minutes} 分钟，建议远眺片刻！`;
    return `You've been reading for ${minutes} min — look into the distance for a moment!`;
  }

  /** Kotlin:120-121。 */
  expandAll(count: number): string {
    if (!this.isEnglish) return `展开全部 ${count} 条`;
    return count === 1 ? 'Show 1 more' : `Show all ${count}`;
  }

  /** Kotlin:124-127。 */
  clearSearchHistory(count: number): string {
    if (!this.isEnglish) return `将删除全部 ${count} 条历史搜索词，此操作不可撤销。`;
    if (count === 1) return 'This deletes your 1 saved search and cannot be undone.';
    return `This deletes all ${count} saved searches and cannot be undone.`;
  }

  /** Kotlin:130。 */
  totalOf(value: string): string {
    if (!this.isEnglish) return `共 ${value}`;
    return `Total ${value}`;
  }

  /** Kotlin:133-134 —— 中文用「·」（U+00B7）。 */
  itemsOfTotal(items: number, total: string): string {
    if (!this.isEnglish) return `${items} 项 · 共 ${total}`;
    return `${items} items · ${total}`;
  }

  /** Kotlin:137-138。 */
  remainingOfTotal(remaining: string, total: string): string {
    if (!this.isEnglish) return `剩余 ${remaining} / 共 ${total}`;
    return `${remaining} left of ${total}`;
  }

  /** Kotlin:141-142。 */
  pagesTotal(count: number): string {
    if (!this.isEnglish) return `共 ${count} 页`;
    return count === 1 ? '1 page' : `${count} pages`;
  }

  /** Kotlin:146-147。 */
  sourcesReadable(count: number): string {
    if (!this.isEnglish) return `${count} 个源可读`;
    return count === 1 ? '1 source' : `${count} sources`;
  }

  /** Kotlin:149-151。 */
  filterCount(count: number): string {
    if (!this.isEnglish) return `当前筛选 ${count} 本`;
    return count === 1 ? '1 filtered result' : `${count} filtered results`;
  }

  /** Kotlin:153-154。 */
  titleDisabled(title: string): string {
    if (!this.isEnglish) return `${title} · 已停用`;
    return `${title} · disabled`;
  }

  /** Kotlin:156-158。 */
  sourcesSubmitted(count: number): string {
    if (!this.isEnglish) return `已提交 ${count} 个书源`;
    return count === 1 ? '1 source submitted' : `${count} sources submitted`;
  }

  /** Kotlin:160-161。 */
  filesTotal(count: number): string {
    if (!this.isEnglish) return `共 ${count} 个文件`;
    return count === 1 ? '1 file' : `${count} files`;
  }

  /** Kotlin:163-166 —— 中文量词是「话」。 */
  downloadChapters(count: number, sizeMb: string): string {
    if (!this.isEnglish) return `下载 ${count} 话 · 约 ${sizeMb} MB`;
    return count === 1
      ? `Download 1 chapter · about ${sizeMb} MB`
      : `Download ${count} chapters · about ${sizeMb} MB`;
  }

  /** Kotlin:168。 */
  categoryName(name: string): string {
    if (!this.isEnglish) return `分类 ${name}`;
    return `Category ${name}`;
  }

  /** Kotlin:170-171。 */
  categorySelected(name: string): string {
    if (!this.isEnglish) return `分类 ${name}，已选中`;
    return `Category ${name}, selected`;
  }

  /** Kotlin:173-174 —— 中文用『』，英文用**真双引号**（Kotlin 里是 `\"`）。 */
  categoryLocked(name: string): string {
    if (!this.isEnglish) return `分类『${name}』已锁定`;
    return `The "${name}" category is locked`;
  }

  /** Kotlin:176-177。 */
  categoryCreated(name: string): string {
    if (!this.isEnglish) return `已创建分类「${name}」`;
    return `Category "${name}" created`;
  }

  /** Kotlin:179-181 —— 中文用『』。 */
  categoryEmpty(name: string): string {
    if (!this.isEnglish) return `在分类『${name}』下还没有任何图书哦。您可以点击下方按钮导入新书到该分类！`;
    return `Nothing in "${name}" yet. Tap the button below to import a book here!`;
  }

  /** Kotlin:183-185。 */
  favouritesAdded(count: number): string {
    if (!this.isEnglish) return `已加入我喜欢的 ${count} 本`;
    return count === 1 ? 'Added 1 book to favourites' : `Added ${count} books to favourites`;
  }

  /** Kotlin:187-189。 */
  favouritesAddedPartial(added: number, skipped: number): string {
    if (!this.isEnglish) return `已喜欢 ${added} 本，${skipped} 本无来源已跳过`;
    return `Liked ${added}, skipped ${skipped} without a source`;
  }

  /** Kotlin:191 —— 中文是全角冒号「：」。 */
  comicIdLabel(id: string): string {
    if (!this.isEnglish) return `编号：${id}`;
    return `ID: ${id}`;
  }

  /** Kotlin:193。 */
  highlightOf(name: string): string {
    if (!this.isEnglish) return `神回 · ${name}`;
    return `Highlight · ${name}`;
  }

  /** Kotlin:195 —— 中文刻意不留空格（`关闭$title`）。 */
  closeNamed(title: string): string {
    if (!this.isEnglish) return `关闭${title}`;
    return `Close ${title}`;
  }

  /** Kotlin:197 —— 中文是「<年>年」，英文只有年份。 */
  yearLabel(year: string): string {
    if (!this.isEnglish) return `${year}年`;
    return year;
  }

  /** Kotlin:199-200 —— 英文只对字面量 "1" 用单数。 */
  minutesValue(value: string): string {
    if (!this.isEnglish) return `${value} 分钟`;
    return value === '1' ? '1 min' : `${value} min`;
  }

  /** Kotlin:202-204 —— 中文「较<上一周期名> <上一周期文案>」。 */
  dailyAverage(average: string, previousName: string, previousText: string): string {
    if (!this.isEnglish) return `日均 ${average} · 较${previousName} ${previousText}`;
    return `Daily ${average} · ${previousText} vs ${previousName}`;
  }

  /** Kotlin:206-208 —— 第一行是《书名》，第二行是迁移说明，中间是真换行。 */
  migrateIntro(title: string): string {
    if (!this.isEnglish) return `《${title}》\n选择来源后，收藏、阅读进度与已读状态会按章节顺序迁移过去。`;
    return `${title}\nPick a source — favourites, progress and read state migrate chapter by chapter.`;
  }

  /** Kotlin:210-211。 */
  expandRest(count: number): string {
    if (!this.isEnglish) return `展开其余 ${count} 个`;
    return count === 1 ? 'Show 1 more' : `Show ${count} more`;
  }

  /** Kotlin:213。 */
  switchedTo(node: string): string {
    if (!this.isEnglish) return `已切换到 ${node}`;
    return `Switched to ${node}`;
  }

  /** Kotlin:215-216。 */
  homeHttpCode(code: number): string {
    if (!this.isEnglish) return `首页返回 HTTP ${code}`;
    return `Home page returned HTTP ${code}`;
  }
}

/** Kotlin:225 `private fun table(): StringTable = StringTable(AppLocale.language)`。 */
function table(): StringTable {
  return new StringTable(currentLanguage);
}

/**
 * Kotlin:227-266 —— 37 个顶层便捷入口：内部按当前语言临时取一张表，调用方不需要先拿到 `str`。
 * 名字、参数顺序、空格全部照抄。
 */
export function chapterCounter(index: number, total: number): string {
  return table().chapterCounter(index, total);
}

export function chapterLabel(index: number): string {
  return table().chapterLabel(index);
}

export function pageLabel(index: number): string {
  return table().pageLabel(index);
}

export function pageCounter(index: number, total: number): string {
  return table().pageCounter(index, total);
}

export function stepCounter(step: number, total: number): string {
  return table().stepCounter(step, total);
}

export function dayReadLog(day: string): string {
  return table().dayReadLog(day);
}

export function weekMinutes(minutes: number): string {
  return table().weekMinutes(minutes);
}

export function restReminder(minutes: number): string {
  return table().restReminder(minutes);
}

export function expandAll(count: number): string {
  return table().expandAll(count);
}

export function clearSearchHistory(count: number): string {
  return table().clearSearchHistory(count);
}

export function totalOf(value: string): string {
  return table().totalOf(value);
}

export function itemsOfTotal(items: number, total: string): string {
  return table().itemsOfTotal(items, total);
}

export function remainingOfTotal(remaining: string, total: string): string {
  return table().remainingOfTotal(remaining, total);
}

export function pagesTotal(count: number): string {
  return table().pagesTotal(count);
}

export function sourcesReadable(count: number): string {
  return table().sourcesReadable(count);
}

export function filterCount(count: number): string {
  return table().filterCount(count);
}

export function titleDisabled(title: string): string {
  return table().titleDisabled(title);
}

export function sourcesSubmitted(count: number): string {
  return table().sourcesSubmitted(count);
}

export function filesTotal(count: number): string {
  return table().filesTotal(count);
}

export function downloadChapters(count: number, sizeMb: string): string {
  return table().downloadChapters(count, sizeMb);
}

export function categoryName(name: string): string {
  return table().categoryName(name);
}

export function categorySelected(name: string): string {
  return table().categorySelected(name);
}

export function categoryLocked(name: string): string {
  return table().categoryLocked(name);
}

export function categoryCreated(name: string): string {
  return table().categoryCreated(name);
}

export function categoryEmpty(name: string): string {
  return table().categoryEmpty(name);
}

export function favouritesAdded(count: number): string {
  return table().favouritesAdded(count);
}

export function favouritesAddedPartial(added: number, skipped: number): string {
  return table().favouritesAddedPartial(added, skipped);
}

export function comicIdLabel(id: string): string {
  return table().comicIdLabel(id);
}

export function highlightOf(name: string): string {
  return table().highlightOf(name);
}

export function closeNamed(title: string): string {
  return table().closeNamed(title);
}

export function yearLabel(year: string): string {
  return table().yearLabel(year);
}

export function minutesValue(value: string): string {
  return table().minutesValue(value);
}

export function dailyAverage(average: string, previousName: string, previousText: string): string {
  return table().dailyAverage(average, previousName, previousText);
}

export function migrateIntro(title: string): string {
  return table().migrateIntro(title);
}

export function expandRest(count: number): string {
  return table().expandRest(count);
}

export function switchedTo(node: string): string {
  return table().switchedTo(node);
}

export function homeHttpCode(code: number): string {
  return table().homeHttpCode(code);
}

/**
 * Kotlin:269-270 `@Composable fun rememberStrings(): StringTable = LocalStrings.current`。
 * Compose 的 compositionLocal 换成「按当前语言现取一张表」；同一组合期里语言不变，
 * 因此与 `LocalStrings.current` 的行为一致。
 */
export function rememberStrings(): StringTable {
  return table();
}
