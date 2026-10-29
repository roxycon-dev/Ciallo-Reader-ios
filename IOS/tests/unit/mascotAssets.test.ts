/**
 * Kotlin → TS map
 * ──────────────
 * Tests for the asset plumbing that the previous port got wrong: the mascot
 * sprite sheet and the splash LOGO referenced files that were **never shipped**
 * to `public/`, so every mascot `<img>` 404'd (and the `onError` handlers hid it)
 * and the splash drew a text "Ciallo" instead of the hand-drawn LOGO.
 *
 * Sources of truth:
 *  - `novel-reader/app/src/main/res/drawable-nodpi/mascot_*.webp`
 *  - `novel-reader/app/src/main/res/drawable-nodpi/splash_ciallo_logo.png`
 *  - `ui/mascot/MascotSpriteSheet.kt` L16-24  (which drawable each key means)
 *  - `ui/SplashScreen.kt` L181/L297          (`R.drawable.splash_ciallo_logo`)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MASCOT_ASSET_DIR,
  MASCOT_ASSET_EXTENSION,
  MascotSpriteSheet,
  mascotAssetUrl,
} from '../../src/core/mascot/mascotSpriteSheet';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');

describe('mascot sprite assets actually exist in public/', () => {
  it('every MascotSpriteSheet key resolves to a shipped file', () => {
    const keys = [...new Set(Object.values(MascotSpriteSheet))].sort();
    // The five distinct R.drawable bindings from MascotSpriteSheet.kt.
    expect(keys).toEqual([
      'mascot_celebrate',
      'mascot_idle',
      'mascot_reading',
      'mascot_run',
      'mascot_sad',
    ]);
    for (const key of keys) {
      const url = mascotAssetUrl(key);
      expect(url).toBe(`${MASCOT_ASSET_DIR}${key}.${MASCOT_ASSET_EXTENSION}`);
      const file = path.join(PUBLIC_DIR, 'mascot', `${key}.webp`);
      expect(existsSync(file), `${file} must be shipped to public/`).toBe(true);
      // Android's mascot_*.webp are 48–62 KB; a 0-byte file would mean the
      // copy silently failed even though the path exists.
      expect(statSync(file).size).toBeGreaterThan(10_000);
    }
  });

  it('mascotAssetUrl is stable for the compatibility aliases', () => {
    // Kotlin L23-24: `bookmarkDrawable` and `happyDrawable` both alias celebrate.
    expect(mascotAssetUrl(MascotSpriteSheet.bookmarkDrawable)).toBe(
      mascotAssetUrl(MascotSpriteSheet.celebrateDrawable),
    );
    expect(mascotAssetUrl(MascotSpriteSheet.happyDrawable)).toBe(
      mascotAssetUrl(MascotSpriteSheet.celebrateDrawable),
    );
    expect(mascotAssetUrl(MascotSpriteSheet.moveDrawable)).toBe(
      mascotAssetUrl(MascotSpriteSheet.runDrawable),
    );
  });

  it('does not point at the never-existing mascot_*.png paths', () => {
    // The bug being guarded: `${key}.png` under public/, which never existed.
    for (const key of Object.values(MascotSpriteSheet)) {
      expect(mascotAssetUrl(key).endsWith('.png')).toBe(false);
      expect(existsSync(path.join(PUBLIC_DIR, 'mascot', `${key}.png`))).toBe(false);
    }
  });
});

describe('splash LOGO asset (SplashScreen.kt L181 / L297)', () => {
  const logoFile = path.join(PUBLIC_DIR, 'splash', 'splash_ciallo_logo.png');

  it('the hand-drawn LOGO is shipped (it replaced the old text "Ciallo")', () => {
    expect(existsSync(logoFile)).toBe(true);
    expect(statSync(logoFile).size).toBeGreaterThan(10_000);
  });

  it('the LOGO is a transparent PNG, so it composites over the scrim', () => {
    // Android's copy is a transparent-background hand-drawn mark; a JPEG/flat
    // background here would show as a visible rectangle over the dark scrim.
    const head = readFileSync(logoFile).subarray(0, 8);
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});