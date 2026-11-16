import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `ui/components/ProducedState.kt`（36 行）→ `src/core/...` 不可用（React），落在
 * `src/ui/components/useProducedState.ts`。
 *
 * 逐行对照：
 *   L7-15  `rememberAsyncState(initialValue, vararg keys) { producer }`
 *          → `useAsyncState(initialValue, keys, producer)`
 *          `remember { mutableStateOf(initialValue) }` + `LaunchedEffect(*keys)`：
 *          键变化**保留**上一次的值（避免"文本重载闪一帧空白"）。
 *   L27-35 `rememberKeyedAsyncState` → `useKeyedAsyncState`
 *          `remember(*keys) { mutableStateOf(initialValue) }`：键变化**丢弃**旧值、
 *          重建为 `initialValue`（例：按路径解码的位图——留着旧图会画出上一页）。
 *
 * 适配说明：
 * - Compose 的 `producer: suspend MutableState<T>.() -> Unit` 接收者是可变状态本身，
 *   直接 `this.value = x` 写入即可。React 没有这种接收者，等价物是**注入一个写函数**：
 *   `producer(write, isCancelled)`。`write` 支持函数式更新（`prev => next`），
 *   键变化后旧的 `write` 会静默失效（= Compose 取消 `LaunchedEffect` 协程）。
 * - `LaunchedEffect` 抛出的异常会冒泡到组合（App 崩溃）；Promise 没有等价通道，
 *   这里 `console.error` 上报后不再重抛，避免一条未处理的 rejection 掀掉整个页面。
 *   producer 自身的失败请自行捕获——这与 Kotlin 调用点一致（那些 producer 内部都 try/catch）。
 * - 键的判等用 `JSON.stringify(keys)`（Compose 用 `equals`）。键里放对象/数组时，
 *   序列化内容相同即视为同一个键；这与 `remember(key)` 对 data class 的语义一致。
 */

/** Kotlin `MutableState<T>.value = …` 的等价写入口（支持 `prev => next`）。 */
export type AsyncValueWriter<T> = (next: T | ((previous: T) => T)) => void;

/** Kotlin `suspend MutableState<T>.() -> Unit`。 */
export type AsyncProducer<T> = (
  write: AsyncValueWriter<T>,
  isCancelled: () => boolean,
) => Promise<void>;

interface ProducedSlot<T> {
  readonly signature: string;
  readonly value: T;
}

/** 一次产出的快照（= `mutableStateOf` 的当前值 + 它属于哪个键）。 */
export interface ProducedSnapshot<T> {
  readonly signature: string;
  readonly value: T;
}

/** 键 → 签名。Compose 的 `remember(*keys)` 用 `equals`，这里用序列化内容判等。 */
export function producedSignature(keys: readonly unknown[]): string {
  return JSON.stringify(keys);
}

/**
 * `rememberAsyncState` / `rememberKeyedAsyncState` 唯一的语义差别就是这一行：
 * 签名一致 → 用槽里的值；签名不一致 → `rememberKeyedAsyncState` 回到 `initialValue`，
 * 而 `rememberAsyncState` 根本不会调用本函数（它无条件返回 `slot.value`）。
 */
export function resolveProducedValue<T>(
  slot: ProducedSnapshot<T>,
  signature: string,
  initialValue: T,
): T {
  return slot.signature === signature ? slot.value : initialValue;
}

/**
 * 两个导出 hook 的公共骨架：状态槽 + 一次最近 producer 的引用 + 一条按签名重启的 effect。
 *
 * `producerRef` 必须在渲染期之外更新（`react-hooks/refs`），所以它是一个独立的
 * `useEffect`，并且**声明在**驱动 effect 之前 —— effect 按声明序执行，驱动 effect
 * 读到的永远是最新 producer。
 */
function useProduced<T>(
  initialValue: T,
  signature: string,
  producer: AsyncProducer<T>,
): ProducedSlot<T> {
  const [slot, setSlot] = useState<ProducedSlot<T>>(() => ({ signature, value: initialValue }));
  const producerRef = useRef(producer);

  useEffect(() => {
    producerRef.current = producer;
  }, [producer]);

  useEffect(() => {
    let cancelled = false;
    const run = producerRef.current;
    const write: AsyncValueWriter<T> = (next) => {
      if (cancelled) return;
      setSlot((previous) => ({
        signature,
        value: typeof next === 'function' ? (next as (previous: T) => T)(previous.value) : next,
      }));
    };
    run(write, () => cancelled).catch((error: unknown) => {
      console.error('[useProducedState] producer 失败', error);
    });
    return () => {
      cancelled = true;
    };
  }, [signature]);

  return slot;
}

/**
 * Kotlin `rememberAsyncState`：键变化时**保留**上一次的值，直到新值产出。
 */
export function useAsyncState<T>(
  initialValue: T,
  keys: readonly unknown[],
  producer: AsyncProducer<T>,
): T {
  return useProduced(initialValue, producedSignature(keys), producer).value;
}

/**
 * Kotlin `rememberKeyedAsyncState`：键变化时**立即**回到 `initialValue`。
 *
 * 关键差别在返回值这一行：签名不一致就把槽里的旧值当作不存在。这不需要在渲染期
 * 调 `setState`（React 允许但会多一帧），读到旧值的窗口为零。
 */
export function useKeyedAsyncState<T>(
  initialValue: T,
  keys: readonly unknown[],
  producer: AsyncProducer<T>,
): T {
  const signature = producedSignature(keys);
  const slot = useProduced(initialValue, signature, producer);
  return resolveProducedValue(slot, signature, initialValue);
}

/** 供调用方在 `useCallback` 里生成稳定 producer 时使用（与 Compose 的 lambda 无害化同义）。 */
export function useStableProducer<T>(producer: AsyncProducer<T>): AsyncProducer<T> {
  const ref = useRef(producer);
  useEffect(() => {
    ref.current = producer;
  }, [producer]);
  return useCallback<AsyncProducer<T>>((write, isCancelled) => ref.current(write, isCancelled), []);
}
