import { useCallback, useEffect, useRef, useState } from 'react';
import { type ReactNode } from 'react';

type ToastListener = (msg: string) => void;

const listeners = new Set<ToastListener>();

export function showToast(message: string): void {
  for (const cb of [...listeners]) cb(message);
}

function subscribeToast(cb: ToastListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function Toast(): ReactNode {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToast((msg) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      setMessage(msg);
      setVisible(true);
      timerRef.current = window.setTimeout(() => {
        setVisible(false);
        timerRef.current = null;
      }, 2000);
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!visible || message === '') return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function useToast(): { show: (msg: string) => void; node: ReactNode } {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const show = useCallback((msg: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    setMessage(msg);
    setVisible(true);
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, 2000);
  }, []);

  const node: ReactNode =
    visible && message !== '' ? (
      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    ) : null;

  return { show, node };
}
