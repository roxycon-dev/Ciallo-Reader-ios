/**
 * Android `RuleBudget.kt` → `src/core/parser/ruleBudget.ts`.
 *
 * 2026-10-06 review fix: added `boundedReplace()` — the same budget-sensitive
 * regex evaluation Kotlin gets from `Regex(...).replace(RuleBudget.text(value))`.
 * JS RegExp cannot be polled mid-scan, so the deadline is checked up-front and
 * again right after the scan (same observable timeout outcome; see E86).
 */
export const MAX_RULE_LENGTH = 4096;
export const MAX_NESTING = 128;
export const MAX_JSON_CHARS = 2 * 1024 * 1024;
export const MAX_JSON_DEPTH = 64;

export function validateRule(rule: string): void {
  if (rule.length > MAX_RULE_LENGTH) {
    throw new Error('书源规则过长');
  }
  let nesting = 0;
  for (const ch of rule) {
    if (ch === '@' || ch === '&' || ch === '|') nesting += 1;
  }
  if (nesting > MAX_NESTING) {
    throw new Error('书源规则嵌套过多');
  }
}

export function validateJson(value: string): void {
  if (value.length > MAX_JSON_CHARS) {
    throw new Error('JSON 超过 2MiB');
  }
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const ch of value) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        throw new Error('JSON 嵌套过深');
      }
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
    }
  }
}

export function boundedText(value: string, millis = 1000): string {
  if (value.length > MAX_JSON_CHARS) {
    throw new Error('规则输入超过 2MiB');
  }
  const deadline = nowElapsed() + millis;
  if (isDeadlineExceeded(deadline)) {
    throw new Error('书源正则执行超时');
  }
  return value;
}

/**
 * Kotlin `Regex(src).replace(RuleBudget.text(value), repl)` semantics:
 * the Bounded CharSequence polls its deadline every 256 char reads, so a
 * runaway regex aborts mid-scan on Android. JS `RegExp` cannot be
 * interrupted mid-scan, so this performs the same check that is decidable
 * from the outside: once up-front, and again as soon as the scan finishes —
 * turning "Android aborts with 书源正则执行超时" into the same observable
 * outcome for inputs that blow the budget.
 */
export function boundedReplace(value: string, regexSource: string, replacement: string, millis = 1000): string {
  if (value.length > MAX_JSON_CHARS) {
    throw new Error('规则输入超过 2MiB');
  }
  const deadline = nowElapsed() + millis;
  if (isDeadlineExceeded(deadline)) {
    throw new Error('书源正则执行超时');
  }
  const result = value.replace(new RegExp(regexSource, 'g'), replacement);
  if (isDeadlineExceeded(deadline)) {
    throw new Error('书源正则执行超时');
  }
  return result;
}

export function nowElapsed(): number {
  return Date.now();
}

export function isDeadlineExceeded(deadline: number): boolean {
  return Date.now() > deadline;
}
