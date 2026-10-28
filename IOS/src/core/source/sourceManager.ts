/**
 * Android source: `com.example.source.SourceManager.kt`
 *
 * kotlinx.coroutines.flow.StateFlow/MutableStateFlow → lightweight observable
 * StateFlow below; Mutex/AtomicBoolean → AsyncMutex + sync flag (JS is
 * single-threaded); SourceStorage (storage/SourceStorage.kt) and
 * SourceImporter (importer/SourceImporter.kt) are injected dependencies so
 * core stays pure TypeScript.
 */

import type { BookSource } from './bookSource';
import type { SourceConfig } from './sourceConfig';
import { SourceResult } from './sourceResult';
import type { SourceResult as SourceResultType } from './sourceResult';

/** Kotlin `storage/SourceStorage.kt` — persistence port (platform implements). */
export interface SourceStorage {
  saveSourceState(sourceId: string, enabled: boolean): Promise<void>;
  getSourceStates(knownIds?: readonly string[]): Promise<Record<string, boolean>>;
  saveActiveSourceId(sourceId: string): Promise<void>;
  getActiveSourceId(): Promise<string | null>;
  saveCustomSourceJson(sourceId: string, jsonContent: string): Promise<void>;
  getCustomSourceJsons(): Promise<Record<string, string>>;
  removeCustomSourceJson(sourceId: string): Promise<void>;
}

/** Kotlin `SourceImporter.importFromJsonString` — injected so core stays pure. */
export interface CustomSourceImporter {
  importFromJsonString(jsonStr: string): SourceResultType<BookSource>;
}

/** kotlinx StateFlow — get `value`, `subscribe` for change notifications. */
export interface StateFlow<T> {
  readonly value: T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface MutableStateFlow<T> extends StateFlow<T> {
  value: T;
  update(updater: (prev: T) => T): void;
}

export function createStateFlow<T>(initial: T): MutableStateFlow<T> {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  const notify = (next: T): void => {
    for (const listener of [...listeners]) listener(next);
  };
  return {
    get value(): T {
      return current;
    },
    set value(next: T) {
      current = next;
      notify(next);
    },
    update(updater: (prev: T) => T): void {
      current = updater(current);
      notify(current);
    },
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** kotlinx.sync.Mutex — serializes async critical sections. */
class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class SourceManager {
  private readonly sourcesMap = new Map<string, BookSource>();
  private readonly enabledStatesMap = new Map<string, boolean>();
  private readonly customJsonsMap = new Map<string, string>();

  private readonly _allSources = createStateFlow<BookSource[]>([]);
  readonly allSources: StateFlow<BookSource[]> = this._allSources;

  private readonly _enabledStates = createStateFlow<Map<string, boolean>>(new Map());
  readonly enabledStates: StateFlow<Map<string, boolean>> = this._enabledStates;

  private readonly _availableSources = createStateFlow<BookSource[]>([]);
  readonly availableSources: StateFlow<BookSource[]> = this._availableSources;

  private readonly _activeSource = createStateFlow<BookSource | null>(null);
  readonly activeSource: StateFlow<BookSource | null> = this._activeSource;

  private initialized = false;
  private initializing: Promise<void> | null = null;
  private savedActiveId: string | null = null;
  private readonly mutex = new AsyncMutex();
  private readonly storage: SourceStorage | null;
  private readonly importer: CustomSourceImporter | null;

  constructor(storage: SourceStorage | null = null, importer: CustomSourceImporter | null = null) {
    this.storage = storage;
    this.importer = importer;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing !== null) return this.initializing;
    const pending = this.mutex.withLock(async () => {
      await this.loadPersistedDataInternal();
      this.initialized = true;
    });
    this.initializing = pending;
    try { await pending; }
    finally { if (this.initializing === pending) this.initializing = null; }
  }

  async loadPersistedData(): Promise<void> {
    await this.initialize();
  }

  private async loadPersistedDataInternal(): Promise<void> {
    const store = this.storage;
    if (!store) return;
    const customJsons = await store.getCustomSourceJsons();
    const savedStates = await store.getSourceStates([...this.sourcesMap.keys(), ...Object.keys(customJsons)]);
    for (const [sourceId, enabled] of Object.entries(savedStates)) {
      this.enabledStatesMap.set(sourceId, enabled);
    }
    this._enabledStates.value = new Map(this.enabledStatesMap);

    // Load user-imported custom sources
    const importer = this.importer;
    if (importer) {
      for (const [sourceId, jsonStr] of Object.entries(customJsons)) {
        const result = importer.importFromJsonString(jsonStr);
        if (result.kind === 'success') {
          this.sourcesMap.set(sourceId, result.data);
          this.customJsonsMap.set(sourceId, jsonStr);
        }
      }
    }

    const savedActiveId = await store.getActiveSourceId();
    this.savedActiveId = savedActiveId;
    this.updateFlowsInternal();

    if (
      savedActiveId != null &&
      savedActiveId !== '' &&
      this.sourcesMap.has(savedActiveId) &&
      this.isSourceEnabledInternal(savedActiveId)
    ) {
      this._activeSource.value = this.sourcesMap.get(savedActiveId) ?? null;
      this.savedActiveId = null;
    } else if (this._activeSource.value == null) {
      this._activeSource.value = this._availableSources.value[0] ?? null;
    }
  }

  async registerSource(
    source: BookSource,
    defaultEnabled = true,
    rawJson: string | null = null,
  ): Promise<void> {
    await this.mutex.withLock(async () => {
      if (rawJson != null) await this.storage?.saveCustomSourceJson(source.id, rawJson);
      if (!this.enabledStatesMap.has(source.id)) {
        const stored = await this.storage?.getSourceStates([source.id]);
        this.enabledStatesMap.set(source.id, stored && Object.hasOwn(stored, source.id) ? stored[source.id]! : defaultEnabled);
        this._enabledStates.value = new Map(this.enabledStatesMap);
      }
      this.sourcesMap.set(source.id, source);
      if (rawJson != null) {
        this.customJsonsMap.set(source.id, rawJson);
      }
      this.updateFlowsInternal();
      if (this.savedActiveId === source.id && this.isSourceEnabledInternal(source.id)) {
        this.savedActiveId = null;
        await this.setActiveSourceInternal(source.id);
      } else if (this._activeSource.value == null && this.isSourceEnabledInternal(source.id)) {
        if (this.savedActiveId !== null) {
          this._activeSource.value = source;
          return;
        }
        await this.setActiveSourceInternal(source.id);
      }
    });
  }

  async addSource(source: BookSource): Promise<void> {
    await this.registerSource(source, true);
  }

  async registerCustomSource(source: BookSource, rawJson: string | null = null): Promise<void> {
    await this.registerSource(source, true, rawJson);
  }

  async unregisterCustomSource(sourceId: string): Promise<void> {
    await this.unregisterSource(sourceId);
  }

  async unregisterSource(sourceId: string): Promise<void> {
    await this.mutex.withLock(async () => {
      await this.storage?.removeCustomSourceJson(sourceId);
      this.sourcesMap.delete(sourceId);
      this.enabledStatesMap.delete(sourceId);
      this._enabledStates.value = new Map(this.enabledStatesMap);
      this.customJsonsMap.delete(sourceId);
      if (this._activeSource.value?.id === sourceId) {
        this._activeSource.value =
          this._availableSources.value.find((s) => s.id !== sourceId) ?? null;
      }
      this.updateFlowsInternal();
    });
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.unregisterSource(sourceId);
  }

  async setActiveSource(sourceId: string): Promise<void> {
    this.savedActiveId = null;
    await this.mutex.withLock(async () => {
      await this.setActiveSourceInternal(sourceId);
    });
  }

  private async setActiveSourceInternal(sourceId: string): Promise<void> {
    const source = this.sourcesMap.get(sourceId);
    if (source != null && this.isSourceEnabledInternal(sourceId)) {
      await this.storage?.saveActiveSourceId(sourceId);
      this._activeSource.value = source;
    }
  }

  async setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
    await this.mutex.withLock(async () => {
      await this.storage?.saveSourceState(sourceId, enabled);
      this.enabledStatesMap.set(sourceId, enabled);
      this._enabledStates.value = new Map(this.enabledStatesMap);
      this.updateFlowsInternal();
      if (!enabled && this._activeSource.value?.id === sourceId) {
        this._activeSource.value = this._availableSources.value[0] ?? null;
        const active = this._activeSource.value;
        if (active != null) {
          await this.setActiveSourceInternal(active.id);
        }
      }
    });
  }

  getSource(id: string): BookSource | null {
    return this.sourcesMap.get(id) ?? null;
  }

  isSourceEnabled(id: string): boolean {
    return this.enabledStatesMap.get(id) ?? true;
  }

  private isSourceEnabledInternal(id: string): boolean {
    return this.enabledStatesMap.get(id) ?? true;
  }

  /**
   * Kotlin: `(src is JsonBookSource && src.config.isCustom) || customJsonsMap.containsKey(...)`.
   * Structural check on `config.isCustom` replaces `instanceof JsonBookSource`.
   */
  isCustomSource(sourceId: string): boolean {
    const src = this.sourcesMap.get(sourceId) as { config?: SourceConfig } | undefined;
    return src?.config?.isCustom === true || this.customJsonsMap.has(sourceId);
  }

  private updateFlowsInternal(): void {
    const allList = [...this.sourcesMap.values()];
    this._allSources.value = allList;
    const availableList = allList.filter((s) => this.isSourceEnabledInternal(s.id));
    this._availableSources.value = availableList;
    if (this._activeSource.value != null && !availableList.includes(this._activeSource.value)) {
      this._activeSource.value = availableList[0] ?? null;
    } else if (this._activeSource.value == null && availableList.length > 0) {
      this._activeSource.value = availableList[0] ?? null;
    }
  }
}

/** Re-export for call-site parity with Kotlin `SourceResult.Success/Error` usage in managers. */
export { SourceResult };
