import { createContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getMangaTranslationRuntime, type MangaTranslationRuntime } from '@platform/ios-native/mangaTranslationRuntime';
import type { ComicBitmap, ComicPageLoaderPort, ComicPageLoaderWindowEntry, ComicReaderConfig, ComicToning } from '@core/comic/comicReaderCore';
import { showToast } from '@ui/toast';
import { UNSUPPORTED_TRANSLATION_BRIDGE, type TranslationBridge } from '@ui/components/comic/sheets/ComicSettingsTranslationTab';

const empty: readonly string[] = [];

class ReaderTranslationSession {
  private signature = '';
  private next: { entries: readonly ComicPageLoaderWindowEntry[]; config: ComicReaderConfig; tone: ComicToning } | null = null;
  private active: { key: string; controller: AbortController } | null = null;
  private readonly done = new Set<string>();
  private readonly translated = new Map<string, ComicBitmap>();
  private readonly listeners = new Set<() => void>();
  private readonly pageListeners = new Map<string, Set<(bitmap: ComicBitmap | null) => void>>();
  private activeKeys: readonly string[] = empty;
  private running = false;
  private enabled = false;
  private displayedFailure = '';
  readonly bridge: TranslationBridge;

  constructor(private readonly loader: ComicPageLoaderPort, private readonly runtime: MangaTranslationRuntime | null) {
    this.bridge = runtime ? {
      available: true,
      refresh: () => runtime.refresh(),
      isModelsReady: () => runtime.models.ready,
      ensureDownloaded: (progress) => runtime.models.ensureDownloaded(progress),
      totalCacheBytes: () => runtime.totalCacheBytes,
      clearCache: async () => { await runtime.clearCache(); this.reset(); },
      loadLlmConfig: () => runtime.config,
      saveLlmConfig: async (config) => { await runtime.saveConfig(config); this.reset(); },
      showError: (message) => { void showToast(message, { kind: 'error' }); },
    } : UNSUPPORTED_TRANSLATION_BRIDGE;
  }

  snapshot = () => this.activeKeys;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(keys: readonly string[]) { this.activeKeys = keys; for (const listener of this.listeners) listener(); }

  get = (key: string) => this.translated.get(key) ?? null;
  subscribePage = (key: string, listener: (bitmap: ComicBitmap | null) => void) => {
    const listeners = this.pageListeners.get(key) ?? new Set();
    listeners.add(listener); this.pageListeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.pageListeners.delete(key); };
  };

  private remove(key: string) {
    const bitmap = this.translated.get(key);
    if (!bitmap) return;
    this.translated.delete(key);
    for (const listener of this.pageListeners.get(key) ?? []) listener(null);
    URL.revokeObjectURL(bitmap.src);
  }

  private reset() {
    this.active?.controller.abort();
    for (const key of this.translated.keys()) this.remove(key);
    this.done.clear(); this.displayedFailure = '';
    if (this.enabled) void this.drain();
  }

  configure(config: ComicReaderConfig) {
    const signature = [config.translationEnabled, config.translationEngine, config.translationLang, config.translationTextScale].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.enabled = config.translationEnabled;
    this.next = null; this.reset();
  }

  schedule = (entries: readonly ComicPageLoaderWindowEntry[], config: ComicReaderConfig, tone: ComicToning) => {
    this.configure(config);
    if (!this.runtime || !this.enabled) return;
    const ordered = [...entries].sort((a, b) => Number(b.visible) - Number(a.visible)).slice(0, 4);
    this.next = { entries: ordered, config, tone };
    const keys = new Set(ordered.map((entry) => entry.cacheKey));
    if (this.active && !keys.has(this.active.key)) this.active.controller.abort();
    for (const key of this.translated.keys()) if (!keys.has(key)) this.remove(key);
    for (const key of this.done) if (!keys.has(key)) this.done.delete(key);
    void this.drain();
  };

  private async drain() {
    if (this.running || !this.runtime) return;
    this.running = true;
    try {
      while (this.enabled && this.next) {
        const { entries, config, tone } = this.next;
        const entry = entries.find((candidate) => !this.done.has(candidate.cacheKey));
        if (!entry) break;
        const key = entry.cacheKey, controller = new AbortController();
        this.active = { key, controller }; this.publish([key]);
        try {
          const bitmap = await this.loader.loadForDisplay({ ...entry, tone });
          const blob = await this.runtime.translate(bitmap, config, controller.signal, () => {});
          if (controller.signal.aborted) continue;
          this.done.add(key);
          if (!blob) continue;
          const output = { ...bitmap, src: URL.createObjectURL(blob) };
          this.remove(key); this.translated.set(key, output);
          for (const listener of this.pageListeners.get(key) ?? []) listener(output);
        } catch (error) {
          if (!controller.signal.aborted) {
            this.done.add(key);
            if (entry.visible) {
              const message = error instanceof Error ? error.message : String(error);
              if (this.displayedFailure !== message) { this.displayedFailure = message; this.bridge.showError(message); }
            }
          }
        } finally {
          this.active = null; this.publish(empty);
        }
      }
    } finally { this.running = false; }
  }

  dispose() {
    this.enabled = false; this.signature = ''; this.next = null; this.reset();
    if (this.runtime) void this.runtime.models.closeSessions().catch(() => {});
  }
}

export function useReaderTranslation(loader: ComicPageLoaderPort, config: ComicReaderConfig) {
  const session = useMemo(() => new ReaderTranslationSession(loader, getMangaTranslationRuntime()), [loader]);
  const keys = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.configure(config); }, [session, config]);
  useEffect(() => () => session.dispose(), [session]);
  return { session, keys };
}

export type { ReaderTranslationSession };

export const ReaderTranslationContext = createContext<ReaderTranslationSession | null>(null);
