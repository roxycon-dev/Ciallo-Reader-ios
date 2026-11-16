/**
 * pack-ios-bundle.mjs —— 把「能在 Mac 上直接出 IPA」的最小完整快照打成一个 zip。
 *
 * 背景：IPA 的编译必须用 macOS + Xcode（arm64 Mach-O、Swift、onnxruntime
 * framework、actool 资源编译、codesign）。Windows 上没有这条工具链，任何
 * 「在 Windows 上生成 .ipa」的做法都只会产出一个不含二进制的空壳。
 *
 * 所以 Windows 侧能做的最有价值的事是把**已经构建并同步好的工程**连同
 * 「一条命令出包」的脚本一起打包，拷到 Mac 上解压即跑：
 *
 *   unzip CialloReader-iOS-1.6.4-264-src.zip -d ~/CialloReader
 *   cd ~/CialloReader/IOS
 *   npm ci
 *   ./scripts/build-ipa.sh
 *
 * 用法：
 *   node scripts/pack-ios-bundle.mjs            # 完整源码包
 *   node scripts/pack-ios-bundle.mjs --web-only # 只打 dist + ios 工程（Mac 上不重新构建 web）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dirname, '..');
const webOnly = process.argv.includes('--web-only');

/** 这些目录一律不进包：依赖、本地产物、缓存、测试残留。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.tmp',
  'build',
  'dist',
  'test-results',
  'playwright-report',
  'blob-report',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'DerivedData',
  'SourcePackages',
  'xcuserdata',
  'Pods',
  'ipa-export',
  'ipa-stage',
]);

/** macOS 上会自己重新生成的产物目录（体积大且与机器相关）。 */
const SKIP_PATH_FRAGMENTS = [
  '/ios/App/App.xcodeproj/project.xcworkspace/xcuserdata/',
  '/ios/App/App.xcworkspace/xcuserdata/',
  '/parity/android-export/build/',
  '/parity/android-export/.gradle/',
];

const collected = [];
let skippedBytes = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        skippedBytes += dirSize(full);
        continue;
      }
      if (SKIP_PATH_FRAGMENTS.some((fragment) => `/${rel}/`.includes(fragment))) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    // 本轮的中间日志
    if (/^\.tmp/.test(entry.name)) continue;
    collected.push(rel);
  }
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 权限或竞态：跳过 */
        }
      }
    }
  }
  return total;
}

walk(root);

const wanted = webOnly
  ? collected.filter((rel) => rel.startsWith('ios/') || rel === 'package.json' || rel === 'package-lock.json' || rel.startsWith('scripts/'))
  : collected;

if (wanted.length === 0) {
  console.error('没有收集到任何文件，检查路径');
  process.exit(1);
}

const files = {};
let rawBytes = 0;
for (const rel of wanted) {
  const full = path.join(root, rel);
  const data = fs.readFileSync(full);
  rawBytes += data.byteLength;
  files[rel] = new Uint8Array(data);
}

const version = (() => {
  try {
    const pbx = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const marketing = /MARKETING_VERSION = ([^;]+);/.exec(pbx)?.[1]?.trim() ?? 'unknown';
    const build = /CURRENT_PROJECT_VERSION = ([^;]+);/.exec(pbx)?.[1]?.trim() ?? 'unknown';
    return `${marketing}-${build}`;
  } catch {
    return 'unknown';
  }
})();

const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(
  outDir,
  `CialloReader-iOS-${version}${webOnly ? '-web' : '-src'}.zip`,
);

const zipped = zipSync(files, { level: 6 });
fs.writeFileSync(outPath, zipped);

const sha = createHash('sha256').update(zipped).digest('hex');
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

console.log(`文件数        ${wanted.length}`);
console.log(`原始体积      ${mb(rawBytes)}`);
console.log(`压缩后        ${mb(zipped.byteLength)}`);
console.log(`跳过的目录    ${mb(skippedBytes)}（node_modules / dist / build / 缓存）`);
console.log(`版本          ${version}`);
console.log(`输出          ${path.relative(root, outPath)}`);
console.log(`sha256        ${sha}`);
