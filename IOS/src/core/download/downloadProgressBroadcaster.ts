/**
 * Progress broadcaster — port of Android `DownloadProgressBroadcaster.kt`.
 *
 * Android MutableStateFlow<Map<String, DownloadState>> → Map + subscriber set.
 */

import {
  DownloadStateIdle,
  type DownloadState,
} from './downloadState';

type Listener = (states: ReadonlyMap<string, DownloadState>) => void;

export class DownloadProgressBroadcaster {
  private readonly stateMap = new Map<string, DownloadState>();
  private readonly listeners = new Set<Listener>();

  /** Snapshot of the current state map (StateFlow.value equivalent). */
  get states(): ReadonlyMap<string, DownloadState> {
    return new Map(this.stateMap);
  }

  updateState(bookId: string, state: DownloadState): void {
    this.stateMap.set(bookId, state);
    this.notify();
  }

  removeState(bookId: string): void {
    this.stateMap.delete(bookId);
    this.notify();
  }

  getState(bookId: string): DownloadState {
    return this.stateMap.get(bookId) ?? DownloadStateIdle;
  }

  /** Subscribe to map changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.states;
    for (const listener of [...this.listeners]) {
      listener(snapshot);
    }
  }
}

/** Singleton equivalent of Android's `object DownloadProgressBroadcaster`. */
export const downloadProgressBroadcaster = new DownloadProgressBroadcaster();
