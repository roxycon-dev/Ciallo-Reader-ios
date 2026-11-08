/**
 * Android source: `com.example.source.SourceResult.kt`
 * Kotlin sealed class → discriminated union; `SourceResult.Success/Error`
 * call-site shape preserved via the const namespace below.
 */

import type { SourceException } from './sourceException';

export interface SourceResultSuccess<T> {
  readonly kind: 'success';
  readonly data: T;
}

export interface SourceResultError {
  readonly kind: 'error';
  readonly exception: SourceException;
}

export type SourceResult<T> = SourceResultSuccess<T> | SourceResultError;

export function sourceSuccess<T>(data: T): SourceResultSuccess<T> {
  return { kind: 'success', data };
}

export function sourceError(exception: SourceException): SourceResultError {
  return { kind: 'error', exception };
}

export function isSuccessSourceResult<T>(result: SourceResult<T>): result is SourceResultSuccess<T> {
  return result.kind === 'success';
}

export function isErrorSourceResult<T>(result: SourceResult<T>): result is SourceResultError {
  return result.kind === 'error';
}

/** Kotlin `SourceResult.Success(data)` / `SourceResult.Error(exception)` factories + methods. */
export const SourceResult = {
  Success<T>(data: T): SourceResultSuccess<T> {
    return sourceSuccess(data);
  },
  Error(exception: SourceException): SourceResultError {
    return sourceError(exception);
  },
  /** Kotlin `inline fun <R> map(transform: (T) -> R)`. */
  map<T, R>(result: SourceResult<T>, transform: (data: T) => R): SourceResult<R> {
    if (result.kind === 'success') {
      return sourceSuccess(transform(result.data));
    }
    return result;
  },
  /** Kotlin `fun getOrNull(): T?`. */
  getOrNull<T>(result: SourceResult<T>): T | null {
    return result.kind === 'success' ? result.data : null;
  },
};
