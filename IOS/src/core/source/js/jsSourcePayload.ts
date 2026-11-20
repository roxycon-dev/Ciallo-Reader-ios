/**
 * jsSourcePayload.ts —— `source/js/JsSourcePayload.kt`（33 行）的移植。
 *
 * Kotlin 原文（逐条对应）：
 *
 * ```kotlin
 * internal object JsSourcePayload {
 *     fun requiredArray(data: JSONObject?, field: String): JSONArray = data?.opt(field) as? JSONArray
 *         ?: throw SourceException.ParseError("源站返回的${when (field) {
 *             "comics" -> tr("搜索列表"); "images" -> tr("图片列表"); else -> tr("目录")
 *         }}格式异常，请更新书源或稍后重试")
 *     fun chapters(data: JSONObject): JSONArray {
 *         if (!data.has("chapters") || data.isNull("chapters")) return JSONArray()
 *         return requiredArray(data, "chapters")
 *     }
 *     fun string(data: JSONObject, key: String): String = when (val value = data.opt(key)) {
 *         is String -> value.trim()
 *         is Number -> if (key == "id") value.toString() else ""
 *         else -> ""
 *     }
 *     fun images(data: JSONObject?): List<String> {
 *         val array = requiredArray(data, "images")
 *         return (0 until array.length()).map { index ->
 *             val value = array.opt(index) as? String
 *             if (value.isNullOrBlank()) throw SourceException.ParseError(tr("源站图片列表包含缺失或异常的页面，请稍后重试"))
 *             value.trim()
 *         }
 *     }
 * }
 * ```
 *
 * 语义要点（不是风格问题，是行为）：
 *   · `requiredArray` 的失败**不是**「空数组」：字段缺失 / 不是数组都抛 `ParseError`，
 *     文案按字段名分三档（`comics` → 搜索列表、`images` → 图片列表、其余 → 目录）。
 *   · `chapters` 反过来是**宽容**的：缺 `chapters` 或 `chapters: null` → 空数组；
 *     只有「存在但不是数组」才抛。
 *   · `string` 对数字只在 `key == "id"` 时转字符串（书源常把 id 写成数字），
 *     其它数字字段一律空串 —— 否则会把「页数」「字数」当文本塞进标题。
 *   · `images` 里**任意一页**为空/非字符串就整条失败，不做「跳过坏图」的静默降级。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L10 `internal object JsSourcePayload`         → `JsSourcePayload` 命名空间对象
 *   L11-12 `requiredArray(data, field)`            → `requiredJsPayloadArray`
 *   L14-17 `chapters(data)`                        → `jsPayloadChapters`
 *   L19-23 `string(data, key)`                     → `jsPayloadString`
 *   L25-32 `images(data)`                          → `jsPayloadImages`
 *
 * 平台差异：`org.json.JSONObject` 在 Web 侧就是普通对象（`Record<string, unknown>`），
 * `opt` / `has` / `isNull` 逐条落到 `in` / `== null` / `Array.isArray` 上；
 * `JSONObject.NULL` 与 `null` 在这里都算「空」——这正是 `isNull()` 的定义。
 */

import { tr } from '@core/i18n';
import { ParseError } from '../sourceException';

/** Kotlin L11 `data?.opt(field) as? JSONArray` 的宿主形状。 */
export type JsPayloadObject = Readonly<Record<string, unknown>> | null | undefined;

/** Kotlin L11-12 的三档字段名 → 展示名映射（顺序即 `when` 的顺序）。 */
export function jsPayloadFieldLabel(field: string): string {
  if (field === 'comics') return tr('搜索列表');
  if (field === 'images') return tr('图片列表');
  return tr('目录');
}

/**
 * Kotlin L11-12 `requiredArray(data, field)`：
 * `data?.opt(field) as? JSONArray ?: throw ParseError(…)`。
 *
 * ⚠️ 返回**同一个**数组引用（Kotlin 的 `as? JSONArray` 也不复制）。
 */
export function requiredJsPayloadArray(
  data: JsPayloadObject,
  field: string,
): readonly unknown[] {
  const value = data == null ? undefined : data[field];
  if (Array.isArray(value)) return value;
  throw new ParseError(
    `源站返回的${jsPayloadFieldLabel(field)}格式异常，请更新书源或稍后重试`,
  );
}

/**
 * Kotlin L14-17 `chapters(data)`：
 * `!has("chapters") || isNull("chapters")` → 空数组；否则走 `requiredArray`。
 */
export function jsPayloadChapters(data: JsPayloadObject): readonly unknown[] {
  const present = data != null && 'chapters' in data;
  const value = present && data != null ? data['chapters'] : undefined;
  if (!present || value == null) return [];
  return requiredJsPayloadArray(data, 'chapters');
}

/**
 * Kotlin L19-23 `string(data, key)`：
 * `is String` → `trim()`；`is Number` → 仅 `key == "id"` 时转字符串；其余 → `''`。
 */
export function jsPayloadString(data: JsPayloadObject, key: string): string {
  const value = data == null ? undefined : data[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return key === 'id' ? String(value) : '';
  return '';
}

/**
 * Kotlin L25-32 `images(data)`：先 `requiredArray(data, "images")`，
 * 再逐项要求「非空字符串」，任意一项不合格整条失败。
 */
export function jsPayloadImages(data: JsPayloadObject): string[] {
  const array = requiredJsPayloadArray(data, 'images');
  return array.map((value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ParseError(tr('源站图片列表包含缺失或异常的页面，请稍后重试'));
    }
    return value.trim();
  });
}

/** Kotlin `object JsSourcePayload` 的调用形状。 */
export const JsSourcePayload = {
  requiredArray: requiredJsPayloadArray,
  chapters: jsPayloadChapters,
  string: jsPayloadString,
  images: jsPayloadImages,
} as const;
