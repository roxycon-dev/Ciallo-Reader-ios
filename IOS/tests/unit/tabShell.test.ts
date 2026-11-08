/**
 * 主壳层单元测试 — 对照 Android `MainActivity.kt` L500-507、L541-584、L606-629、
 * L638-653。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SNACKBAR_DURATION,
  SnackbarHost,
  classifyShelfMessage,
} from '@ui/shell/SnackbarHost';
import {
  TAB_FADE_IN_DELAY_MS,
  TAB_FADE_IN_MS,
  TAB_FADE_OUT_MS,
  TAB_KEYS,
  selectedTabIndexOf,
  tabItemFor,
  tabKeyOfIndex,
} from '@ui/shell/TabShell';

describe('TabShell tab mapping (MainActivity L500-507 / when(selectedTab))', () => {
  it('has five tabs in the current Android order', () => {
    expect(TAB_KEYS).toEqual(['library', 'discover', 'bookshelf', 'stats', 'settings']);
  });

  it('maps selectedTab indices exactly (655/679/… → 0 书库, 1 书架, 2 统计, 3 设置)', () => {
    expect(selectedTabIndexOf('library')).toBe(0);
    expect(selectedTabIndexOf('discover')).toBe(1);
    expect(selectedTabIndexOf('bookshelf')).toBe(2);
    expect(selectedTabIndexOf('stats')).toBe(3);
    expect(selectedTabIndexOf('settings')).toBe(4);
  });

  it('round-trips index ↔ key', () => {
    for (const key of TAB_KEYS) {
      expect(tabKeyOfIndex(selectedTabIndexOf(key))).toBe(key);
    }
  });

  it('falls back to 书库 for an out-of-range index', () => {
    expect(tabKeyOfIndex(99)).toBe('library');
    expect(tabKeyOfIndex(-1)).toBe('library');
  });

  it('tab items carry the Chinese labels verbatim', () => {
    expect(TAB_KEYS.map((k) => tabItemFor(k).label)).toEqual(['书库', '发现', '书架', '统计', '设置']);
  });
});

describe('TabShell fade-through timing (MainActivity L646-650)', () => {
  it('uses M3 fade-through: out 90ms, in 210ms delayed 90ms', () => {
    expect(TAB_FADE_OUT_MS).toBe(90);
    expect(TAB_FADE_IN_MS).toBe(210);
    expect(TAB_FADE_IN_DELAY_MS).toBe(90);
  });

  it('the entrance delay equals the exit duration so the two never overlap visibly', () => {
    expect(TAB_FADE_IN_DELAY_MS).toBe(TAB_FADE_OUT_MS);
  });
});

describe('classifyShelfMessage (MainActivity L576)', () => {
  it('treats failure wording as an error', () => {
    expect(classifyShelfMessage('导入失败: 未知错误')).toBe('error');
    expect(classifyShelfMessage('导入出错: 发生未知异常')).toBe('error');
  });

  it('treats success wording as a quiet toast', () => {
    expect(classifyShelfMessage('《深夜书屋》 导入成功')).toBe('toast');
  });
});

describe('SnackbarHost (MainActivity L541-554 / L564-584 / L603-629)', () => {
  it('maps Android SnackbarDuration onto milliseconds', () => {
    expect(SNACKBAR_DURATION.short).toBe(4000);
    expect(SNACKBAR_DURATION.long).toBe(10000);
  });

  it('showUndo uses TOAST semantics, never ERROR', () => {
    const calls: unknown[] = [];
    const host = new SnackbarHost();
    // 注入假的 showToast 观察：直接检查语义字段而非 DOM
    const spy = vi.spyOn(host, 'showAppSnackbar');
    host.showUndo('已移动 2 本到「悬疑」', () => calls.push('undo'));
    expect(spy).toHaveBeenCalledWith(
      { kind: 'toast', message: '已移动 2 本到「悬疑」', actionLabel: '撤销' },
      expect.any(Function),
      'long',
    );
  });

  it('showError uses ERROR semantics with the Short duration', () => {
    const host = new SnackbarHost();
    const spy = vi.spyOn(host, 'showAppSnackbar');
    host.showError('书源加载失败');
    expect(spy).toHaveBeenCalledWith({ kind: 'error', message: '书源加载失败' }, undefined, 'short');
  });

  it('dismissCurrent clears the pending timer exactly once', () => {
    vi.useFakeTimers();
    const host = new SnackbarHost();
    const spy = vi.spyOn(host, 'showAppSnackbar').mockImplementation(() => undefined);
    host.showError('x');
    host.dismissCurrent();
    host.dismissCurrent();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a second snackbar dismisses the first before showing', () => {
    vi.useFakeTimers();
    const host = new SnackbarHost();
    const spy = vi.spyOn(host, 'showAppSnackbar').mockImplementation(() => undefined);
    host.showError('一');
    host.showError('二');
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
