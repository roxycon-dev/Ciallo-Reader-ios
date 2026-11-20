/**
 * serve-web.mjs —— 零依赖静态服务器，用来在本机跑 `dist/` 里的生产产物。
 *
 * 为什么不用 `vite preview`：preview 会再起一套 Vite 中间件，第一次跑要几秒，
 * 而且它是 devDependency。这个脚本只用 `node:http` + `node:fs`，Node 24 直接跑，
 * 双击 `run-web.bat` 就能打开，不依赖 `node_modules` 是否完整。
 *
 * 行为与 iOS 的 WKWebView 对齐的三处细节：
 *
 * 1. **SPA fallback**：`/library`、`/reader/42` 这类前端路由在 Capacitor 里是
 *    直接命中 `index.html`（`capacitor.config.json` 的 `webDir` 由原生层兜底），
 *    这里必须同样处理，否则刷新就 404。
 * 2. **MIME 表按扩展名写全**：`.mjs` 必须是 `text/javascript`（Node 默认给
 *    `application/octet-stream`，浏览器会拒绝执行），`.webp` / `.otf` / `.tsv` /
 *    `.gzip` 各有各的（`anilist_titles.tsv.gzip` 是前端自己 `DecompressionStream`
 *    解压的二进制，给 `application/gzip` 而不是文本类型）。
 * 3. **不加 COOP/COEP**：本 App 不用 `SharedArrayBuffer` 也不用 wasm 线程
 *    （全仓 grep 无命中），加上反而会把外链图片/字体的 CORS 收紧。
 *
 * 用法：
 *   node scripts/serve-web.mjs                  # 端口 5173，自动找可用端口
 *   node scripts/serve-web.mjs --port 8080
 *   node scripts/serve-web.mjs --open           # 起完自动开浏览器
 *   node scripts/serve-web.mjs --dir ios/App/App/public   # 直接跑 iOS 工程里的那份
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

/** 命令行参数。 */
function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

const dirArg = arg('dir', 'dist');
const staticDir = path.resolve(root, typeof dirArg === 'string' ? dirArg : 'dist');
const wantPort = Number(arg('port', 5173));
const autoOpen = process.argv.includes('--open');

/** 扩展名 → Content-Type。顺序无所谓，查表用 `path.extname` 的完整后缀优先。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.gzip': 'application/gzip',
  '.gz': 'application/gzip',
  '.br': 'application/brotli',
  '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
  '.epub': 'application/epub+zip',
};

/** `.tsv.gzip` 这类双后缀取最后一段，但要让 `.gzip` 命中而不是 `.tsv`。 */
function contentTypeOf(file) {
  const lower = file.toLowerCase();
  const last = path.extname(lower);
  return MIME[last] ?? 'application/octet-stream';
}

function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/** 请求路径 → 磁盘文件；不存在返回 null（调用方走 SPA fallback）。 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  // 拒掉 `..` 越界：`path.resolve` 之后必须仍在 staticDir 内
  const candidate = path.resolve(staticDir, `.${decoded}`);
  const prefix = staticDir.endsWith(path.sep) ? staticDir : staticDir + path.sep;
  if (candidate !== staticDir && !candidate.startsWith(prefix)) return null;
  if (isFile(candidate)) return candidate;
  if (isFile(path.join(candidate, 'index.html'))) return path.join(candidate, 'index.html');
  return null;
}

let currentPort = wantPort;

const server = createServer((req, res) => {
  const urlPath = req.url ?? '/';
  let file = resolveFile(urlPath);

  // SPA fallback：前端路由（/library、/reader/1 …）一律回 index.html
  let status = 200;
  if (file === null) {
    const fallback = path.join(staticDir, 'index.html');
    if (isFile(fallback) && !urlPath.startsWith('/assets/') && !/\.[a-z0-9]{1,8}$/i.test(urlPath.split('?')[0])) {
      file = fallback;
    } else {
      status = 404;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 ${urlPath}\n`);
      return;
    }
  }

  const size = statSync(file).size;
  const headers = {
    'Content-Type': contentTypeOf(file),
    'Content-Length': String(size),
    // 产物文件名带 hash，可以长缓存；index.html 必须每次回源，否则升级后白屏
    'Cache-Control': path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    // 与 WKWebView 的 `capacitor://localhost` 一致：允许同源脚本读自己的资源
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  };

  if (req.method === 'HEAD') {
    res.writeHead(status, headers);
    res.end();
    return;
  }

  res.writeHead(status, headers);
  const stream = createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('read error\n');
  });
  stream.pipe(res);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && currentPort < wantPort + 20) {
    currentPort += 1;
    console.log(`端口 ${currentPort - 1} 被占用，试 ${currentPort}`);
    server.listen(currentPort, '0.0.0.0');
    return;
  }
  console.error('启动失败：', error.message);
  process.exit(1);
});

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(`http://${item.address}:${port}`);
    }
  }
  return out;
}

server.listen(currentPort, '0.0.0.0', () => {
  // 横幅刻意全用 ASCII：Windows 控制台默认代码页不是 UTF-8，中文会变乱码，
  // 而这条横幅是用户唯一能看到的「服务起没起来」的依据。
  if (!isFile(path.join(staticDir, 'index.html'))) {
    console.log(`\n[!] ${staticDir} has no index.html`);
    console.log('    run `npm run build` (or `npm run ios:sync`) first\n');
  }
  console.log('\n  Ciallo Reader - production build');
  console.log(`  dir     ${staticDir}`);
  console.log(`  local   http://127.0.0.1:${currentPort}/`);
  for (const address of lanAddresses(currentPort)) console.log(`  lan     ${address}/   (same Wi-Fi: open on phone)`);
  console.log('\n  Ctrl+C to stop\n');

  if (autoOpen) {
    const url = `http://127.0.0.1:${currentPort}/`;
    const command =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
    try {
      spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref();
    } catch {
      // 打不开浏览器不影响服务器
    }
  }
});
