import { describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from '@platform/ios-native/pluginProxy';

describe('Capacitor plugin Promise boundaries', () => {
  it('hides the real Capacitor proxy phantom then method', async () => {
    const plugin = registerPlugin<{ test(): Promise<void> }>('PromiseBoundaryRegression');
    expect(typeof Reflect.get(plugin, 'then')).toBe('function');
    const safe = nonThenablePlugin(plugin);
    expect(Reflect.get(safe, 'then')).toBeUndefined();
    expect(await Promise.resolve(safe)).toBe(safe);
    await expect(safe.test()).rejects.toThrow('not implemented');
  });

  it('survives nested async returns while preserving native methods', async () => {
    const phantom = vi.fn(() => new Promise(() => {}));
    const native = { read: vi.fn(async () => ({ value: '原生数据' })) };
    const plugin = new Proxy(native, {
      get(target, property) { return property in target ? Reflect.get(target, property) : phantom; },
    });
    const load = async () => nonThenablePlugin(plugin);
    const requirePlugin = async () => await load();
    const loaded = await requirePlugin();
    expect(await loaded.read()).toEqual({ value: '原生数据' });
    expect(phantom).not.toHaveBeenCalled();
    expect(native.read).toHaveBeenCalledOnce();
  });
});
