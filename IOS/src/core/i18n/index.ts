/**
 * i18n 子系统的公共入口。
 *
 * - `strings.ts`：中文 key → 英文文案表（`EN` / `EN_PAIRS`）+ Kotlin 后半段 36 个顶层辅助函数。
 * - `locale.ts`：语言状态（`getAppLanguage` / `setAppLanguage` / `subscribeAppLanguage`）、`tr`、
 *   `StringTable` 类，以及 Kotlin 前半段 37 个顶层便捷入口。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/i18n/Strings.kt`（只读）。
 *
 * 用法：
 * ```ts
 * import { AppLanguage, appLanguageOf, setAppLanguage, tr, StringTable } from '@core/i18n';
 *
 * setAppLanguage(appLanguageOf(languageTag));         // 启动时把系统语言 tag 喂进来
 * tr('书库');                                          // 英文界面走词表，缺失回退中文原文
 * const str = new StringTable(AppLanguage.EN);          // 需要大量拼接时复用一张表
 * ```
 */

export * from './strings';
export * from './locale';
