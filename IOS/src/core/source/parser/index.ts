/**
 * Parser-layer entry point for the source layer.
 *
 * Kotlin counterpart: `com.example.source.parser.*` (3 files, 555 lines total).
 * The implementations already exist one directory up and are NOT duplicated
 * here; this module only re-exports them so `src/core/source/**` has a single
 * import surface:
 *
 *   LegadoRule.kt      (321 lines / 291 non-blank) → ../../parser/legadoRule.ts
 *   JsonPathResolver.kt(202 lines / 183 non-blank) → ../../parser/jsonPathResolver.ts
 *   RuleBudget.kt      ( 32 lines /  31 non-blank) → ../../parser/ruleBudget.ts
 *
 * Nothing is skipped: the three files were ported line-by-line into
 * `src/core/parser/`, and every public symbol is re-exported below.
 */

/** Android `LegadoRule.kt` — Legado 规则解释器（HTML 子集）。 */
export {
  isJsonRule,
  cleanJsonPath,
  selectElements,
  evalValues,
  evalFirst,
  findBodyNode,
  getAllElementsFrom,
  parseHtml,
  BLOCK_TAGS,
} from '../../parser/legadoRule';
export type { HtmlNode } from '../../parser/legadoRule';

/** Android `JsonPathResolver.kt` — JSONPath 解析。 */
export {
  resolveArray,
  getString,
  getLong,
  resolveStringArray,
  MAX_RESULTS_PER_STEP,
  MAX_JSON_DEPTH,
} from '../../parser/jsonPathResolver';

/** Android `RuleBudget.kt` — 规则长度/嵌套/JSON 深度预算。 */
export {
  MAX_RULE_LENGTH,
  MAX_NESTING,
  validateRule,
  validateJson,
  boundedText,
  boundedReplace,
} from '../../parser/ruleBudget';