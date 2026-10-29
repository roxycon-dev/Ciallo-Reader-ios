import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeviceTransferPage } from '@ui/pages/DeviceTransferPage';
import type { DeviceTransferController, DeviceTransferState } from '@platform/ios-native/deviceTransferController';
vi.mock('@platform/privacyRuntime', () => ({ getPrivacyService: () => ({ ready: async () => ({ enabled: false }), getSnapshot: () => ({ enabled: false }), subscribe: () => () => {} }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(async () => { for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
afterAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
async function fixture(values: Partial<DeviceTransferState> = {}) {
  const state: DeviceTransferState = { phase: 'DISCOVERING', importMode: 'MERGE', peers: [], progress: null, error: '', prepared: null, pairing: null, preview: null, result: null, warnings: [], requiresReload: false, ...values };
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, start: vi.fn(async () => {}), stop: vi.fn(async () => state.requiresReload), prepare: vi.fn(async () => {}), sendTo: vi.fn(async () => {}), pair: vi.fn(), import: vi.fn(), forgetResume: vi.fn(async () => {}) };
  const onBack = vi.fn(), reload = vi.fn(), host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({ root, host });
  await act(async () => root.render(<DeviceTransferPage controller={controller as unknown as DeviceTransferController} nativeAvailable onBack={onBack} reload={reload} />));
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text || item.getAttribute('aria-label') === text)!;
  return { controller, onBack, reload, host, button };
}
const click = (element: HTMLElement) => act(async () => element.click());
describe('device transfer visible human consent', () => {
  it('shows the persisted replacement mode before a resumed archive can mutate the receiver', async () => {
    const { controller, host, button } = await fixture({ phase: 'AWAITING_IMPORT', importMode: 'REPLACE', preview: { packageId: 'package', version: 2, categories: ['BOOKS'], counts: { books: 2, chapters: 20 }, expandedBytes: 100, warnings: [], containsProtected: false, protectedFavorites: false } });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.textContent).toContain('将替换本机对应类别'); expect(host.textContent).not.toContain('确认合并并导入'); expect(controller.import).not.toHaveBeenCalled();
    await click(button('确认替换并导入')); expect(controller.import).toHaveBeenCalledWith(true);
  });
  it('keeps protected imports disabled until the receiver has enabled its own PIN', async () => {
    const { controller, host, button } = await fixture({ phase: 'AWAITING_IMPORT', preview: { packageId: 'package', version: 2, categories: ['BOOKS'], counts: { books: 1 }, expandedBytes: 100, warnings: [], containsProtected: true, protectedFavorites: false } });
    expect(button('确认合并并导入').disabled).toBe(true); expect(host.querySelector('[aria-label="新隐私 PIN"]')).not.toBeNull(); expect(controller.import).not.toHaveBeenCalled(); await click(button('暂不导入')); expect(controller.import).toHaveBeenCalledWith(false);
  });
  it('requires explicit pair-code consent and forwards the selected receiver import mode', async () => {
    const { controller, host, button } = await fixture({ phase: 'AWAITING_CONFIRMATION', pairing: { code: '012345', peer: { id: 'sender', name: '另一台设备' }, incoming: true } });
    expect(host.textContent).toContain('012345'); expect(controller.pair).not.toHaveBeenCalled();
    await click(host.querySelectorAll<HTMLInputElement>('input[name="transfer-mode"]')[1]!); await click(button('配对码一致')); expect(controller.pair).toHaveBeenCalledWith(true, 'REPLACE');
  });
  it('waits for the current library operation before leaving and reloads an imported library', async () => {
    const { controller, onBack, reload, host, button } = await fixture({ requiresReload: true, phase: 'COMPLETED', result: { added: 2, merged: 1, skipped: 0 } });
    let settle!: (value: boolean) => void; controller.stop.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    await click(button('返回设置')); expect(onBack).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled(); expect(host.querySelector('[role="status"]')?.textContent).toBe('正在结束当前操作');
    await act(async () => settle(true)); expect(reload).toHaveBeenCalledOnce(); expect(onBack).not.toHaveBeenCalled();
  });
});
