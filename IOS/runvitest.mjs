import { startVitest } from 'vitest/node';

const pattern = process.argv[2] ?? '';
const file = process.argv[3] ?? 'tests/unit/comicSheetsWiring.test.tsx';

const vitest = await startVitest('test', [file], {
  testNamePattern: pattern || undefined,
  run: true,
  watch: false,
  reporters: ['dot'],
});

if (!vitest) {
  console.log('RESULT:NO_VITEST');
  process.exit(1);
}

await vitest.close();

function collect(tasks, out) {
  for (const t of tasks) {
    if (t.type === 'test') {
      out.push(t);
    } else if (t.tasks) {
      collect(t.tasks, out);
    }
  }
  return out;
}

const files = vitest.state.getFiles?.() ?? [];
let all = [];
for (const f of files) collect(f.tasks ?? [], all);
const passed = all.filter((t) => t.result?.state === 'pass').length;
const failed = all.filter((t) => t.result?.state !== 'pass');
console.log(`RESULT: total=${all.length} passed=${passed} failed=${failed.length}`);
for (const t of failed) {
  const msg = (t.result?.errors?.[0]?.message ?? 'unknown error').split('\n').slice(0, 4).join(' | ');
  console.log(`FAIL: ${t.name}\n   ${msg}`);
}
