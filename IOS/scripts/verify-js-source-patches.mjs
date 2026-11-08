import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';

// Expected hashes were produced by compiling/running the current Android Kotlin
// patch functions, independently of this TypeScript implementation.
const manifest = JSON.parse(await readFile(new URL('../tests/fixtures/source-patches-49/oracle.json', import.meta.url), 'utf8'));
const server = await createServer({ server: { middlewareMode: true } });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
try {
  const { patchScript } = await server.ssrLoadModule('/src/core/source/js/jsSourceRepo.ts');
  for (const item of manifest.sources) {
    assert.match(item.fileName, /^[a-zA-Z0-9_.-]+\.js$/);
    const response = await fetch(`https://raw.githubusercontent.com/venera-app/venera-configs/${manifest.upstreamCommit}/${item.fileName}`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; assert(length <= 512 * 1024, 'Source exceeds script budget'); chunks.push(part.value); } }
    finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    assert.equal(sha256(bytes), item.inputSha256, `${item.key}: pinned upstream bytes changed`);
    const patched = patchScript(item.key, bytes.toString('utf8'));
    assert.equal(sha256(patched), item.androidPatchedSha256, `${item.key}: output differs from the JVM oracle`);
    new Script(patched, { filename: item.fileName }); // Parse only; never execute downloaded sources.
    console.log(`${item.key}: exact Android output, valid JavaScript`);
  }
  console.log(`${manifest.sources.length} fixed-revision source repairs verified`);
} finally { await server.close(); }
