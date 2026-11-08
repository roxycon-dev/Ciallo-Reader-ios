import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceDialogs, showSourceInput } from '@ui/sourceDialogs';

const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = flags.IS_REACT_ACT_ENVIRONMENT;
afterEach(() => { if (previous === undefined) delete flags.IS_REACT_ACT_ENVIRONMENT; else flags.IS_REACT_ACT_ENVIRONMENT = previous; });
describe('source input lifetime', () => {
  it('removes only a cancelled Worker prompt and keeps another source prompt usable', async () => {
    flags.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), controller = new AbortController();
    let first!: Promise<string>, second!: Promise<string>;
    try {
      await act(async () => { root.render(<SourceDialogs />); first = showSourceInput('第一书源', null); second = showSourceInput('已取消书源', null, controller.signal); });
      const rejected = expect(second).rejects.toMatchObject({ name: 'AbortError' }); await act(async () => controller.abort()); await rejected;
      expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('第一书源');
      await act(async () => host.querySelector<HTMLButtonElement>('button[type="button"]')!.click()); expect(await first).toBe(''); expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('never queues an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort(); await expect(showSourceInput('取消', null, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
