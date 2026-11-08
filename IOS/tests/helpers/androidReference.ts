import { existsSync } from 'node:fs';
import path from 'node:path';

/** Local audits read the current Android tree; CI reads the exact bundled authority snapshot. */
export function androidReference(relative: string): string {
  const live = path.resolve(import.meta.dirname, '../../../novel-reader', relative);
  return existsSync(live) ? live : path.resolve(import.meta.dirname, '../reference/android', relative);
}
