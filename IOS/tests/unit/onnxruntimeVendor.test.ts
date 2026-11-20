/**
 * onnxruntimeVendor.test.ts —— vendored ONNX Runtime SPM 包的**完整性互锁**。
 *
 * 背景（2026-11-20）：微软把 `microsoft/onnxruntime` 与
 * `microsoft/onnxruntime-swift-package-manager` 从 GitHub 下架（两个 URL 均 404），
 * CI run #39 的 ios-build / ios-device 因此在 SPM 解析阶段失败
 * （`could not read Username for 'https://github.com'` = 仓库不存在的典型表现）。
 *
 * 修复方式：把 1.24.2 的包源码 vendor 进 `ios/App/onnxruntime-swift-package-manager/`，
 * pbxproj 改用 XCLocalSwiftPackageReference。二进制仍走微软官方 CDN
 * `download.onnxruntime.ai`，SHA256 用微软自己在 Package.swift 里公布的校验和。
 *
 * 本测试把四方钉在一起，任何一方漂移都会红：
 *   ① vendor 目录的 75 个文件逐一重算 git blob SHA1，与 fixture（来自原始 commit
 *      b7fb7f7 的 tree 59178ce，经两个独立镜像交叉验证）完全一致，且不许多出文件；
 *   ② pbxproj 必须是本地包引用，不许回退到已下架的微软远程 URL；
 *   ③ vendor 的 Package.swift 里二进制 URL / 校验和必须仍是官方值（不许换成镜像地址）；
 *   ④ docs/ONNXRUNTIME_VENDOR.md 的溯源锚点（commit / tree / sha256）与 fixture 一致。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.resolve(ROOT, rel), 'utf8');

const VENDOR_DIR = 'ios/App/onnxruntime-swift-package-manager';
const PBXPROJ = read('ios/App/App.xcodeproj/project.pbxproj');
const MANIFEST = read(`${VENDOR_DIR}/Package.swift`);
const PROVENANCE = read('docs/ONNXRUNTIME_VENDOR.md');

interface VendorFixture {
  upstream: string;
  tag: string;
  commit: string;
  tree: string;
  verifiedVia: string[];
  binary: { url: string; sha256: string; size: number };
  files: Record<string, string>;
}
const FIXTURE = JSON.parse(read('tests/fixtures/onnxruntimeVendorTree.json')) as VendorFixture;

/** git blob 对象的 SHA1：`sha1("blob <字节数>\0" + 内容)`。 */
function gitBlobSha(rel: string): string {
  const content = readFileSync(path.resolve(ROOT, VENDOR_DIR, rel));
  const header = Buffer.from(`blob ${content.byteLength}\0`, 'ascii');
  return createHash('sha1').update(header).update(content).digest('hex');
}

/** 递归列出 vendor 目录下的全部文件（相对路径， posix 分隔符）。 */
function walkVendor(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.resolve(ROOT, dir))) {
    const rel = base === '' ? name : `${base}/${name}`;
    const full = path.resolve(ROOT, dir, name);
    if (statSync(full).isDirectory()) out.push(...walkVendor(`${dir}/${name}`, rel));
    else out.push(rel);
  }
  return out;
}

describe('vendor 源码树 · 与微软原始 commit 逐文件一致', () => {
  it('fixture 锚点：1.24.2 / commit b7fb7f7 / 75 个文件 / 两个独立镜像', () => {
    expect(FIXTURE.tag).toBe('1.24.2');
    expect(FIXTURE.commit).toBe('b7fb7f7dea8a2469e6335d95a61b8f36d0dc83b2');
    expect(FIXTURE.tree).toBe('59178cede37305e8725fd09d5907d872a55004f1');
    expect(Object.keys(FIXTURE.files)).toHaveLength(75);
    expect(FIXTURE.verifiedVia.length).toBeGreaterThanOrEqual(2);
  });

  it('75 个文件的 git blob SHA1 全部与原始 tree 一致', () => {
    const mismatched: string[] = [];
    for (const [rel, sha] of Object.entries(FIXTURE.files)) {
      if (gitBlobSha(rel) !== sha) mismatched.push(rel);
    }
    expect(mismatched).toEqual([]);
  });

  it('vendor 目录不许多出或缺少文件（防止夹带私货）', () => {
    const actual = walkVendor(VENDOR_DIR).sort();
    const expected = Object.keys(FIXTURE.files).sort();
    expect(actual).toEqual(expected);
  });
});

describe('pbxproj · 本地 SPM 引用', () => {
  it('onnxruntime 包引用必须是 XCLocalSwiftPackageReference 且指向 vendor 目录', () => {
    expect(PBXPROJ).toContain('A1000000000000000000001B /* XCLocalSwiftPackageReference "onnxruntime-swift-package-manager" */');
    expect(PBXPROJ).toContain('relativePath = "onnxruntime-swift-package-manager";');
  });

  it('不许回退到已下架的微软远程仓库（任何 XCRemoteSwiftPackageReference 都不允许）', () => {
    // 负断言前先滤掉注释行，避免命中本文件头部说明里的历史 URL（工程已知坑）。
    const codeLines = PBXPROJ.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const code = codeLines.join('\n');
    expect(code).not.toContain('XCRemoteSwiftPackageReference');
    expect(code).not.toContain('github.com/microsoft/onnxruntime');
  });

  it('product 依赖 onnxruntime 仍挂在 App target 上且指向本地包引用', () => {
    expect(PBXPROJ).toContain('productName = onnxruntime;');
    expect(PBXPROJ).toContain('package = A1000000000000000000001B /* XCLocalSwiftPackageReference "onnxruntime-swift-package-manager" */;');
    expect(PBXPROJ).toContain('A1000000000000000000001D /* onnxruntime in Frameworks */');
  });
});

describe('Package.swift · 二进制只走微软官方 CDN', () => {
  it('pod archive 的 URL 与 SHA256 必须仍是官方公布值', () => {
    expect(MANIFEST).toContain(FIXTURE.binary.url);
    expect(MANIFEST).toContain(FIXTURE.binary.sha256);
    expect(FIXTURE.binary.url).toBe('https://download.onnxruntime.ai/pod-archive-onnxruntime-c-1.24.2.zip');
    expect(FIXTURE.binary.sha256).toBe('f7100a992d2a8135168c8afd831e6a58b465349101982aa58b3e11d36e600b54');
  });

  it('不许把二进制指向任何第三方镜像', () => {
    const codeLines = MANIFEST.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const code = codeLines.join('\n');
    expect(code).not.toContain('github.com/');
    expect(code).not.toContain('selim6167');
    expect(code).not.toContain('GuLP-AAC');
  });

  it('product 与模块名和原生插件的 import 对得上', () => {
    expect(MANIFEST).toContain('.library(name: "onnxruntime"');
    expect(MANIFEST).toContain('.target(name: "OnnxRuntimeBindings"');
    const plugin = read('ios/App/App/Plugins/ReaderMangaModelsPlugin.swift');
    expect(plugin).toContain('import OnnxRuntimeBindings');
  });
});

describe('溯源文档 · 与 fixture 互锁', () => {
  it('ONNXRUNTIME_VENDOR.md 必须写明 commit / tree / 官方校验和', () => {
    expect(PROVENANCE).toContain(FIXTURE.commit);
    expect(PROVENANCE).toContain(FIXTURE.tree);
    expect(PROVENANCE).toContain(FIXTURE.binary.sha256);
    expect(PROVENANCE).toContain(FIXTURE.binary.url);
  });
});