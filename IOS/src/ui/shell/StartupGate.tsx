import { useEffect, useState, type ReactNode } from 'react';
import { bootstrapLibrary } from '@ui/state/appStore';
import { consumeNotice } from '@core/app/homeRenderRecovery';
import { showToast, TOAST_DURATION_LONG } from '@ui/toast';

/** Kotlin `MainActivity.kt:700-703` 的提示原文（`Toast.LENGTH_LONG`）。 */
export const HOME_RENDER_RECOVERY_NOTICE =
  '上次主页显示异常，已启用极简画质。可在设置中调整画质。';

/**
 * Do not mount routing or editable pages before persistent state is hydrated.
 *
 * 另外承担 E108 的**提示端**：Android 在 `composable("home")` 的 `LaunchedEffect` 里
 * `HomeRenderRecovery.consumeNotice()` 为真就弹 `Toast.LENGTH_LONG`（`MainActivity.kt:700-703`）。
 * Web 侧「主页真正可用」的时刻就是本组件放行 children 的时刻（`bootstrapLibrary()` 已
 * 把数据库/画质都读进 store），所以提示固定挂在这里，晚一步就会用旧画质渲染第一帧。
 */
export function StartupGate({
  children,
  initialize = bootstrapLibrary,
  consumeRecoveryNotice = consumeNotice,
}: {
  children: ReactNode;
  initialize?: () => Promise<void>;
  /** 测试注入用；默认 `homeRenderRecovery.consumeNotice()`。 */
  consumeRecoveryNotice?: () => Promise<boolean>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({
    ready: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(initialize)
      .then(
        () => {
          if (!cancelled) setState({ ready: true, error: null });
        },
        (error: unknown) => {
          if (!cancelled)
            setState({ ready: false, error: error instanceof Error ? error.message : '请重试' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt, initialize]);

  // E108 提示端（Kotlin L698-703）：主页进场时消费一次降级通知。
  // 只提示、不改状态；读失败或没有存储时 `consumeNotice` 直接返回 false，不阻塞启动。
  //
  // 这里**故意不做 `cancelled` 守卫**：React StrictMode 会 mount → unmount → mount 双跑
  // effect，第一次调用已经把 notice 消费掉（返回 true），第二次只会读到空；若给第一次
  // 加取消守卫，dev 下这条提示就会凭空消失。副作用只是往全局 toast store 推一条，
  // 组件自己不留状态，双跑幂等。
  useEffect(() => {
    if (!state.ready) return;
    void consumeRecoveryNotice()
      .then((flagged) => {
        if (flagged) {
          showToast(HOME_RENDER_RECOVERY_NOTICE, { durationMs: TOAST_DURATION_LONG });
        }
      })
      .catch(() => {
        /* 只是一条提示：读不到通知不该影响主页可用性 */
      });
  }, [state.ready, consumeRecoveryNotice]);

  if (state.ready) return children;
  return (
    <main className="startup-page">
      <img src="/splash/splash_ciallo_logo.png" alt="Ciallo Reader" width="168" />
      {state.error === null ? (
        <p role="status">正在准备书架…</p>
      ) : (
        <div role="alert">
          <h1>启动失败</h1>
          <p>{state.error}</p>
          <button
            type="button"
            onClick={() => {
              setState({ ready: false, error: null });
              setAttempt((value) => value + 1);
            }}
          >
            重新尝试
          </button>
        </div>
      )}
    </main>
  );
}
