/**
 * Title normalization — port of Android `TitleNormalizer.kt`.
 *
 * NFKC + lowercase, punctuation→space, CJK traditional→simplified fold,
 * collapse whitespace. compact = normalize without spaces.
 */

import { foldChar } from './cjkFoldMap';

const PUNCTUATION =
  /[!-/:-@[-`{-~\u3000。、・「」『』（）【】《》〈〉“”‘’…―ー･：；！？，．]/g;

const WHITESPACE = /\s+/g;

export function normalize(title: string): string {
  if (title.trim() === '') return '';
  const nfkc = title.normalize('NFKC');
  const lowered = nfkc.toLowerCase();
  const spaced = lowered.replace(PUNCTUATION, ' ');
  let folded = '';
  for (const ch of spaced) {
    folded += foldChar(ch);
  }
  return folded
    .split(WHITESPACE)
    .filter((s) => s !== '')
    .join(' ');
}

export function compact(title: string): string {
  return normalize(title).replace(/ /g, '');
}

/** Whether a raw title is worth keeping as a search variant. */
export function usableVariant(raw: string): boolean {
  return normalize(raw).length >= 2;
}
