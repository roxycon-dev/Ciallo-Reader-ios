import { Capacitor, registerPlugin } from '@capacitor/core';

interface StartupDevice { reportStartup(value: { phase: string; detail: string }): Promise<void> }
let device: StartupDevice | null = null;

/** Debug builds expose a bounded, local startup result to the simulator CI job. */
export async function reportStartup(phase: 'starting' | 'ready' | 'error', error?: unknown): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const details: string[] = [];
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    details.push(cause.message); cause = cause.cause;
  }
  try {
    device ??= registerPlugin<StartupDevice>('ReaderDevice');
    await device.reportStartup({ phase, detail: details.join(' / ').slice(0, 2000) });
  }
  catch (reason) { console.warn('[startup] 原生诊断记录不可用', reason); }
}
