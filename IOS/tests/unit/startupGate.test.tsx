import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartupGate } from '@ui/shell/StartupGate';

describe('startup hydration gate', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it('does not expose the editable application until initialization completes', async () => {
    let ready!: () => void;
    const initialize = () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      });
    await act(async () =>
      root.render(
        <StartupGate initialize={initialize}>
          <p>书架</p>
        </StartupGate>,
      ),
    );
    expect(host.textContent).toContain('正在准备书架');
    expect(host.textContent).not.toBe('书架');
    await act(async () => ready());
    expect(host.textContent).toBe('书架');
  });

  it('shows startup failures and retries without opening a misleading empty library', async () => {
    const initialize = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('数据库暂时不可用'))
      .mockResolvedValueOnce();
    await act(async () =>
      root.render(
        <StartupGate initialize={initialize}>
          <p>书架</p>
        </StartupGate>,
      ),
    );
    expect(host.querySelector('[role=alert]')?.textContent).toContain('数据库暂时不可用');
    await act(async () => host.querySelector('button')!.click());
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe('书架');
  });
});
