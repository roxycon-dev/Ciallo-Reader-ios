import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Toast, hideToast, showToast } from '../../src/ui/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ host: HTMLDivElement; root: Root }> = [];

function mountToast(): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  act(() => root.render(<Toast />));
  return host;
}

afterEach(() => {
  act(() => hideToast());
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  vi.restoreAllMocks();
});

describe('Toast error skin', () => {
  it('renders the dedicated error card with a copy-log action', () => {
    const host = mountToast();
    act(() => showToast('network timeout', { kind: 'error' }));
    const card = host.querySelector('[data-testid="app_error_snackbar"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('操作出错');
    expect(card?.textContent).toContain('复制日志');
    // friendlyMessage maps the raw text (AppErrorSnackbar.kt L43-53).
    expect(card?.textContent).toContain('网络连接超时');
  });

  it('keeps a compact snackbar when the error carries an action', () => {
    const host = mountToast();
    act(() => showToast('删除失败', { kind: 'error', actionLabel: '重试', onAction: () => {} }));
    expect(host.querySelector('[data-testid="app_error_snackbar"]')).toBeNull();
    expect(host.querySelector('.toast--error')).not.toBeNull();
    expect(host.textContent).toContain('重试');
  });

  it('uses the plain toast skin for non-error messages', () => {
    const host = mountToast();
    act(() => showToast('已保存'));
    expect(host.querySelector('[data-testid="app_error_snackbar"]')).toBeNull();
    expect(host.querySelector('.toast--ok')).not.toBeNull();
  });
});
