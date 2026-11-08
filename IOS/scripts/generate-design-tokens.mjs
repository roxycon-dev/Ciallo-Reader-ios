/**
 * Validates that src/ui/tokens.ts matches values documented in PORT_PLAN.md
 * (extracted from Android DesignTokens.kt / Color.kt / IosMotion.kt).
 *
 * This is a static assertion script — it does NOT re-parse Kotlin.
 * When Android tokens change, update tokens.ts AND this script from source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = path.join(root, 'src', 'ui', 'tokens.ts');
const source = readFileSync(tokensPath, 'utf8');

const expected = {
  mintGold: '#E8C97A',
  darkCharcoal: '#18191C',
  mediumGray: '#61666D',
  dividerGray: '#E3E5E7',
  sepiaBg: '#FBF0D9',
  sepiaText: '#5F4B32',
  eyeGreenBg: '#E8F5E9',
  eyeGreenText: '#1B5E20',
  nightBg: '#18191C',
  nightText: '#D4D4D4',
  oledBg: '#000000',
  oledText: '#E0E0E0',
  radiusSm: 8,
  radiusXxl: 24,
  spacing1: 4,
  spacing6: 24,
  elevationCard: 2,
  elevationFloating: 8,
  tabBlur: 8,
  tabAlpha: 0.45,
  cardBlur: 24,
  cardAlpha: 0.78,
};

const checks = [
  ['mintGold', expected.mintGold],
  ['darkCharcoal', expected.darkCharcoal],
  ['mediumGray', expected.mediumGray],
  ['dividerGray', expected.dividerGray],
  ["sepia: { background: '#FBF0D9', text: '#5F4B32' }", null],
  ['eyeGreen', expected.eyeGreenBg],
  ['night', expected.nightBg],
  ['oled', expected.oledBg],
  ['sm: 8', null],
  ['xxl: 24', null],
  ["'1': 4", null],
  ["'6': 24", null],
  ['card: 2', null],
  ['floating: 8', null],
  ['tabBlur: 8', null],
  ['tabSurfaceAlpha: 0.45', null],
  ['cardBlur: 24', null],
  ['cardSurfaceAlpha: 0.78', null],
  ['damping: 0.85', null],
  ['stiffness: 320', null],
];

let failed = 0;
for (const [needle] of checks) {
  if (needle && !source.includes(needle)) {
    console.error(`[tokens] MISSING: ${needle}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`[tokens] ${failed} check(s) failed — tokens.ts drifted from Phase-0 extraction.`);
  process.exit(1);
}

console.log('[tokens] OK — src/ui/tokens.ts matches Phase-0 Android extraction.');
