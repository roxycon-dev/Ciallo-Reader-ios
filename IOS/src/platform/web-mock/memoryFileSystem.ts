import type { FileSystemApi } from '@platform/interfaces';

export function normalizeFsPath(path: string): string {
  const unified = path.replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of unified.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export class MemoryFileSystem implements FileSystemApi {
  private readonly files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Uint8Array> {
    const key = normalizeFsPath(path);
    const data = this.files.get(key);
    if (!data) {
      throw new Error(`file not found: ${key}`);
    }
    return data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(normalizeFsPath(path), data.slice());
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizeFsPath(path));
  }

  async delete(path: string): Promise<void> {
    this.files.delete(normalizeFsPath(path));
  }

  async list(dir: string): Promise<string[]> {
    const prefix = normalizeFsPath(dir);
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (prefix === '') {
        const first = key.split('/')[0];
        if (first) {
          names.add(first);
        }
        continue;
      }
      if (!key.startsWith(prefix + '/')) {
        continue;
      }
      const rest = key.slice(prefix.length + 1);
      const first = rest.split('/')[0];
      if (first) {
        names.add(first);
      }
    }
    return [...names].sort();
  }

  clear(): void {
    this.files.clear();
  }
}

export function createMemoryFileSystem(): MemoryFileSystem {
  return new MemoryFileSystem();
}
