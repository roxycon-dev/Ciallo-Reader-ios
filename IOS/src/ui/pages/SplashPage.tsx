import { useCallback, useEffect, useRef, useState } from 'react';
import { randomPosterStyle, randomSplashQuote } from '@core/mascot/splashQuotes';
import { useAppStore } from '@ui/state/appStore';
import '../../styles/splash.css';

/**
 * Ported line-by-line from Android SplashScreen.kt.
 *
 * Android reference behavior:
 *  - Box fillMaxSize, background Color(0xFF0F141C), clickable → safeOnSplashFinished()
 *  - scale Animatable(1.05f) → 1.0 over tween(800ms)
 *  - alpha Animatable(0f) → 1.0 tween(400ms), delay(900ms), → 0f tween(350ms), finally navigate
 *  - isPureMode: navigate immediately (no poster shown)
 *  - randomQuote from R.array.splash_quotes (100 items, `src/core/mascot/splashQuotes.ts`),
 *    fallback single quote
 *  - defaultPosterStyle = (0..2).random()
 *  - ProceduralArtisticPoster: 3 palettes, vertical gradient + radial glow Canvas
 *  - bottom scrim: fillMaxHeight(0.38f), Brush.verticalGradient(Transparent → Black 0.82)
 *  - bottom Column padding(bottom=48, start=24, end=24): logo width 168dp + Spacer(10dp) + quote 13sp White 0.9
 *  - "点击跳过" 12sp White 0.5, bottom 16dp
 *
 * REVIEW 2026-10-06
 *  F4 the hand-drawn LOGO (`R.drawable.splash_ciallo_logo`) had been replaced by a
 *     text span "Ciallo". Android draws **no** visible word there — the brand
 *     string lives only in `contentDescription = "Ciallo Reader"`. The real asset
 *     is now shipped (`public/splash/splash_ciallo_logo.png`) and both call sites
 *     (144dp in-card, 168dp bottom) render it.
 *  F5 the in-card LOGO carried `scale(${scale})`. Kotlin only puts the zoom layer
 *     on the 168dp bottom LOGO (L186-189); the 144dp Surface LOGO (L300) is static.
 *  F6 MISSING — `prefs.customSplashPosterUri` (L58, L140-158). The port always
 *     drew the procedural poster, so a user-set custom splash poster was ignored
 *     even though SettingsPage persists `custom_splash_poster_uri`.
 *  F11 `eslint-disable react-hooks/exhaustive-deps` removed (protocol §5): the
 *     `safeOnSplashFinished` latch now lives in refs, matching `isFinishedCalled`.
 */

// `R.array.splash_quotes` (res/values/splash_quotes.xml, 100 <item> entries)
// is NOT duplicated here any more: it lives in the pure-data module
// `src/core/mascot/splashQuotes.ts`, byte-identical to the Android resource and pinned
// by `tests/unit/splashQuotes.test.ts` (length + per-entry shape + SHA-256 + a live
// re-read of the XML). One copy means the 100 strings cannot drift apart.

/** ProceduralArtisticPoster palette lookup — exact branch colors from SplashScreen.kt L249-253 */
function posterPalette(styleIndex: number): readonly [string, string, string, string] {
  if (styleIndex === 1) return ['#2A1E14', '#4A2C1A', '#14100C', 'rgba(255, 183, 77, 0.2)'];
  if (styleIndex === 2) return ['#101C2E', '#1B2F52', '#0A1020', 'rgba(127, 168, 255, 0.2)'];
  return ['#141923', '#1E2838', '#0D1118', 'rgba(127, 216, 200, 0.2)'];
}

// remember {} equivalents — computed once at module load (Kotlin `remember` = per composition,
// single-splash-mount in our case), keeps render pure for react-hooks/purity lint.
const RANDOM_QUOTE: string = randomSplashQuote(Math.random);
const POSTER_STYLE: number = randomPosterStyle(Math.random);

/**
 * REVIEW 2026-10-06 — `R.drawable.splash_ciallo_logo`, copied byte-identical to
 * `public/splash/splash_ciallo_logo.png`. The port had substituted a text span
 * reading "Ciallo" for the hand-drawn LOGO, which is both a MISSING (the asset)
 * and an EXTRA (Android draws **no** visible word next to / instead of the mark —
 * the only text is `contentDescription = "Ciallo Reader"` on the Image itself).
 */
const LOGO_SRC = '/splash/splash_ciallo_logo.png';
const LOGO_ALT = 'Ciallo Reader';

/** SplashScreen.kt L296-301 — the in-Surface LOGO is 144dp and is NOT scaled. */
function InCardLogo() {
  return <img className="splash-logo-img" src={LOGO_SRC} alt={LOGO_ALT} />;
}

/** SplashScreen.kt L180-190 — the bottom LOGO is 168dp and carries the zoom layer. */
function BottomLogo(props: { scale: number }) {
  return (
    <img
      className="splash-logo-img splash-logo-img--lg"
      src={LOGO_SRC}
      alt={LOGO_ALT}
      style={{ transform: `scale(${props.scale})` }}
    />
  );
}

export function SplashPage() {
  const setRoute = useAppStore((s) => s.setRoute);
  const hasSeenOnboarding = useAppStore((s) => s.hasSeenOnboarding);
  const splashPureMode = useAppStore((s) => s.splashPureMode);

  /**
   * SplashScreen.kt L58 / L65-78 — `prefs.customSplashPosterUri`: when a custom
   * poster is set and decodes, it replaces the procedural poster (Crop + the
   * scale zoom); decoding in flight holds a flat `0xFF0F141C` fill so the default
   * art never flashes. A decode failure falls back to the procedural poster.
   *
   * The web has no `content://` resolver, so the URI is used as-is (`<img src>`);
   * load success/failure is detected with the same onLoad/onError pair that
   * stands in for `BitmapFactory.decodeStream` returning null.
   */
  const [customPosterUri, setCustomPosterUri] = useState('');
  const [customPosterState, setCustomPosterState] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        const { SettingsRepository } = await import('@core/settings/settingsRepository');
        const uri = await new SettingsRepository(getPlatform().db).getString(
          'custom_splash_poster_uri',
          '',
        );
        if (!cancelled && uri !== '') setCustomPosterUri(uri);
      } catch {
        // 读不到设置就用默认程序化海报（与 Kotlin 解码失败的兜底同一语义）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Kotlin L152-158:
   *   `customBitmap != null`                                  → custom poster
   *   `else if (customPoster.isNullOrEmpty() || customDecodeFinished)` → procedural poster
   *   `else`                                                  → flat 0xFF0F141C fill
   * `state === 'fail'` plays the role of `customDecodeFinished && customBitmap == null`.
   */
  const showCustomPoster = customPosterState === 'ok';
  const showProceduralPoster =
    customPosterState !== 'ok' && (customPosterUri === '' || customPosterState === 'fail');

  // randomQuote = remember(splashQuotes) { splashQuotes.random() }
  // defaultPosterStyle = remember { (0..2).random() }
  const randomQuote = RANDOM_QUOTE;
  const palette = posterPalette(POSTER_STYLE);

  // scale Animatable(1.05f) → 1.0 tween(800ms)
  const [scale, setScale] = useState(1.05);
  // alpha Animatable(0f) → 1.0 tween(400ms), delay 900, → 0f tween(350ms)
  const [alpha, setAlpha] = useState(0);

  /**
   * Kotlin L80-89 `safeOnSplashFinished`: the `isFinishedCalled` latch plus the
   * `remember`ed lambda. The latch is a ref (not state — it must never re-render),
   * and `finish` is kept in a ref so the timer effect can read the *current*
   * `hasSeenOnboarding` without listing it as a dependency. That mirrors Compose,
   * where the remembered lambda also closes over the latest composition state,
   * and removes the `eslint-disable` the old dep array needed.
   */
  const finishedRef = useRef(false);
  const hasSeenOnboardingRef = useRef(hasSeenOnboarding);
  useEffect(() => {
    hasSeenOnboardingRef.current = hasSeenOnboarding;
  }, [hasSeenOnboarding]);
  // Stable identity (empty deps): the effect below keys on it and must not restart.
  const finish = useCallback((): void => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setRoute(hasSeenOnboardingRef.current ? 'main' : 'onboarding');
  }, [setRoute]);

  // LaunchedEffect(Unit): scale.animateTo(1.0f, tween(800))
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 800, 1);
      setScale(1.05 + (1.0 - 1.05) * t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // LaunchedEffect(Unit): alpha sequence / pure-mode early exit
  useEffect(() => {
    if (splashPureMode) {
      // 纯净模式：不显示任何开屏海报，直接进入软件
      finish();
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    // Navigation follows wall-clock duration even when WebKit suspends frames.
    // A visual animation callback must never trap the user on the launch screen.
    timers.push(window.setTimeout(finish, 400 + 900 + 350));
    const start = performance.now();
    let raf = 0;
    // Phase 1: fade in 400ms
    const fadeIn = (now: number) => {
      if (cancelled) return;
      const t = Math.min((now - start) / 400, 1);
      setAlpha(t);
      if (t < 1) {
        raf = requestAnimationFrame(fadeIn);
      } else {
        // 开屏海报最长停留 900ms（可点击随时跳过）
        timers.push(
          window.setTimeout(() => {
            // Phase 3: fade out 350ms, then finish (finally { safeOnSplashFinished() })
            const outStart = performance.now();
            const fadeOut = (now2: number) => {
              if (cancelled) return;
              const t2 = Math.min((now2 - outStart) / 350, 1);
              setAlpha(1 - t2);
              if (t2 < 1) raf = requestAnimationFrame(fadeOut);
              else finish();
            };
            raf = requestAnimationFrame(fadeOut);
          }, 900),
        );
      }
    };
    raf = requestAnimationFrame(fadeIn);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => clearTimeout(id));
    };
  }, [splashPureMode, finish]);

  const rootStyle = { backgroundColor: '#0F141C' };

  return (
    <div className="splash-page" style={rootStyle} onClick={finish} role="presentation">
      <div className="splash-layer" style={{ opacity: alpha }}>
        {showCustomPoster ? (
          /* customBitmap != null — Image(contentScale = Crop, scale zoom) */
          <img
            className="splash-custom-poster"
            src={customPosterUri}
            alt="开屏海报"
            style={{ transform: `scale(${scale})` }}
          />
        ) : showProceduralPoster ? (
          <>
            {/* ProceduralArtisticPoster — palette gradient + radial glow */}
            <div
              className="splash-poster"
              style={{
                background: `linear-gradient(180deg, ${palette[0]} 0%, ${palette[1]} 50%, ${palette[2]} 100%)`,
              }}
            >
              {/* Canvas drawCircle: centre (w/2, h*0.4), radius w*0.7 — the geometry
                  lives in splash.css; `color` feeds its `currentcolor` stop. */}
              <div className="splash-glow" style={{ color: palette[3] }} />
              {/* Surface shape=RoundedCornerShape(20.dp), color=White 0.08, padding 32 → Column padding 24 */}
              <div className="splash-card">
                <InCardLogo />
              </div>
            </div>
          </>
        ) : null}

        {/* Bottom scrim: fillMaxHeight(0.38), Transparent → Black 0.82 */}
        <div className="splash-scrim" />

        {/* bottom Column: padding(bottom 48, start 24, end 24) */}
        <div className="splash-bottom">
          <BottomLogo scale={scale} />
          <div className="splash-spacer" />
          <p className="splash-quote">{randomQuote}</p>
        </div>

        {/* Text "点击跳过" 12sp White 0.5, BottomCenter padding(bottom 16) */}
        <div className="splash-skip">点击跳过</div>

        {/* Decode probe: an off-screen <img> resolves the Crop/load outcome that
            `decodeSplashBitmap` decides on the IO thread (L68-78). */}
        {customPosterUri !== '' && customPosterState === 'idle' ? (
          <img
            aria-hidden="true"
            alt=""
            src={customPosterUri}
            className="splash-poster-probe"
            onLoad={() => setCustomPosterState('ok')}
            onError={() => setCustomPosterState('fail')}
          />
        ) : null}
      </div>
    </div>
  );
}
