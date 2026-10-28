/**
 * Archive extraction safety — port of Android `ImportSafety.kt` (ArchiveBudget + zipSlip).
 *
 * Limits apply to actual expanded bytes, including entries the parser ignores.
 */

export class ArchiveBudget {
  private total = 0;
  private entries = 0;

  constructor(
    private readonly maxEntryBytes = 64 * 1024 * 1024,
    private readonly maxTotalBytes = 512 * 1024 * 1024,
    private readonly maxEntries = 10_000,
  ) {}

  /** Enforce per-entry / total / entry-count limits; returns a copy of the entry bytes. */
  copyEntry(data: Uint8Array): Uint8Array {
    this.entries += 1;
    if (this.entries > this.maxEntries) {
      throw new Error('压缩包条目过多');
    }
    const size = data.length;
    this.total += size;
    if (size > this.maxEntryBytes || this.total > this.maxTotalBytes) {
      throw new Error('压缩包解压体积超过安全上限');
    }
    return data.slice();
  }
}

function resolvePathSegments(path: string): string {
  const absolute = path.startsWith('/');
  const parts = path.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!absolute) {
        out.push('..');
      }
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined;
}

/**
 * Resolve an archive entry name under root. Rejects absolute paths and zip-slip escapes.
 * Normalizes `\` to `/` and requires destination to stay under root.
 */
export function zipSlipSafeDestination(root: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('压缩包包含绝对路径');
  }
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const joined = `${rootNorm}/${normalized}`;
  const resolved = resolvePathSegments(joined);
  if (resolved !== rootNorm && !resolved.startsWith(`${rootNorm}/`)) {
    throw new Error('压缩包包含越界路径');
  }
  return resolved;
}
