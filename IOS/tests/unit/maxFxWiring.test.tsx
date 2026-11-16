/**
 * Kotlin → TS map
 * ──────────────
 * E98 wiring tests for the MAX render tier:
 *
 *  - `ui/components/GlassCard.kt` L549-561 `Modifier.maxCardAura(primary, auroraSecondary)`
 *    L594 `Modifier.glassSheen()` · L598 `Modifier.shimmerPearl(primary)`
 *    → `MaxCardLayers` mounted by `GlassCard` inside `.glass-card__max-fx`,
 *      in that draw order and below the light-path / rim / prism layers
 *      (L815-965) that follow them in the modifier chain.
 *  - L547-553 `auroraSecondary = secondary + (tertiary - secondary) * 0.45`
 *    → `auroraSecondary()` per channel.
 *  - `MainActivity.kt` L369-375 `ScrollTiltHost` mounted only at MAX;
 *    `ui/components/ScrollTilt.kt` L131-184 `scrollTiltSource`
 *    → `ScrollTiltHost` / `useScrollTiltSource` drive `--glass-tilt-deg`, which
 *      the MAX card transform reads through `var()` (Compose's deferred
 *      `graphicsLayer` read of `scrollTilt.tiltDeg`).
 *
 * Everything asserted below is either a Kotlin line or the DOM contract that
 * carries it; the non-MAX tiers must stay byte-identical (see the report's
 * markup diff).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { GlassCard } from '../../src/ui/components/GlassCard';
import { auroraSecondary } from '../../src/ui/components/GlassCardLayers';
import { RENDER_QUALITY_LIST, RenderQualityProvider } from '../../src/ui/components/GlassQuality';
import {
  SCROLL_TILT_CSS_VAR,
  ScrollTiltController,
  ScrollTiltHost,
  useScrollTiltSource,
} from '../../src/ui/components/ScrollTilt';
import { AURA_ALPHA_MIN } from '../../src/core/glass/maxFx';
import { withAlpha } from '../../src/core/glass/color';
import { COLORS } from '../../src/ui/theme/tokens';
import type { RenderQualityName } from '../../src/core/glass/renderQuality';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Mounted {
  host: HTMLDivElement;
  root: Root;
  unmount: () => void;
}

const mounted: Mounted[] = [];

function mount(node: React.ReactNode): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  const entry: Mounted = {
    host,
    root,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount();
});

/** jsdom has no layout: the card reports a 240 × 160 box like a grid tile. */
const CARD_BOX = { width: 240, height: 160 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function rect(): DOMRect {
    return {
      ...CARD_BOX,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: CARD_BOX.width,
      bottom: CARD_BOX.height,
      toJSON: () => ({}),
    } as DOMRect;
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

function renderCard(quality: RenderQualityName): Mounted {
  return mount(
    <RenderQualityProvider quality={quality}>
      <GlassCard radius={16} padding={12} className="probe-card">
        <span>probe</span>
      </GlassCard>
    </RenderQualityProvider>,
  );
}

function maxLayerNames(card: Element | null): string[] {
  if (card === null) return [];
  return Array.from(card.querySelectorAll('[data-max-layer]')).map(
    (el) => el.getAttribute('data-max-layer') ?? '',
  );
}

describe('MAX tier layers are mounted by GlassCard (GlassCard.kt L549-598)', () => {
  it('renders zero MAX nodes for MINIMAL / LOW / MID / HIGH', () => {
    for (const quality of RENDER_QUALITY_LIST) {
      if (quality === 'MAX') continue;
      const { host, unmount } = renderCard(quality);
      const card = host.querySelector('.glass-card');
      expect(card, quality).not.toBeNull();
      expect(host.querySelector('[data-max-layer]'), quality).toBeNull();
      expect(host.querySelector('.glass-card__max-fx'), quality).toBeNull();
      unmount();
    }
  });

  it('stacks aura → sheen → pearl, below the light path and the prism edge', () => {
    const { host } = renderCard('MAX');
    const card = host.querySelector('.glass-card');
    expect(maxLayerNames(card)).toEqual(['aura', 'sheen', 'pearl']);

    const wrapper = card?.firstElementChild;
    expect(wrapper?.className).toBe('glass-card__max-fx');
    expect(wrapper?.querySelectorAll('[data-max-layer]').length).toBe(3);

    // The wrapper sits before the very first `.glass-card__layer`, i.e. the whole
    // MAX group paints under the light path → rim → prism layers, exactly like the
    // modifier chain order (aura L557 < sheen L594 < pearl L598 < light path L815
    // < prism L895).
    const lightPath = card?.querySelector('.glass-card__light-path') ?? null;
    const prism = card?.querySelector('.glass-card__prism') ?? null;
    const pearl = card?.querySelector('[data-max-layer="pearl"]') ?? null;
    expect(lightPath).not.toBeNull();
    expect(prism).not.toBeNull();
    expect(pearl?.compareDocumentPosition(lightPath as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(pearl?.compareDocumentPosition(prism as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    // The aura gradient must carry `auroraSecondary` (secondary → tertiary 45%),
    // not the raw secondary: c2 = auroraSecondary at hueShift = 0.
    const aura = card?.querySelector('[data-max-layer="aura"]');
    const expected = auroraSecondary(COLORS.secondaryPalette[2] ?? '', COLORS.primaryPalette[2] ?? '');
    const rgbPrefix = withAlpha(expected, AURA_ALPHA_MIN).replace(/0\)$/, '');
    expect(aura?.getAttribute('style')).toContain(rgbPrefix);
  });

  it('drops the MAX group again when the tier falls back to HIGH', () => {
    const { host, root } = renderCard('MAX');
    const card = host.querySelector('.glass-card');
    expect(maxLayerNames(card)).toEqual(['aura', 'sheen', 'pearl']);
    expect(card?.getAttribute('style')).toContain(`var(${SCROLL_TILT_CSS_VAR}, 0deg)`);

    act(() => {
      root.render(
        <RenderQualityProvider quality="HIGH">
          <GlassCard radius={16} padding={12} className="probe-card">
            <span>probe</span>
          </GlassCard>
        </RenderQualityProvider>,
      );
    });

    const after = host.querySelector('.glass-card');
    expect(maxLayerNames(after)).toEqual([]);
    expect(host.querySelector('.glass-card__max-fx')).toBeNull();
    expect(after?.getAttribute('style') ?? '').not.toContain(SCROLL_TILT_CSS_VAR);
  });
});

describe('auroraSecondary (GlassCard.kt L547-553)', () => {
  it('lerps every channel 45% from secondary toward tertiary, rounded like Color(float×4)', () => {
    // r 16 + (5-16)*0.45 = 11.05 → 11; g 185 + (150-185)*0.45 = 169.25 → 169;
    // b 129 + (105-129)*0.45 = 118.2 → 118
    expect(auroraSecondary('#10B981', '#059669')).toBe('#0BA976');
    // r 59 + (37-59)*0.45 = 49.1 → 49; g 130 + (99-130)*0.45 = 116.05 → 116;
    // b 246 + (235-246)*0.45 = 241.05 → 241
    expect(auroraSecondary('#3B82F6', '#2563EB')).toBe('#3174F1');
    // 255 + (0-255)*0.45 = 140.25 → 140 ; 0 + 255*0.45 = 114.75 → 115
    expect(auroraSecondary('#FFFFFF', '#000000')).toBe('#8C8C8C');
    expect(auroraSecondary('#000000', '#FFFFFF')).toBe('#737373');
  });

  it('keeps the secondary when a token is not a hex colour (alpha stays opaque)', () => {
    expect(auroraSecondary('var(--accent)', '#059669')).toBe('var(--accent)');
    expect(auroraSecondary('#10B981', 'transparent')).toBe('#10B981');
  });
});

describe('ScrollTiltHost (ScrollTilt.kt L119-124 / MainActivity.kt L369-375)', () => {
  it('starts no frame loop while disabled, and keeps the signal at zero', () => {
    const controller = new ScrollTiltController();
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    function DisabledHost(): null {
      ScrollTiltHost({ enabled: false, controller });
      return null;
    }
    mount(<DisabledHost />);
    expect(raf).not.toHaveBeenCalled();
    expect(controller.tiltDeg).toBe(0);
    raf.mockRestore();
  });
});

describe('useScrollTiltSource → --glass-tilt-deg (ScrollTilt.kt L131-184)', () => {
  it('reports scroll velocity and the host publishes it as a CSS custom property', async () => {
    const controller = new ScrollTiltController();
    let offset = 0;

    function TiltHarness(): React.ReactElement {
      const handle = ScrollTiltHost({ enabled: true, controller });
      useScrollTiltSource(controller, () => ({ idx: 0, offset, itemSize: 120 }));
      return <div ref={handle.hostRef} className="tilt-host" />;
    }

    const { host } = mount(<TiltHarness />);
    const el = host.querySelector('.tilt-host') as HTMLElement | null;
    expect(el).not.toBeNull();

    // First sample only seeds the sampler (prev == MIN_VALUE).
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(controller.targetDeg).toBe(0);

    // 480 px in ~25 ms ⇒ 19 px/ms ⇒ clamped to SCROLL_TILT_MAX_DEG.
    offset = 480;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(controller.targetDeg).toBeGreaterThan(0);

    // Let a few frame callbacks run before the 120 ms idle timeout decays the goal.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const published = Number((el as HTMLElement).style.getPropertyValue(SCROLL_TILT_CSS_VAR));
    expect(Number.isFinite(published)).toBe(true);
    expect(published).toBeGreaterThan(0);
    expect(published).toBeLessThanOrEqual(4.5);
  });
});

describe('MAX card transform reads the scroll-tilt signal (GlassCard.kt L423-431)', () => {
  it('uses var(--glass-tilt-deg) inside the Kotlin clamp on MAX only', () => {
    const { host } = renderCard('MAX');
    const transform = host.querySelector('.glass-card')?.getAttribute('style') ?? '';
    expect(transform).toContain(`var(${SCROLL_TILT_CSS_VAR}, 0deg)`);
    // maxTotal = CardTweaks.tiltMaxDeg (6) + ScrollTiltController.SCROLL_TILT_MAX_DEG (4.5)
    expect(transform).toContain('clamp(-10.500deg');
    expect(transform).toContain('10.500deg)');
    expect(transform).toContain('rotateX(');
    expect(transform).toContain('rotateY(0.000deg)');
  });

  it('leaves the HIGH card without any tilt expression', () => {
    const { host } = renderCard('HIGH');
    const card = host.querySelector('.glass-card');
    expect(card?.getAttribute('style') ?? '').not.toContain('rotateX(');
    expect(card?.getAttribute('style') ?? '').not.toContain(SCROLL_TILT_CSS_VAR);
  });
});
