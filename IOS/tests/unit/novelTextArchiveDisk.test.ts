import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { prepareNovelTextArchive } from '../../src/core/download/novelTextArchive';
import type { FileSystemApi } from '../../src/platform/interfaces';

/** Real on-disk FileSystemApi over `<dir>`, so system unzip tools can read it. */
function diskFs(dir: string): FileSystemApi {
  const at = (p: string): string => join(dir, p);
  return {
    async readFile(p) {
      return new Uint8Array(readFileSync(at(p)));
    },
    async writeFile(p, d) {
      writeFileSync(at(p), d);
    },
    async exists(p) {
      try {
        readFileSync(at(p));
        return true;
      } catch {
        return false;
      }
    },
    async delete(p) {
      rmSync(at(p), { force: true });
    },
    async list() {
      return readdirSync(dir);
    },
  };
}

describe('NovelTextArchive against a real ZIP on disk', () => {
  it('produces a UTF-8 TXT that the system unzip tooling agrees with', async () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-archive-'));
    const extracted = mkdtempSync(join(tmpdir(), 'novel-archive-x-'));
    // The worker always hands over a path inside the downloads directory, so the
    // archive's zip-slip root is that directory (never '/', which would neuter it).
    const dir = join(root, 'downloads');
    mkdirSync(dir);
    try {
      const fs = diskFs(root);
      // Chapters 1, 3, 2 — the out-of-order tail this module exists to fix.
      // Headings must use Arabic digits: the regex is ^第([0-9]{1,7})[章回].
      const body =
        '《测试小说》\n作者：某人\n\n第1章 开端\n正文一。\n\n第3章 结尾\n正文三。\n\n第2章 中段\n正文二。';
      writeFileSync(join(dir, 'in.tmp'), zipSync({ 'novel.txt': strToU8(body) }, { level: 0 }));

      // (1) The node-written ZIP opens with the OS unzip tool. Windows ships bsdtar at
      // the fixed System32 location, which parses drive-letter paths; the GNU tar on
      // the PATH in Git Bash reads `C:\...` as a remote host ("Cannot connect to C:").
      if (process.platform === 'linux') {
        execFileSync('unzip', ['-q', join(dir, 'in.tmp'), '-d', extracted]);
      } else {
        const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
        execFileSync(tar, ['-xf', join(dir, 'in.tmp'), '-C', extracted]);
      }
      expect(readdirSync(extracted)).toEqual(['novel.txt']);
      expect(readFileSync(join(extracted, 'novel.txt'), 'utf8')).toBe(body);

      // (2) The ported extractor produces the reordered UTF-8 text.
      const out = (await prepareNovelTextArchive('downloads/in.tmp', { fs, now: () => 0 })) as string;
      expect(out).toMatch(/^downloads\/in\.tmp\.utf8-\d+$/);
      expect(readFileSync(join(dir, 'in.tmp.utf8-0'), 'utf8')).toBe(
        '《测试小说》\n作者：某人\n\n第1章 开端\n正文一。\n\n第2章 中段\n正文二。\r\n第3章 结尾\n正文三。\n\n',
      );
      expect(out).toBe('downloads/in.tmp.utf8-0');
      // Only the input and the result survive; raw/ordered intermediates are gone.
      expect(readdirSync(dir).sort()).toEqual(['in.tmp', 'in.tmp.utf8-0']);
    } finally {
      rmSync(extracted, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
