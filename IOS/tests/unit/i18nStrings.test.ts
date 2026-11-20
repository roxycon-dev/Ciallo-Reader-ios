/**
 * i18n 的**权威对照**测试：不拿生成物跟自己对表，而是每次现读 Kotlin 源。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/i18n/Strings.kt`（1.6.4 / versionCode 264，只读）。
 * 路径经 `tests/helpers/androidReference` 解析 —— 本地就是
 * `<workspace>/novel-reader/app/src/main/java/com/example/i18n/Strings.kt`（从本文件出发是
 * `../../../novel-reader/app/src/main/java/com/example/i18n/Strings.kt`），CI 里回落到
 * `tests/reference/android/…` 快照，两种情况下解析的都是同一份 Kotlin 原文。
 *
 * 本文件的解析器**独立实现**（自己的 Kotlin 字符串词法器），刻意不复用 `src/` 里的任何东西，
 * 这样 `strings.ts` 生成错位时这里一定报红。
 *
 * 计数说明（实测，别再按 `"..." to "..."` 的行数当条数）：
 * - 单行 `"中文" to "English"` 共 **2459** 行；
 * - 但**条目总数是 2626**，因为其中 167 条太长被折成两行（`"…" to` 换行后才是英文串）；
 * - 2535 组里去掉重复 key 剩 **2398** 个唯一 key（228 组重复，63 组值不同，`mapOf` 后写胜出）。
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { androidReference } from '../helpers/androidReference';
import {
  AppLanguage,
  EN,
  EN_PAIRS,
  StringTable,
  allOf,
  appLanguageOf,
  applyFilters,
  archiveMissingBook,
  compactCount,
  dayRecordSummary,
  daysCount,
  durationOf,
  enhanceProgress,
  findWhatYouWant,
  fullEnhanceProgress,
  getAppLanguage,
  isBusyStatus,
  isFailureStatus,
  itemsCount,
  itemsOfTotal,
  lastPageRead,
  loadingPercent,
  minutesShort,
  minutesTotal,
  modelDownloadFailed,
  modelSizeMb,
  monthName,
  pageOf,
  peerWantsToSend,
  periodDaysLine,
  periodReadOnly,
  pinFilled,
  preparingOcr,
  readDateOf,
  readDurationOf,
  receivedKb,
  rememberStrings,
  scalePresetName,
  setAppLanguage,
  shareReportTitle,
  sourcesOf,
  streakLine,
  subscribeAppLanguage,
  tr,
  weekdayName,
  weekdayShort,
  yearMonthLabel,
} from '../../src/core/i18n';

const KOTLIN_PATH = androidReference('app/src/main/java/com/example/i18n/Strings.kt');
const KOTLIN = readFileSync(KOTLIN_PATH, 'utf8');

interface KotlinPair {
  key: string;
  value: string;
  line: number;
}

/** 独立实现：从 `private val EN … = mapOf(` 一路扫到配对的 `)`，还原 Kotlin 字符串转义。 */
function parseKotlinDictionary(source: string): KotlinPair[] {
  const header = /private val EN: Map<String, String> = mapOf\(/.exec(source);
  if (!header) throw new Error('Strings.kt: `EN` mapOf header not found');
  let i = header.index + header[0].length;
  let line = source.slice(0, i).split('\n').length;
  const length = source.length;
  const pairs: KotlinPair[] = [];

  const skipTrivia = (): void => {
    for (;;) {
      const ch = source[i];
      if (ch === undefined) throw new Error('Strings.kt: unexpected end of file inside the dictionary');
      if (ch === '\n') {
        line += 1;
        i += 1;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        i += 1;
        continue;
      }
      if (ch === '/' && source[i + 1] === '/') {
        const nl = source.indexOf('\n', i);
        i = nl < 0 ? length : nl;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        if (close < 0) throw new Error('Strings.kt: unterminated block comment');
        line += source.slice(i, close).split('\n').length - 1;
        i = close + 2;
        continue;
      }
      return;
    }
  };

  const readKotlinString = (): string => {
    if (source[i] !== '"') throw new Error(`Strings.kt: expected '"' at line ${line}`);
    i += 1;
    let out = '';
    for (;;) {
      const ch = source[i];
      if (ch === undefined) throw new Error('Strings.kt: unterminated string literal');
      if (ch === '\n') line += 1;
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (ch === '$') throw new Error(`Strings.kt: template interpolation at line ${line}`);
      if (ch === '\\') {
        const esc = source[i + 1] ?? '';
        i += 2;
        if (esc === 'n') out += '\n';
        else if (esc === 't') out += '\t';
        else if (esc === 'r') out += '\r';
        else if (esc === 'b') out += '\b';
        else if (esc === 'u') {
          const hex = source.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Strings.kt: bad \\u escape at line ${line}`);
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else if (esc === '"' || esc === '\\' || esc === "'" || esc === '$') out += esc;
        else throw new Error(`Strings.kt: unknown escape \\${esc} at line ${line}`);
        continue;
      }
      out += ch;
      i += 1;
    }
  };

  for (;;) {
    skipTrivia();
    if (source[i] === ')') break;
    const startLine = line;
    const key = readKotlinString();
    skipTrivia();
    if (!source.startsWith('to', i)) throw new Error(`Strings.kt: expected 'to' at line ${line}`);
    i += 2;
    skipTrivia();
    const value = readKotlinString();
    pairs.push({ key, value, line: startLine });
    skipTrivia();
    if (source[i] === ',') {
      i += 1;
      continue;
    }
    if (source[i] === ')') break;
    throw new Error(`Strings.kt: expected ',' or ')' at line ${line}`);
  }
  return pairs;
}

const PAIRS = parseKotlinDictionary(KOTLIN);
/** Kotlin `mapOf` 语义：后写覆盖先写。 */
const KOTLIN_LAST = new Map<string, string>();
for (const pair of PAIRS) KOTLIN_LAST.set(pair.key, pair.value);
const SINGLE_LINE_PAIRS = KOTLIN.split('\n').filter((text) => text.includes('" to "')).length;

beforeEach(() => {
  setAppLanguage(AppLanguage.EN);
});

afterEach(() => {
  setAppLanguage(AppLanguage.ZH);
});

describe('Strings.kt → strings.ts 词表', () => {
  it('字典条数：EN_PAIRS 与 Kotlin 的 to 条目一一对应（2626 条，>= 2459）', () => {
    // 单行对 2368 条；另 167 条折行，所以条目总数 2535。
    expect(SINGLE_LINE_PAIRS).toBe(2459);
    expect(PAIRS.length).toBe(2626);
    expect(PAIRS.length).toBeGreaterThanOrEqual(2368);
    expect(EN_PAIRS.length).toBe(PAIRS.length);

    const mismatched: string[] = [];
    for (let index = 0; index < PAIRS.length; index += 1) {
      const expected = PAIRS[index];
      const actual = EN_PAIRS[index];
      if (!expected || !actual) {
        mismatched.push(`#${index}`);
        continue;
      }
      if (actual[0] !== expected.key || actual[1] !== expected.value) {
        mismatched.push(`Strings.kt:${expected.line} ${expected.key}`);
        continue;
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('EN 记录表：2398 个唯一 key，取值等于 Kotlin 最后一次赋值', () => {
    const keys = Object.keys(EN);
    expect(KOTLIN_LAST.size).toBe(2398);
    expect(PAIRS.length - KOTLIN_LAST.size).toBe(228);
    expect(keys.length).toBe(KOTLIN_LAST.size);

    const drifted: string[] = [];
    for (const [key, value] of KOTLIN_LAST) {
      if (EN[key] !== value) drifted.push(`${key} → ${JSON.stringify(EN[key])} ≠ ${JSON.stringify(value)}`);
    }
    expect(drifted).toEqual([]);
  });

  it('逐字一致：带引号 / 换行 / 尾随空格的条目原样保留', () => {
    expect(EN['「还没有喜欢的漫画」']).toBe('"No favourite comics yet"');
    expect(EN['永远相信美好的\n事情正在发生']).toBe('Something good\nis always on its way');
    expect(EN['今日已阅读 ']).toBe('Read today ');
    expect(EN['章节加载失败：']).toBe('Chapter failed to load: ');
    expect(EN['原站偏好']).toBe('Native tags');
  });

  it('抽样 10 组中英对照（英文模式）', () => {
    expect(tr('书库')).toBe('Library');
    expect(tr('发现')).toBe('Discover');
    expect(tr('书架')).toBe('Shelf');
    expect(tr('取消')).toBe('Cancel');
    expect(tr('保存')).toBe('Save');
    expect(tr('删除')).toBe('Delete');
    expect(tr('检查更新')).toBe('Check for updates');
    expect(tr('分享')).toBe('Share');
    expect(tr('今日')).toBe('Today');
    expect(tr('未提供')).toBe('Not provided');
  });
});

describe('tr / 语言状态', () => {
  it('缺失 key 回退中文原文（中英两种模式）', () => {
    expect(tr('这条文案根本不在词表里')).toBe('这条文案根本不在词表里');
    setAppLanguage(AppLanguage.ZH);
    expect(tr('书库')).toBe('书库');
    expect(tr('这条文案根本不在词表里')).toBe('这条文案根本不在词表里');
  });

  it('appLanguageOf：en 前缀（大小写不敏感）→ EN，其余 → ZH', () => {
    expect(appLanguageOf(null)).toBe(AppLanguage.ZH);
    expect(appLanguageOf(undefined)).toBe(AppLanguage.ZH);
    expect(appLanguageOf('')).toBe(AppLanguage.ZH);
    expect(appLanguageOf('en')).toBe(AppLanguage.EN);
    expect(appLanguageOf('EN')).toBe(AppLanguage.EN);
    expect(appLanguageOf('en-US')).toBe(AppLanguage.EN);
    expect(appLanguageOf('en_US')).toBe(AppLanguage.EN);
    expect(appLanguageOf('English')).toBe(AppLanguage.EN);
    expect(appLanguageOf('zh')).toBe(AppLanguage.ZH);
    expect(appLanguageOf('ZH-CN')).toBe(AppLanguage.ZH);
    expect(appLanguageOf('fr-FR')).toBe(AppLanguage.ZH);
    expect(appLanguageOf('e')).toBe(AppLanguage.ZH);
    expect(getAppLanguage()).toBe(AppLanguage.EN);
  });

  it('setAppLanguage 只在真换语言时通知订阅者；退订后不再收到', () => {
    setAppLanguage(AppLanguage.ZH);
    const seen: AppLanguage[] = [];
    const unsubscribe = subscribeAppLanguage((language) => seen.push(language));

    setAppLanguage(AppLanguage.EN);
    setAppLanguage(AppLanguage.EN);
    setAppLanguage(AppLanguage.ZH);
    unsubscribe();
    setAppLanguage(AppLanguage.EN);

    expect(seen).toEqual([AppLanguage.EN, AppLanguage.ZH]);
    expect(getAppLanguage()).toBe(AppLanguage.EN);
  });
});

describe('StringTable —— 中文分支与英文单复数', () => {
  const en = new StringTable(AppLanguage.EN);
  const zh = new StringTable(AppLanguage.ZH);

  it('isEnglish / t', () => {
    expect(en.isEnglish).toBe(true);
    expect(zh.isEnglish).toBe(false);
    expect(en.t('书库')).toBe('Library');
    expect(zh.t('书库')).toBe('书库');
    expect(en.t('词表里没有这条')).toBe('词表里没有这条');
  });

  it('books / chapters / readPercent / streak', () => {
    expect(zh.books(1)).toBe('1 本');
    expect(zh.books(3)).toBe('3 本');
    expect(en.books(1)).toBe('1 book');
    expect(en.books(3)).toBe('3 books');

    expect(zh.chapters(3, 140)).toBe('第 3 / 140 章');
    expect(en.chapters(3, 140)).toBe('Ch. 3 / 140');
    expect(zh.chapterCounter(3, 140)).toBe('3/140 章');
    expect(en.chapterCounter(3, 140)).toBe('Ch. 3/140');
    expect(zh.chapterLabel(3)).toBe('第 3 章');
    expect(en.chapterLabel(3)).toBe('Chapter 3');

    expect(zh.readPercent(42)).toBe('已读 42%');
    expect(en.readPercent(42)).toBe('Read 42%');

    expect(zh.streak(5)).toBe('连续 5 天');
    expect(en.streak(1)).toBe('1 day streak');
    expect(en.streak(5)).toBe('5 day streak');
  });

  it('byAuthor / version / todayMinutes / restReminder', () => {
    expect(zh.byAuthor('鲁迅')).toBe('著  鲁迅');
    expect(en.byAuthor('Lu Xun')).toBe('by Lu Xun');
    expect(zh.version('1.6.4')).toBe('版本 1.6.4');
    expect(en.version('1.6.4')).toBe('Version 1.6.4');
    expect(zh.todayMinutes(30)).toBe('今日已阅读 30 分钟');
    expect(en.todayMinutes(30)).toBe('Read 30 min today');
    expect(zh.restReminder(30)).toBe('已持续阅读 30 分钟，建议远眺片刻！');
    expect(en.restReminder(30)).toBe(
      "You've been reading for 30 min — look into the distance for a moment!",
    );
  });

  it('page / step / dayReadLog / weekMinutes', () => {
    expect(zh.pageLabel(3)).toBe('第 3 页');
    expect(en.pageLabel(3)).toBe('Page 3');
    expect(zh.pageCounter(3, 20)).toBe('第 3 / 20 页');
    expect(en.pageCounter(3, 20)).toBe('Page 3 / 20');
    expect(zh.stepCounter(2, 6)).toBe('第 2 步，共 6 步');
    expect(en.stepCounter(2, 6)).toBe('Step 2 of 6');
    expect(zh.dayReadLog('周一')).toBe('周一阅读记录：');
    expect(en.dayReadLog('周一')).toBe('周一 reading log:');
    expect(zh.weekMinutes(120)).toBe('本周共 120 分钟');
    expect(en.weekMinutes(1)).toBe('1 min this week');
    expect(en.weekMinutes(120)).toBe('120 min this week');
  });

  it('expandAll / clearSearchHistory / pagesTotal / expandRest', () => {
    expect(zh.expandAll(12)).toBe('展开全部 12 条');
    expect(en.expandAll(1)).toBe('Show 1 more');
    expect(en.expandAll(12)).toBe('Show all 12');
    expect(zh.clearSearchHistory(2)).toBe('将删除全部 2 条历史搜索词，此操作不可撤销。');
    expect(en.clearSearchHistory(1)).toBe('This deletes your 1 saved search and cannot be undone.');
    expect(en.clearSearchHistory(2)).toBe('This deletes all 2 saved searches and cannot be undone.');
    expect(zh.pagesTotal(240)).toBe('共 240 页');
    expect(en.pagesTotal(1)).toBe('1 page');
    expect(en.pagesTotal(240)).toBe('240 pages');
    expect(zh.expandRest(3)).toBe('展开其余 3 个');
    expect(en.expandRest(1)).toBe('Show 1 more');
    expect(en.expandRest(3)).toBe('Show 3 more');
  });

  it('totalOf / itemsOfTotal / remainingOfTotal / filesTotal / sourcesSubmitted', () => {
    expect(zh.totalOf('12 小时')).toBe('共 12 小时');
    expect(en.totalOf('12 h')).toBe('Total 12 h');
    expect(zh.itemsOfTotal(12, '34 MB')).toBe('12 项 · 共 34 MB');
    expect(en.itemsOfTotal(12, '34 MB')).toBe('12 items · 34 MB');
    // 顶层便捷入口（Kotlin:238）与表方法同源，此时当前语言是 EN。
    expect(itemsOfTotal(12, '34 MB')).toBe('12 items · 34 MB');
    expect(zh.remainingOfTotal('3 MB', '12 MB')).toBe('剩余 3 MB / 共 12 MB');
    expect(en.remainingOfTotal('3 MB', '12 MB')).toBe('3 MB left of 12 MB');
    expect(zh.filesTotal(2)).toBe('共 2 个文件');
    expect(en.filesTotal(1)).toBe('1 file');
    expect(zh.sourcesSubmitted(2)).toBe('已提交 2 个书源');
    expect(en.sourcesSubmitted(1)).toBe('1 source submitted');
    expect(en.sourcesSubmitted(2)).toBe('2 sources submitted');
    expect(zh.sourcesReadable(2)).toBe('2 个源可读');
    expect(en.sourcesReadable(1)).toBe('1 source');
    expect(zh.filterCount(3)).toBe('当前筛选 3 本');
    expect(en.filterCount(1)).toBe('1 filtered result');
  });

  it('downloadChapters / category* / favourites*', () => {
    expect(zh.downloadChapters(1, '3.4')).toBe('下载 1 话 · 约 3.4 MB');
    expect(en.downloadChapters(1, '3.4')).toBe('Download 1 chapter · about 3.4 MB');
    expect(en.downloadChapters(2, '3.4')).toBe('Download 2 chapters · about 3.4 MB');

    expect(zh.categoryName('玄幻')).toBe('分类 玄幻');
    expect(en.categorySelected('玄幻')).toBe('Category 玄幻, selected');
    expect(zh.categoryLocked('玄幻')).toBe('分类『玄幻』已锁定');
    expect(en.categoryLocked('玄幻')).toBe('The "玄幻" category is locked');
    expect(zh.categoryCreated('玄幻')).toBe('已创建分类「玄幻」');
    expect(en.categoryCreated('玄幻')).toBe('Category "玄幻" created');
    expect(zh.categoryEmpty('玄幻')).toBe(
      '在分类『玄幻』下还没有任何图书哦。您可以点击下方按钮导入新书到该分类！',
    );
    expect(en.categoryEmpty('玄幻')).toBe(
      'Nothing in "玄幻" yet. Tap the button below to import a book here!',
    );

    expect(zh.favouritesAdded(3)).toBe('已加入我喜欢的 3 本');
    expect(en.favouritesAdded(1)).toBe('Added 1 book to favourites');
    expect(en.favouritesAdded(3)).toBe('Added 3 books to favourites');
    expect(zh.favouritesAddedPartial(2, 3)).toBe('已喜欢 2 本，3 本无来源已跳过');
    expect(en.favouritesAddedPartial(2, 3)).toBe('Liked 2, skipped 3 without a source');
  });

  it('comicIdLabel / highlightOf / closeNamed / yearLabel / minutesValue', () => {
    expect(zh.comicIdLabel('abc')).toBe('编号：abc');
    expect(en.comicIdLabel('abc')).toBe('ID: abc');
    expect(zh.highlightOf('第一卷')).toBe('神回 · 第一卷');
    expect(en.highlightOf('Ch. 1')).toBe('Highlight · Ch. 1');
    expect(zh.closeNamed('设置')).toBe('关闭设置');
    expect(en.closeNamed('Settings')).toBe('Close Settings');
    expect(zh.yearLabel('2026')).toBe('2026年');
    expect(en.yearLabel('2026')).toBe('2026');
    expect(zh.minutesValue('5')).toBe('5 分钟');
    expect(en.minutesValue('1')).toBe('1 min');
    expect(en.minutesValue('5')).toBe('5 min');
  });

  it('dailyAverage / migrateIntro / titleDisabled / switchedTo / homeHttpCode', () => {
    expect(zh.dailyAverage('32 分钟', '上周', '28 分钟')).toBe('日均 32 分钟 · 较上周 28 分钟');
    expect(en.dailyAverage('32 min', 'last week', '28 min')).toBe('Daily 32 min · 28 min vs last week');
    expect(zh.migrateIntro('三体')).toBe('《三体》\n选择来源后，收藏、阅读进度与已读状态会按章节顺序迁移过去。');
    expect(en.migrateIntro('Santi')).toBe(
      'Santi\nPick a source — favourites, progress and read state migrate chapter by chapter.',
    );
    expect(zh.titleDisabled('某源')).toBe('某源 · 已停用');
    expect(en.titleDisabled('Some source')).toBe('Some source · disabled');
    expect(zh.switchedTo('节点 A')).toBe('已切换到 节点 A');
    expect(en.switchedTo('node A')).toBe('Switched to node A');
    expect(zh.homeHttpCode(404)).toBe('首页返回 HTTP 404');
    expect(en.homeHttpCode(404)).toBe('Home page returned HTTP 404');
  });
});

describe('顶层辅助函数（Kotlin:3063-3216）', () => {
  it('compactCount：亿 / 万 与 M / k，null 回退词表', () => {
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1234)).toBe('1.2k');
    expect(compactCount(1234567)).toBe('1.2M');
    expect(compactCount(null)).toBe('Not provided');
    expect(compactCount(undefined)).toBe('Not provided');

    setAppLanguage(AppLanguage.ZH);
    expect(compactCount(999)).toBe('999');
    expect(compactCount(23456)).toBe('2.3万');
    expect(compactCount(123456789)).toBe('1.2亿');
    expect(compactCount(null)).toBe('未提供');
  });

  it('weekdayName / weekdayShort / monthName / yearMonthLabel', () => {
    expect(weekdayName('周一')).toBe('Mon');
    expect(weekdayName('周日')).toBe('Sun');
    expect(weekdayName('周八')).toBe('周八');
    expect(weekdayShort('一')).toBe('M');
    expect(weekdayShort('四')).toBe('T');
    expect(weekdayShort('日')).toBe('S');
    expect(weekdayShort('九')).toBe('九');
    expect(monthName(3)).toBe('Mar');
    expect(monthName(13)).toBe('Dec');
    expect(monthName(0)).toBe('Jan');
    expect(yearMonthLabel('2026', 3)).toBe('Mar 2026');

    setAppLanguage(AppLanguage.ZH);
    expect(weekdayName('周一')).toBe('周一');
    expect(weekdayShort('六')).toBe('六');
    expect(monthName(3)).toBe('3月');
    expect(yearMonthLabel('2026', 3)).toBe('2026年3月');
  });

  it('pinFilled / pageOf / loadingPercent / receivedKb / preparingOcr', () => {
    expect(pinFilled(3)).toBe('3 of 6 digits entered');
    expect(pageOf('12')).toBe('Page 12');
    expect(loadingPercent(42)).toBe('Loading · 42%');
    expect(receivedKb(2048)).toBe('Received 2048 KB');
    expect(preparingOcr(10)).toBe('Preparing OCR model · 10%');

    setAppLanguage(AppLanguage.ZH);
    expect(pinFilled(3)).toBe('已输入 3 位，共 6 位');
    expect(pageOf('12')).toBe('第 12 页');
    expect(loadingPercent(42)).toBe('正在加载 · 42%');
    expect(receivedKb(2048)).toBe('已接收 2048 KB');
    expect(preparingOcr(10)).toBe('准备 OCR 模型 · 10%');
  });

  it('periodDaysLine：照抄 Kotlin 的 + 优先级（days==1 时「读完 N 本」整段丢失）', () => {
    expect(periodDaysLine('本周', 1, 2)).toBe('本周: 1 day');
    expect(periodDaysLine('本周', 3, 2)).toBe('本周: 3 days · 2 finished');
    setAppLanguage(AppLanguage.ZH);
    expect(periodDaysLine('本周', 1, 2)).toBe('本周阅读 1 天 · 读完 2 本');
    expect(periodDaysLine('本周', 3, 2)).toBe('本周阅读 3 天 · 读完 2 本');
  });

  it('shareReportTitle / itemsCount / allOf / findWhatYouWant / periodReadOnly', () => {
    expect(shareReportTitle('周')).toBe('My 周 reading report · Ciallo Reader');
    expect(itemsCount(3)).toBe(' · 3');
    expect(allOf('分类')).toBe('All 分类');
    expect(findWhatYouWant('小说')).toBe('Find 小说 to read');
    expect(periodReadOnly('本周', '2 小时')).toBe('本周: only 2 小时 so far');
    expect(applyFilters(3)).toBe('Apply 3');
    expect(sourcesOf(2, 5)).toBe('Sources 2 / 5');

    setAppLanguage(AppLanguage.ZH);
    expect(shareReportTitle('周')).toBe('我的阅读周报 · Ciallo Reader');
    expect(itemsCount(3)).toBe(' · 3本');
    expect(allOf('分类')).toBe('全部分类');
    expect(findWhatYouWant('小说')).toBe('找你想看的小说');
    expect(periodReadOnly('本周', '2 小时')).toBe('本周只读了 2 小时');
    expect(applyFilters(3)).toBe('应用 3 项');
    expect(sourcesOf(2, 5)).toBe('来源 2 / 5');
  });

  it('isBusyStatus / isFailureStatus：中英状态都要认', () => {
    expect(isBusyStatus('正在补全关键词')).toBe(true);
    expect(isBusyStatus('Filling keywords')).toBe(true);
    expect(isBusyStatus('Translating')).toBe(true);
    expect(isBusyStatus('完成')).toBe(false);
    expect(isFailureStatus('翻译失败')).toBe(true);
    expect(isFailureStatus('请求超时')).toBe(true);
    expect(isFailureStatus('未找到更多结果')).toBe(true);
    expect(isFailureStatus('translation FAILED')).toBe(true);
    expect(isFailureStatus('TIMED OUT')).toBe(true);
    expect(isFailureStatus('No further results')).toBe(true);
    expect(isFailureStatus('已完成')).toBe(false);
  });

  it('其余顶层函数（阅读统计 / 模型 / 互传 / 漫画）', () => {
    expect(dayRecordSummary(1)).toBe('1 book · see the cover below');
    expect(dayRecordSummary(3)).toBe('3 books · see the covers below');
    expect(minutesTotal(1)).toBe('1 min in total');
    expect(minutesTotal(5)).toBe('5 min in total');
    expect(readDateOf('2026-01-02')).toBe('Read on 2026-01-02');
    expect(durationOf('1 h')).toBe('Duration: 1 h');
    expect(minutesShort(12)).toBe('12m');
    expect(daysCount(1)).toBe('1 day');
    expect(daysCount(3)).toBe('3 days');
    expect(streakLine(1)).toBe('1-day streak');
    expect(streakLine(3)).toBe('3-day streak');
    expect(readDurationOf('本周')).toBe('本周 reading time');
    expect(lastPageRead(5, 20)).toBe('Last read page 5 of 20');
    expect(scalePresetName(150)).toBe('Zoom 150%');
    expect(peerWantsToSend('iPad')).toBe('iPad wants to send data');
    expect(archiveMissingBook('Santi')).toBe(
      '"Santi" was not found on this device; its notes and records were skipped — select the book categories for a complete transfer',
    );
    expect(modelDownloadFailed(404)).toBe('Model download failed: HTTP 404');
    expect(modelSizeMb(42)).toBe('Full model 42 MB');
    expect(enhanceProgress(42)).toBe('Enhancing 42%');
    expect(fullEnhanceProgress(42)).toBe('Full enhance 42%');

    setAppLanguage(AppLanguage.ZH);
    expect(dayRecordSummary(1)).toBe('共 1 本 · 详情见下方封面');
    expect(minutesTotal(1)).toBe('共 1 分钟');
    expect(readDateOf('2026-01-02')).toBe('阅读日期：2026-01-02');
    expect(durationOf('1 小时')).toBe('时长：1 小时');
    expect(minutesShort(12)).toBe('12分');
    expect(daysCount(3)).toBe('3 天');
    expect(streakLine(3)).toBe('连续阅读 3 天');
    expect(readDurationOf('本周')).toBe('本周阅读时长');
    expect(lastPageRead(5, 20)).toBe('上次读到第 5 页 · 共 20 页');
    expect(scalePresetName(150)).toBe('缩放 150%');
    expect(peerWantsToSend('iPad')).toBe('iPad 想发送数据');
    expect(archiveMissingBook('三体')).toBe(
      '《三体》未在本机找到，相关标注和记录已跳过；选择书籍类别可完整传送',
    );
    expect(modelDownloadFailed(404)).toBe('完整模型下载失败：HTTP 404');
    expect(modelSizeMb(42)).toBe('完整模型 42 MB');
    expect(enhanceProgress(42)).toBe('增强 42%');
    expect(fullEnhanceProgress(42)).toBe('完整增强 42%');
  });

  it('rememberStrings / 顶层便捷入口跟着当前语言走', () => {
    expect(rememberStrings().books(1)).toBe('1 book');
    expect(tr('书库')).toBe('Library');
    setAppLanguage(AppLanguage.ZH);
    expect(rememberStrings().books(1)).toBe('1 本');
    expect(rememberStrings().categoryLocked('玄幻')).toBe('分类『玄幻』已锁定');
  });
});
