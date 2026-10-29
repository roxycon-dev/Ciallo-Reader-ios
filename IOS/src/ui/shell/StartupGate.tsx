import { useEffect, useState, type ReactNode } from 'react';
import { bootstrapLibrary } from '@ui/state/appStore';

/** Do not mount routing or editable pages before persistent state is hydrated. */
export function StartupGate({
  children,
  initialize = bootstrapLibrary,
}: {
  children: ReactNode;
  initialize?: () => Promise<void>;
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
