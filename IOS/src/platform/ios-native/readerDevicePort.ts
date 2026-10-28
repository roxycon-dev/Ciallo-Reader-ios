import { App } from '@capacitor/app';
import { nonThenablePlugin } from './pluginProxy';
import type {
  AppInfoPort,
  ClipboardPort,
  ScreenAwakePort,
  ShareTextPort,
  StorageStatsPort,
} from '@platform/interfaces';

interface ReaderDevicePlugin {
  setScreenAwake(options: { enabled: boolean }): Promise<void>;
  writeClipboard(options: { text: string }): Promise<void>;
  shareText(options: { title: string; text: string }): Promise<void>;
  volumeStats(): Promise<{ freeBytes: number; totalBytes: number }>;
}

let plugin: Promise<ReaderDevicePlugin> | null = null;
function readerDevice(): Promise<ReaderDevicePlugin> {
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
    nonThenablePlugin(registerPlugin<ReaderDevicePlugin>('ReaderDevice')),
  );
  return plugin;
}

export function createNativeScreenAwakePort(): ScreenAwakePort {
  return { setEnabled: async (enabled) => (await readerDevice()).setScreenAwake({ enabled }) };
}

export function createNativeClipboardPort(): ClipboardPort {
  return { writeText: async (text) => (await readerDevice()).writeClipboard({ text }) };
}

export function createNativeShareTextPort(): ShareTextPort {
  return { shareText: async (options) => (await readerDevice()).shareText(options) };
}

export function createNativeStorageStatsPort(): StorageStatsPort {
  return { volumeStats: async () => (await readerDevice()).volumeStats() };
}

export function createNativeAppInfoPort(): AppInfoPort {
  return { versionName: async () => (await App.getInfo()).version };
}
