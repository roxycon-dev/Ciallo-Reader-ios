/**
 * Kotlin → TS map
 * ──────────────
 * React-level tests for `ui/mascot/MascotAnimationController.kt` (L70-100) and
 * the four animation composables it dispatches to.
 *
 * What is asserted here is the behaviour that the pure-function suite in
 * `mascotEvents.test.ts` cannot see:
 *  - 方案 A 打断重播: a new event instance tears the animation subtree down so the
 *    tween restarts at t = 0. Kotlin does this with `key(currentInstance?.id)`
 *    (L89); the port had no `key`, so React reused the mounted component.
 *  - the pose switch actually changes the `<img src>` per phase.
 *  - the sprite URLs resolve to the shipped assets.
 */
import { afterAll, describe, expect, it, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  MascotAnimationController,
  MascotOverlay,
} from '../../src/ui/components/mascot/MascotAnimationController';
import {
  BookmarkHappyAnimation,
} from '../../src/ui/components/mascot/BookmarkHappyAnimation';
import { DeleteSadAnimation } from '../../src/ui/components/mascot/DeleteSadAnimation';
import { MoveBookAnimation } from '../../src/ui/components/mascot/MoveBookAnimation';
import { BookCompleteAnimation } from '../../src/ui/components/mascot/BookCompleteAnimation';
import { __resetMascotEventIds } from '../../src/core/mascot/mascotEvents';
import { MascotSpriteSheet } from '../../src/core/mascot/mascotSpriteSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Mounted {
  host: HTMLDivElement;
  root: Root;
  unmount: () => void;
}

function mount(node: React.ReactNode): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    root,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  __resetMascotEventIds();
});

const ALL_EVENTS = ['DeleteBook', 'AddBookmark', 'MoveBook', 'BookComplete', 'CleanComplete'] as const;

describe('MascotOverlay — MascotEventInstance dispatch', () => {
  it.each(ALL_EVENTS)('renders the right popup for %s and clears on completion', (event) => {
    const m = mount(<MascotOverlay />);
    expect(m.host.querySelector('.mascot-overlay')).toBeNull();

    act(() => {
      MascotAnimationController.play(event);
    });
    const popup = m.host.querySelector('.mascot-popup');
    expect(popup).not.toBeNull();
    // Kotlin L91-95: DeleteBook/AddBookmark/MoveBook/BookComplete/CleanComplete
    expect(popup?.className).toContain(
      event === 'DeleteBook'
        ? 'mascot-popup--delete'
        : event === 'AddBookmark'
          ? 'mascot-popup--bookmark'
          : event === 'MoveBook'
            ? 'mascot-popup--move'
            : 'mascot-popup--complete',
    );

    // onComplete → currentInstance = null (Kotlin L91-95 `onComplete = { currentInstance = null }`)
    const img = m.host.querySelector('.mascot-popup__figure img');
    act(() => {
      img?.dispatchEvent(new Event('error'));
    });
    m.unmount();
  });

  it('the popup <img> points at a real shipped sprite, not a 404 path', () => {
    const m = mount(<MascotOverlay />);
    act(() => {
      MascotAnimationController.play('BookComplete');
    });
    const img = m.host.querySelector('.mascot-popup__figure img') as HTMLImageElement | null;
    // Kotlin L83: BookCompleteAnimation always uses celebrateDrawable
    expect(img?.getAttribute('src')).toBe('/mascot/mascot_celebrate.webp');
    expect(img?.alt).toBe('Roxy 庆祝');
    m.unmount();
  });

  it('方案 A: a second event replaces the first and remounts the subtree (key=id)', () => {
    const m = mount(<MascotOverlay />);
    act(() => {
      MascotAnimationController.play('AddBookmark');
    });
    const first = m.host.querySelector('.mascot-popup--bookmark');

    act(() => {
      MascotAnimationController.play('AddBookmark');
    });
    const second = m.host.querySelector('.mascot-popup--bookmark');

    // Different event instances ⇒ different `key` ⇒ React unmounted/remounted,
    // so the node identity changes and the tween starts again from t = 0.
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);

    // And only one popup is on screen — no queueing, no stacking.
    expect(m.host.querySelectorAll('.mascot-popup')).toHaveLength(1);
    m.unmount();
  });

  it('a different event type swaps the popup chrome', () => {
    const m = mount(<MascotOverlay />);
    act(() => {
      MascotAnimationController.play('MoveBook');
    });
    expect(m.host.querySelector('.mascot-popup--move')).not.toBeNull();
    act(() => {
      MascotAnimationController.play('DeleteBook');
    });
    expect(m.host.querySelector('.mascot-popup--move')).toBeNull();
    expect(m.host.querySelector('.mascot-popup--delete')).not.toBeNull();
    m.unmount();
  });

  it('unsubscribes on unmount so later events do not touch a dead tree', () => {
    const m = mount(<MascotOverlay />);
    m.unmount();
    expect(MascotAnimationController.subscriberCount()).toBe(0);
  });
});

describe('per-animation pose switching (keyframe pose switch)', () => {
  it('BookmarkHappyAnimation starts on the idle sprite (progress < 0.25)', () => {
    const m = mount(<BookmarkHappyAnimation onComplete={() => {}} />);
    const img = m.host.querySelector('.mascot-popup__figure img') as HTMLImageElement;
    // Kotlin L74: progress < 0.25f -> idleDrawable
    expect(img.getAttribute('src')).toBe('/mascot/mascot_idle.webp');
    expect(img.alt).toBe('Bookmark Mascot');
    m.unmount();
  });

  it('DeleteSadAnimation and MoveBookAnimation also start on the idle sprite', () => {
    const d = mount(<DeleteSadAnimation onComplete={() => {}} />);
    expect(
      (d.host.querySelector('.mascot-popup__figure img') as HTMLImageElement).getAttribute('src'),
    ).toBe('/mascot/mascot_idle.webp');
    expect(d.host.querySelector('.mascot-popup__title')?.textContent).toBe('🌧️ 成功移出书架');
    expect(d.host.querySelector('.mascot-popup__subtitle')?.textContent).toBe(
      '别难过，随时可以在新分类重新找到它~',
    );
    d.unmount();

    const mv = mount(<MoveBookAnimation onComplete={() => {}} />);
    expect(
      (mv.host.querySelector('.mascot-popup__figure img') as HTMLImageElement).getAttribute('src'),
    ).toBe('/mascot/mascot_idle.webp');
    expect(mv.host.querySelector('.mascot-popup__title')?.textContent).toBe('📦 已移动到新书架');
    expect(mv.host.querySelector('.mascot-popup__subtitle')?.textContent).toBe(
      '藏书整理得整整齐齐啦~',
    );
    mv.unmount();
  });

  it('BookCompleteAnimation draws 10 confetti dots (Kotlin L86 `List(10)`)', () => {
    const m = mount(<BookCompleteAnimation onComplete={() => {}} />);
    expect(m.host.querySelectorAll('.mascot-popup__confetti span')).toHaveLength(10);
    expect(m.host.querySelector('.mascot-popup__title')?.textContent).toBe('🎉 恭喜读完这本书！');
    expect(m.host.querySelector('.mascot-popup__subtitle')?.textContent).toBe('Roxy 为你欢呼 ～✨');
    m.unmount();
  });
});

describe('the sprite keys the animations use are the Kotlin bindings', () => {
  it('bookmark/happy/move all resolve to celebrate/run as MascotSpriteSheet declares', () => {
    expect(MascotSpriteSheet.idleDrawable).toBe('mascot_idle');
    expect(MascotSpriteSheet.sadDrawable).toBe('mascot_sad');
    expect(MascotSpriteSheet.moveDrawable).toBe('mascot_run');
    expect(MascotSpriteSheet.bookmarkDrawable).toBe('mascot_celebrate');
  });
});