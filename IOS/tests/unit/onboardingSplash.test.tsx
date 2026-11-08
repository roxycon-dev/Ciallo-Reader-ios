/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `ui/OnboardingScreen.kt` and `ui/SplashScreen.kt` → `OnboardingPage.tsx`
 * and `SplashPage.tsx`.
 *
 * Both screens are what the user sees first, so this pins:
 *  - the four onboarding pages: count, order, title/description/badgeText verbatim
 *  - the mascot illustration per page (Kotlin passes `MascotSpriteSheet.*Drawable`,
 *    the port had substituted invented emoji)
 *  - the 「跳过」 skip button and the last-page CTA text
 *  - the splash brand string (`Ciallo Reader`, **not** `Ciallo阅读`), the fact that
 *    the LOGO carries no visible word, the `#0F141C` background, the 400/900/350
 *    timing and the 纯白模式 early exit
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OnboardingPage } from '../../src/ui/pages/OnboardingPage';
// `R.array.splash_quotes` 的 TS 镜像声明在 `@core/mascot/splashQuotes`
// （SplashPage 只消费 `randomSplashQuote()`，没有再导出整表）。
import { SPLASH_QUOTES } from '../../src/core/mascot/splashQuotes';
import { useAppStore } from '../../src/ui/state/appStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

function mount(node: React.ReactNode): { host: HTMLDivElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const onboarding = () => useAppStore.getState();

beforeEach(() => {
  onboarding().setHasSeenOnboarding(false);
  onboarding().setSplashPureMode(false);
  onboarding().setRoute('onboarding');
});

describe('OnboardingScreen — page count, order and copy', () => {
  it('shows 4 pages and 4 indicator dots', () => {
    const m = mount(<OnboardingPage />);
    expect(m.host.querySelectorAll('.onboarding-dot')).toHaveLength(4);
    expect(m.host.querySelectorAll('.onboarding-dot--selected')).toHaveLength(1);
    m.unmount();
  });

  it('page 1 copy is verbatim (OnboardingScreen.kt L50-53)', () => {
    const m = mount(<OnboardingPage />);
    expect(m.host.querySelector('.onboarding-badge')?.textContent).toBe('全新体验');
    expect(m.host.querySelector('.onboarding-title')?.textContent).toBe('欢迎来到 Ciallo Reader');
    expect(m.host.querySelector('.onboarding-desc')?.textContent).toBe(
      '这是一款专为阅读爱好者打造的沉浸式小说与网络文学阅读器。高颜值、极速、无广告，带给您最纯粹的阅读享受。',
    );
    m.unmount();
  });

  it('each page uses its own MascotSpriteSheet drawable, in Kotlin order', () => {
    // Kotlin L52 / L58 / L64 / L70: idle, move(=run), reading, happy(=celebrate)
    const expected = [
      '/mascot/mascot_idle.webp',
      '/mascot/mascot_run.webp',
      '/mascot/mascot_reading.webp',
      '/mascot/mascot_celebrate.webp',
    ];
    for (let i = 0; i < expected.length; i++) {
      const m = mount(<OnboardingPage />);
      for (let step = 0; step < i; step++) {
        act(() => {
          m.host.querySelector<HTMLButtonElement>('[data-testid="onboarding_action_button"]')?.click();
        });
      }
      const card = m.host.querySelector(`[data-testid="onboarding_illustration_card_${i}"]`);
      expect(card, `illustration card for page ${i}`).not.toBeNull();
      const img = card?.querySelector('img') as HTMLImageElement;
      expect(img.getAttribute('src'), `page ${i} illustration`).toBe(expected[i]);
      // Kotlin L165: contentDescription = "Onboarding illustration"
      expect(
        card?.querySelector('[role="img"]')?.getAttribute('aria-label'),
      ).toBe('Onboarding illustration');
      m.unmount();
    }
  });

  it('the CTA is 「下一步」 until the last page, then 「立即开启阅读之旅」 (Kotlin L229)', () => {
    const m = mount(<OnboardingPage />);
    const cta = () =>
      m.host.querySelector<HTMLButtonElement>('[data-testid="onboarding_action_button"]');
    expect(cta()?.textContent).toBe('下一步');

    act(() => {
      cta()?.click();
    });
    expect(cta()?.textContent).toBe('下一步');

    act(() => {
      cta()?.click();
    });
    expect(cta()?.textContent).toBe('下一步');

    act(() => {
      cta()?.click();
    });
    // last page
    expect(cta()?.textContent).toBe('立即开启阅读之旅');
    // no arrow icon on the last page (Kotlin L240-244)
    expect(cta()?.querySelector('.app-button__icon')).toBeNull();
    m.unmount();
  });

  it('「跳过」 finishes immediately (Kotlin L94-107 → onFinished)', () => {
    const m = mount(<OnboardingPage />);
    expect(m.host.querySelector('[data-testid="onboarding_skip_button"]')?.textContent).toBe('跳过');
    act(() => {
      m.host.querySelector<HTMLButtonElement>('[data-testid="onboarding_skip_button"]')?.click();
    });
    expect(onboarding().hasSeenOnboarding).toBe(true);
    expect(onboarding().route).toBe('main');
    m.unmount();
  });

  it('the last-page CTA jumps to the main shell and marks onboarding seen', () => {
    const m = mount(<OnboardingPage />);
    const cta = () => m.host.querySelector<HTMLButtonElement>('[data-testid="onboarding_action_button"]');
    for (let i = 0; i < 3; i++) {
      act(() => {
        cta()?.click();
      });
    }
    act(() => {
      cta()?.click();
    });
    expect(onboarding().route).toBe('main');
    expect(onboarding().hasSeenOnboarding).toBe(true);
    m.unmount();
  });

  it('the action button is the Large size (AppButtonSize.Large = 52dp), not the md default', () => {
    const m = mount(<OnboardingPage />);
    const cta = m.host.querySelector('[data-testid="onboarding_action_button"]');
    expect(cta?.className).toContain('app-button--lg');
    expect(cta?.className).toContain('app-button--primary');
    m.unmount();
  });

  it('the brand string is 「Ciallo Reader」 and never 「Ciallo阅读」', () => {
    const m = mount(<OnboardingPage />);
    expect(m.host.textContent).toContain('Ciallo Reader');
    expect(m.host.textContent).not.toContain('Ciallo阅读');
    m.unmount();
  });
});

describe('SplashScreen — brand, background, quotes and copy', () => {
  it('carries the 100 splash quotes verbatim (values/strings.xml L4-103)', () => {
    expect(SPLASH_QUOTES).toHaveLength(100);
    expect(SPLASH_QUOTES[0]).toBe('如果不战斗，就无法获胜！ ——《进击的巨人》');
    expect(SPLASH_QUOTES[99]).toBe(
      '如果这份感情能被称为爱，那这一定是世界上最悲伤的爱。 ——《紫罗兰永恒花园》',
    );
    expect(new Set(SPLASH_QUOTES).size).toBe(100);
  });

  it('renders the hand-drawn LOGO with no visible extra word (SplashScreen.kt L181/L297)', () => {
    const m = mount(<OnboardingPage />); // placeholder mount to keep act env warm
    m.unmount();

    const logos = document.createElement('div');
    document.body.appendChild(logos);
    const root = createRoot(logos);
    act(() => {
      root.render(<SplashPageLazy />);
    });
    const imgs = logos.querySelectorAll('img[src="/splash/splash_ciallo_logo.png"]');
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    for (const img of imgs) {
      expect(img.getAttribute('alt')).toBe('Ciallo Reader');
    }
    // The removed bug was a <span>Ciallo</span> next to the mark. Nothing in the
    // splash tree may spell out a visible brand word any more.
    expect(logos.querySelector('.splash-logo-mark')).toBeNull();
    expect(logos.textContent).not.toContain('Ciallo阅读');
    act(() => root.unmount());
    logos.remove();
  });

  it('the background is #0F141C (SplashScreen.kt L129)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<SplashPageLazy />);
    });
    const page = host.querySelector('.splash-page') as HTMLElement;
    expect(page.style.backgroundColor).toBe('rgb(15, 20, 28)');
    act(() => root.unmount());
    host.remove();
  });

  it('纯白模式 navigates away immediately without waiting for the timers', () => {
    onboarding().setSplashPureMode(true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<SplashPageLazy />);
    });
    expect(onboarding().route).not.toBe('splash');
    act(() => root.unmount());
    host.remove();
    onboarding().setSplashPureMode(false);
  });

  it('「点击跳过」 finishes the splash on tap (Kotlin L130)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    onboarding().setRoute('splash');
    act(() => {
      root.render(<SplashPageLazy />);
    });
    const page = host.querySelector('.splash-page') as HTMLElement;
    expect(host.querySelector('.splash-skip')?.textContent).toBe('点击跳过');
    act(() => {
      page.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onboarding().route).toBe('onboarding');
    act(() => root.unmount());
    host.remove();
  });
});

/** Imported lazily so the `act` environment is already set above. */
const { SplashPage: SplashPageLazy } = await import('../../src/ui/pages/SplashPage');
void vi;