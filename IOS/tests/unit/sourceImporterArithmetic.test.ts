/**
 * E87 —— `SimpleArithmetic` 的数字字面量与溢出语义。
 *
 * Kotlin `source/importer/SourceImporter.kt:556-622`：
 * ```kotlin
 * private fun number(): Long? {
 *     val sb = StringBuilder()
 *     while (peek()?.isDigit() == true) { sb.append(peek()); pos++ }   // L569
 *     return sb.toString().toLongOrNull()                             // L573
 * }
 * …
 * value = Math.multiplyExact(value, factor() ?: return null)          // L593
 * value = Math.addExact(value, term() ?: return null)                 // L612
 * value = Math.subtractExact(value, term() ?: return null)             // L616
 * ```
 *
 * 三个要点：
 *  1. `Char.isDigit()` 对 **Unicode Nd 类**数字为真（全角 `１２３`、阿拉伯-印度数字…）。
 *     iOS 侧原先用 `'0'..'9'` 字符比较，只认 ASCII —— 同一表达式在两端会一个算得出、
 *     一个算不出（E87）。
 *  2. `Math.*Exact` 在 64 位溢出时抛 `ArithmeticException` → 被外层 `catch` → `null`。
 *     TS 用 BigInt 复刻 64 位 `Long`（`[-2^63, 2^63-1]`）；字面量超 Long 范围
 *     （`toLongOrNull` → null）或运算结果越界（`*Exact` → throw）都归 null。
 *     2026-10-11 更正：本文件旧断言按 2^53 安全整数近似写，与 Kotlin 的 64 位
 *     语义不符（`9007199254740993+0` 在 Kotlin Long 里合法），已按 Kotlin 复算改期望值。
 *  3. `/` 是**截断**整数除法（Kotlin `Long` 除法），不是浮点除法。
 */

import { describe, expect, it } from 'vitest';
import { evalPageExpression } from '@core/source/importer/sourceImporter';

/** Kotlin 的入口先把 `page` 换成 1，所以表达式里 `page` 恒为 1。 */
function evalExpr(expr: string): string | null {
  return evalPageExpression(expr);
}

describe('SimpleArithmetic（E87）', () => {
  it('page 被替换为 1 后的基本四则运算', () => {
    expect(evalExpr('(1-1)*20')).toBe('0');
    expect(evalExpr('page*10')).toBe('10');
    expect(evalExpr('(page-1)*50')).toBe('0');
    expect(evalExpr('1+2*3')).toBe('7');
    expect(evalExpr('(1+2)*3')).toBe('9');
  });

  it('除法是截断整数除法（Kotlin Long 除法）', () => {
    expect(evalExpr('7/2')).toBe('3');
    expect(evalExpr('1/2')).toBe('0');
    expect(evalExpr('9/3')).toBe('3');
    // Kotlin 的 `number()`（L567-574）只吃 `Char.isDigit()`，**不接受前导负号**；
    // `-7` 里那个 `-` 是 `expression()` 的二元运算符，所以 `-7/2` 无法解析 → null。
    expect(evalExpr('-7/2')).toBeNull();
  });

  it('全角数字被入口正则拒绝（Kotlin L545 的白名单只放行 ASCII 数字与四则运算符）', () => {
    // `Char.isDigit()` 虽然对 Nd 类为真，但入口白名单先一步把它们挡掉了。
    expect(evalExpr('１２')).toBeNull();
    expect(evalExpr('１＋２')).toBeNull();
    expect(evalExpr('(１-1)*20')).toBeNull();
  });

  it('除以 0 → null（Kotlin L598 return null）', () => {
    expect(evalExpr('1/0')).toBeNull();
    expect(evalExpr('5/(2-2)')).toBeNull();
  });

  it('乘除混合优先级', () => {
    expect(evalExpr('2+3*4')).toBe('14');
    expect(evalExpr('100/5*2')).toBe('40');
  });

  it('全角数字：入口正则已拒绝（与 Kotlin 一致）', () => {
    // 已在上面的用例里覆盖；这里确认 ASCII 路径不受影响。
    expect(evalExpr('12')).toBe('12');
  });

  it('超出 64 位 Long → null（等价 Kotlin 的 Math.*Exact 溢出 → ArithmeticException → catch）', () => {
    // 999999999999999 * 999999999999999 ≈ 1e30，远超 Long.MAX（≈9.22e18）。
    expect(evalExpr('999999999999999*999999999999999')).toBeNull();
    // 3037000500² = 9223372037000250000 > Long.MAX → multiplyExact 溢出。
    expect(evalExpr('3037000500*3037000500')).toBeNull();
    // Long.MAX + 1 → addExact 溢出。
    expect(evalExpr('9223372036854775807+1')).toBeNull();
    // 字面量本身超出 Long 范围 → number() 的 toLongOrNull 为 null。
    expect(evalExpr('9223372036854775808')).toBeNull();
  });

  it('Long 边界内照常求值；运算结果越过 [-2^63, 2^63-1] 才算溢出', () => {
    expect(evalExpr('9007199254740991+0')).toBe('9007199254740991');
    expect(evalExpr('4503599627370495*2')).toBe('9007199254740990');
    // 2^53 = 9007199254740992 仍在 Long 范围内 → 合法（旧断言误判为溢出）。
    expect(evalExpr('4503599627370496*2')).toBe('9007199254740992');
    // 9007199254740993 在 JS double 里会被舍入到 2^53，但 Long/BigInt 精确保留。
    expect(evalExpr('9007199254740993+0')).toBe('9007199254740993');
    // Long.MAX 本身合法。
    expect(evalExpr('9223372036854775807+0')).toBe('9223372036854775807');
  });

  it('语法错误 → null', () => {
    expect(evalExpr('1+')).toBeNull();
    expect(evalExpr('(1+2')).toBeNull();
    expect(evalExpr('1+2)')).toBeNull();
    expect(evalExpr('')).toBeNull();
  });

  it('长度 > 256 → null（Kotlin L560）', () => {
    expect(evalExpr('1'.repeat(257))).toBeNull();
  });

  it('左括号 > 32 个 → null（Kotlin L560）', () => {
    expect(evalExpr('('.repeat(33) + '1' + ')'.repeat(33))).toBeNull();
  });

  it('非数字字符在入口正则就被拒（Kotlin L545 的白名单）', () => {
    expect(evalExpr('1.5')).toBeNull(); // 小数点不在白名单
    expect(evalExpr('a+1')).toBeNull();
    expect(evalExpr('1 % 2')).toBeNull();
  });
});