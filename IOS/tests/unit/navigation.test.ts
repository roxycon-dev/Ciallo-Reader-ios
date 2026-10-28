/**
 * 导航图单元测试 — 对照 Android `MainActivity.kt`。
 *
 * 覆盖：路由表完整性、栈 push/pop/popUpTo(inclusive)/launchSingleTop、
 * 开屏与引导跳转、ComicJumpState、sanitize、章节本地下载判定、
 * formatShelfBytes、启动看门狗。
 */
import { describe, expect, it } from 'vitest';
import {
  BOOT_GUARD_MAX_CRASHES,
  BOOT_GUARD_WINDOW_MS,
  NavStack,
  NAV_FADE_MS,
  NAV_INTENTS,
  RENDER_QUALITY_EXTREME,
  RENDER_QUALITY_HIGH,
  ROUTES,
  TAB_ITEMS,
  comicJump,
  disarmBootGuard,
  formatShelfBytes,
  isChapterDownloadedLocally,
  runBootGuard,
  sanitizeFileName,
  type BootPrefsLike,
} from '@core/app/navigation';

function fakePrefs(initial: Record<string, number> = {}): BootPrefsLike & {
  data: Record<string, number>;
} {
  const data: Record<string, number> = { ...initial };
  return {
    data,
    getInt: (key, fallback) => data[key] ?? fallback,
    getLong: (key, fallback) => data[key] ?? fallback,
    putInt: (key, value) => {
      data[key] = value;
    },
    putLong: (key, value) => {
      data[key] = value;
    },
  };
}

describe('ROUTES', () => {
  it('matches every Kotlin composable("…") route name', () => {
    expect(Object.values(ROUTES).sort()).toEqual(
      [
        'cache_management',
        'comic_chapters',
        'comic_reader',
        'comic_reader_online',
        'god_editor',
        'god_ranking',
        'home',
        'novel_reader_online',
        'onboarding',
        'reader',
        'settings',
        'source_management',
        'splash',
      ].sort(),
    );
  });

  it('nav transitions use 250ms fade (MainActivity L445-448)', () => {
    expect(NAV_FADE_MS).toBe(250);
  });
});

describe('TAB_ITEMS', () => {
  it('has the current five Android tabs with label + outlined/filled icons', () => {
    expect(TAB_ITEMS.map((t) => t.label)).toEqual(['书库', '发现', '书架', '统计', '设置']);
    for (const item of TAB_ITEMS) {
      expect(item.outlinedIcon).not.toBe('');
      expect(item.filledIcon).not.toBe('');
    }
  });
});

describe('NavStack', () => {
  it('starts at splash', () => {
    const nav = new NavStack();
    expect(nav.current).toBe('splash');
    expect(nav.canGoBack()).toBe(false);
  });

  it('pushes and pops LIFO', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.reader);
    expect(nav.current).toBe('reader');
    expect(nav.popBackStack()).toBe(true);
    expect(nav.current).toBe('home');
    expect(nav.popBackStack()).toBe(true);
    expect(nav.current).toBe('splash');
    expect(nav.popBackStack()).toBe(false);
  });

  it('popUpTo inclusive removes the named route too (L459-460)', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.reader);
    nav.navigate(ROUTES.settings);
    nav.navigate('home', { popUpTo: 'home', inclusive: true });
    expect(nav.current).toBe('home');
    expect(nav.snapshot()).toEqual(['splash', 'home']);
  });

  it('popUpTo non-inclusive keeps the named route', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.reader);
    nav.navigate('home', { popUpTo: 'home' });
    expect(nav.snapshot()).toEqual(['splash', 'home']);
  });

  it('launchSingleTop avoids duplicating an already-top route (L1442)', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.home, { launchSingleTop: true });
    expect(nav.snapshot()).toEqual(['splash', 'home']);
  });

  it('launchSingleTop still pushes when the route is not the top', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.comicChapters);
    nav.navigate(ROUTES.home, { launchSingleTop: true });
    expect(nav.snapshot().length).toBe(4);
    expect(nav.current).toBe(ROUTES.home);
  });

  it('popBackTo returns to a named route, inclusive or not', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.reader);
    nav.navigate(ROUTES.comicReader);
    expect(nav.popBackTo(ROUTES.home)).toBe(true);
    expect(nav.snapshot()).toEqual(['splash', 'home']);
    expect(nav.popBackTo(ROUTES.splash)).toBe(true);
    expect(nav.snapshot()).toEqual(['splash']);
    expect(nav.popBackTo('nonexistent')).toBe(false);
  });

  it('popBackTo inclusive drops the target too', () => {
    const nav = new NavStack();
    nav.navigate(ROUTES.home);
    nav.navigate(ROUTES.reader);
    nav.popBackTo(ROUTES.home, true);
    expect(nav.snapshot()).toEqual(['splash']);
  });
});

describe('NavStack.leaveSplash', () => {
  it('goes home when onboarding was seen (L457)', () => {
    const nav = new NavStack();
    nav.leaveSplash(true);
    expect(nav.snapshot()).toEqual(['home']);
  });

  it('goes onboarding when not seen, without leaving splash behind', () => {
    const nav = new NavStack();
    nav.leaveSplash(false);
    expect(nav.snapshot()).toEqual(['onboarding']);
  });
});

describe('comicJump', () => {
  it('starts at 0 / -1 (MainActivity L77-81)', () => {
    comicJump.reset();
    expect(comicJump.startPage).toBe(0);
    expect(comicJump.lastPage).toBe(-1);
  });

  it('reset clears both fields', () => {
    comicJump.startPage = 12;
    comicJump.lastPage = 34;
    comicJump.reset();
    expect(comicJump.startPage).toBe(0);
    expect(comicJump.lastPage).toBe(-1);
  });
});

describe('sanitizeFileName', () => {
  it('replaces illegal characters with underscore (L1312)', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('trims and caps at 120 chars (L1313-1314)', () => {
    expect(sanitizeFileName('   名字   ')).toBe('名字');
    expect(sanitizeFileName('x'.repeat(200))).toHaveLength(120);
  });
});

describe('isChapterDownloadedLocally', () => {
  const books = [
    { title: sanitizeFileName('作品 · 第1话'), isComic: true, sourceId: 's1', comicId: 'c1' },
    { title: sanitizeFileName('作品 · 第2话'), isComic: true, sourceId: null, comicId: null },
    { title: sanitizeFileName('作品 · 第3话'), isComic: false, sourceId: 's1', comicId: 'c1' },
  ];

  it('matches by source-scoped key', () => {
    expect(isChapterDownloadedLocally('第1话', '作品', 's1', 'c1', books)).toBe(true);
  });

  it('matches a local (no source) copy', () => {
    expect(isChapterDownloadedLocally('第2话', '作品', 's1', 'c1', books)).toBe(true);
  });

  it('rejects non-comic rows', () => {
    expect(isChapterDownloadedLocally('第3话', '作品', 's1', 'c1', books)).toBe(false);
  });

  it('rejects when the comic title is blank (L1316)', () => {
    expect(isChapterDownloadedLocally('第1话', '  ', 's1', 'c1', books)).toBe(false);
  });

  it('rejects a different source key', () => {
    expect(isChapterDownloadedLocally('第1话', '作品', 's2', 'c2', books)).toBe(false);
  });
});

describe('formatShelfBytes', () => {
  it('formats GB / MB / KB / B', () => {
    expect(formatShelfBytes(512)).toBe('512 B');
    expect(formatShelfBytes(2048)).toBe('2.0 KB');
    expect(formatShelfBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatShelfBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('boot guard', () => {
  it('does nothing below 极致 (MainActivity L121)', () => {
    const prefs = fakePrefs({ render_quality: RENDER_QUALITY_HIGH });
    expect(runBootGuard(prefs, 1000)).toEqual({ downgraded: false, disarm: false });
  });

  it('arms on the first 极致 crash and asks to disarm on survival', () => {
    const prefs = fakePrefs({ render_quality: RENDER_QUALITY_EXTREME });
    const result = runBootGuard(prefs, 1000);
    expect(result.downgraded).toBe(false);
    expect(result.disarm).toBe(true);
    expect(prefs.data.boot_guard_cnt).toBe(1);
  });

  it('counts a crash within the 20s window', () => {
    const prefs = fakePrefs({
      render_quality: RENDER_QUALITY_EXTREME,
      boot_guard_last: 1000,
      boot_guard_cnt: 0,
    });
    const result = runBootGuard(prefs, 1000 + BOOT_GUARD_WINDOW_MS - 1);
    expect(result.downgraded).toBe(false);
    expect(prefs.data.boot_guard_cnt).toBe(1);
  });

  it('downgrades to 高 on the second crash inside the window', () => {
    const prefs = fakePrefs({
      render_quality: RENDER_QUALITY_EXTREME,
      boot_guard_last: 1000,
      boot_guard_cnt: 1,
    });
    const result = runBootGuard(prefs, 1000 + BOOT_GUARD_WINDOW_MS - 1);
    expect(result.downgraded).toBe(true);
    expect(prefs.data.render_quality).toBe(RENDER_QUALITY_HIGH);
    expect(prefs.data.boot_guard_cnt).toBe(0);
    expect(prefs.data.boot_guard_last).toBe(0);
  });

  it('resets the counter when the crash is outside the window', () => {
    const prefs = fakePrefs({
      render_quality: RENDER_QUALITY_EXTREME,
      boot_guard_last: 1000,
      boot_guard_cnt: 5,
    });
    const result = runBootGuard(prefs, 1000 + BOOT_GUARD_WINDOW_MS + 1);
    expect(result.downgraded).toBe(false);
    expect(prefs.data.boot_guard_cnt).toBe(1);
  });

  it('never exceeds the crash threshold', () => {
    expect(BOOT_GUARD_MAX_CRASHES).toBe(2);
    expect(BOOT_GUARD_WINDOW_MS).toBe(20_000);
  });

  it('disarmBootGuard clears the arming timestamp', () => {
    const prefs = fakePrefs({ boot_guard_last: 500 });
    disarmBootGuard(prefs);
    expect(prefs.data.boot_guard_last).toBe(0);
  });
});

describe('NAV_INTENTS', () => {
  it('points every intent at a real route', () => {
    const routes = new Set<string>(Object.values(ROUTES));
    for (const intent of Object.values(NAV_INTENTS)) {
      expect(routes.has(intent.route)).toBe(true);
    }
  });

  it('splash/onboarding intents pop up to themselves inclusively', () => {
    expect(NAV_INTENTS.finishSplash.popUpTo).toBe(ROUTES.splash);
    expect(NAV_INTENTS.finishSplash.inclusive).toBe(true);
    expect(NAV_INTENTS.finishOnboarding.popUpTo).toBe(ROUTES.onboarding);
    expect(NAV_INTENTS.finishOnboarding.inclusive).toBe(true);
  });

  it('back-to-home uses launchSingleTop', () => {
    expect(NAV_INTENTS.backToHome.launchSingleTop).toBe(true);
  });
});
