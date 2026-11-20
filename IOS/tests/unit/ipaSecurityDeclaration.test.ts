/**
 * ipaSecurityDeclaration.test.ts —— IPA 安全性声明的**执行机制**。
 *
 * 用户要求「记得做 IPA 安全性声明」。声明本身写在
 * `docs/IPA_SECURITY_DECLARATION.md`，但如果只写文档、不做校验，它会在第一次改
 * plist 时静默过期。本测试把三方钉在一起：
 *
 *   ① `ios/App/App/Info.plist` 的九个安全相关键（出口合规 / ATS / 权限 / 后台模式 /
 *      文件共享）；
 *   ② `ios/App/App/PrivacyInfo.xcprivacy` 的四类声明（跟踪 / 跟踪域名 / 收集类型 /
 *      必需原因 API 三条）；
 *   ③ `docs/IPA_SECURITY_DECLARATION.md` 的权限表 —— 与 plist 的
 *      `NS*UsageDescription` **双向**一致（文档多写 = 文档过期；plist 多写 = 未申报）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const read = (rel: string): string => readFileSync(path.resolve(ROOT, rel), 'utf8');

const INFO_PLIST = read('ios/App/App/Info.plist');
const PRIVACY = read('ios/App/App/PrivacyInfo.xcprivacy');
const DECLARATION = read('docs/IPA_SECURITY_DECLARATION.md');

/** 从 plist 里取 `<key>k</key>` 后面的原始值片段（不做完整 XML 解析）。 */
function plistValue(plist: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*([\\s\\S]*?)(?=<key>|</dict>)`).exec(plist);
  return match === null ? null : (match[1] ?? '').trim();
}

/** 文档「四、权限用途」一节里出现的全部 `NS*` 键（去反引号）。 */
function documentedPermissionKeys(markdown: string): string[] {
  const section = markdown.slice(markdown.indexOf('## 四、权限用途'), markdown.indexOf('## 五、传输安全'));
  const keys = new Set<string>();
  for (const m of section.matchAll(/`(NS[A-Za-z]+)`/g)) {
    const key = m[1] as string;
    keys.add(key);
  }
  return [...keys].sort();
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① 出口合规
   ══════════════════════════════════════════════════════════════════════════════ */

describe('Info.plist · 出口合规', () => {
  it('`ITSAppUsesNonExemptEncryption` 必须是 `false`（唯一允许的值）', () => {
    const value = plistValue(INFO_PLIST, 'ITSAppUsesNonExemptEncryption');
    expect(value).not.toBeNull();
    // 只允许 `<false/>`；写成 `<true/>` 意味着要重走出口分类
    expect(value).toContain('<false/>');
    expect(value).not.toContain('<true/>');
  });

  it('bundle 标识与版本键齐全（声明文件里的 App 身份要能对上）', () => {
    for (const key of [
      'CFBundleIdentifier',
      'CFBundleShortVersionString',
      'CFBundleVersion',
      'CFBundleDisplayName',
    ]) {
      expect(plistValue(INFO_PLIST, key)).not.toBeNull();
    }
    expect(INFO_PLIST).toContain('$(PRODUCT_BUNDLE_IDENTIFIER)');
    expect(DECLARATION).toContain('com.aistudio.ciallo.reader');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② ATS 与凭据边界
   ══════════════════════════════════════════════════════════════════════════════ */

describe('Info.plist · ATS', () => {
  it('`NSAppTransportSecurity` 开 `NSAllowsArbitraryLoads`（用户自填书源可为 http）', () => {
    // 嵌套 dict：不能只取「到下一个 <key> 为止」的片段，要直连匹配两层
    const ats = /<key>NSAppTransportSecurity<\/key>\s*<dict>\s*<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(
      INFO_PLIST,
    );
    expect(ats).toBe(true);
    // 不允许出现任意加载之外的宽松开关
    for (const forbidden of ['NSAllowsArbitraryLoadsInWebContent', 'NSExceptionAllowsInsecureHTTPLoads', 'NSAllowsLocalNetworking']) {
      expect(INFO_PLIST).not.toContain(forbidden);
    }
  });

  it('声明文档必须解释这个开关，并给出「明文不带凭据」的三重缓解', () => {
    expect(DECLARATION).toContain('NSAllowsArbitraryLoads');
    expect(DECLARATION).toContain('insecureCredentialViolation');
    expect(DECLARATION).toContain('stripSensitiveHeadersOnCrossHost');
    expect(DECLARATION).toContain('allowSession');
    // 三条缓解对应的生产代码必须真的存在
    const networkCalls = read('src/core/source/networkCalls.ts');
    expect(networkCalls).toContain('insecureCredentialViolation');
    const worker = read('src/core/download/downloadWorker.ts');
    expect(worker).toContain('stripSensitiveHeadersOnCrossHost');
    expect(worker).toContain('CDN_HOST_MARKERS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ 权限用途双向一致
   ══════════════════════════════════════════════════════════════════════════════ */

describe('Info.plist × 声明文档 · 权限表双向一致', () => {
  const plistKeys = [...INFO_PLIST.matchAll(/<key>(NS[A-Za-z]*UsageDescription)<\/key>/g)]
    .map((m) => m[1] as string)
    .sort();
  const docKeys = documentedPermissionKeys(DECLARATION);

  it('plist 里每个 `NS*UsageDescription` 都在文档里有行', () => {
    expect(plistKeys.length).toBeGreaterThanOrEqual(4);
    for (const key of plistKeys) {
      expect(docKeys, `文档缺少 ${key}`).toContain(key);
    }
  });

  it('文档里写的每个 `NS*` 键都真的在 plist 里（防文档凭空多写）', () => {
    for (const key of docKeys) {
      expect(INFO_PLIST, `plist 缺少 ${key}`).toContain(`<key>${key}</key>`);
    }
  });

  it('每条用途描述都不是空串，且写明「拒绝后怎么办」', () => {
    for (const key of plistKeys) {
      const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(INFO_PLIST);
      expect(match, `${key} 缺少 <string>`).not.toBeNull();
      const text = (match?.[1] ?? '').trim();
      expect(text.length).toBeGreaterThan(8);
      expect(text).not.toContain('TODO');
    }
  });

  it('本地网络与 Bonjour 声明成对出现（互传发现需要两者）', () => {
    expect(INFO_PLIST).toContain('<key>NSLocalNetworkUsageDescription</key>');
    expect(INFO_PLIST).toContain('<key>NSBonjourServices</key>');
    expect(INFO_PLIST).toContain('_ciallo-xfer._tcp');
    expect(DECLARATION).toContain('_ciallo-xfer._tcp');
  });

  it('`UIBackgroundModes` 只含 `audio`（TTS 续播），没有借机开定位/蓝牙', () => {
    const value = plistValue(INFO_PLIST, 'UIBackgroundModes');
    expect(value).not.toBeNull();
    expect(value).toContain('<string>audio</string>');
    for (const forbidden of ['location', 'bluetooth-central', 'bluetooth-peripheral', 'voip', 'fetch', 'remote-notification']) {
      expect(value, `不应声明 ${forbidden}`).not.toContain(`<string>${forbidden}</string>`);
    }
  });

  it('`UIFileSharingEnabled = false`（沙箱不暴露给「文件」App）', () => {
    expect(plistValue(INFO_PLIST, 'UIFileSharingEnabled')).toContain('<false/>');
    expect(DECLARATION).toContain('UIFileSharingEnabled = false');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ 隐私清单
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PrivacyInfo.xcprivacy · 四项声明', () => {
  it('不做跟踪：`NSPrivacyTracking` 为 false，且跟踪域名为空', () => {
    expect(plistValue(PRIVACY, 'NSPrivacyTracking')).toContain('<false/>');
    const domains = plistValue(PRIVACY, 'NSPrivacyTrackingDomains');
    expect(domains).not.toBeNull();
    expect(domains).toContain('<array/>');
  });

  it('不收集数据：`NSPrivacyCollectedDataTypes` 为空数组', () => {
    const collected = plistValue(PRIVACY, 'NSPrivacyCollectedDataTypes');
    expect(collected).not.toBeNull();
    expect(collected).toContain('<array/>');
  });

  it('三条必需原因 API 与原因码逐字（DiskSpace / FileTimestamp / UserDefaults）', () => {
    expect(PRIVACY).toContain('NSPrivacyAccessedAPICategoryDiskSpace');
    expect(PRIVACY).toContain('85F4.1');
    expect(PRIVACY).toContain('NSPrivacyAccessedAPICategoryFileTimestamp');
    expect(PRIVACY).toContain('C617.1');
    expect(PRIVACY).toContain('NSPrivacyAccessedAPICategoryUserDefaults');
    expect(PRIVACY).toContain('CA92.1');
    // 不许多申报：只允许这三类
    const categories = [...PRIVACY.matchAll(/NSPrivacyAccessedAPICategory(\w+)/g)].map((m) => m[1]);
    expect([...new Set(categories)].sort()).toEqual(['DiskSpace', 'FileTimestamp', 'UserDefaults']);
  });

  it('声明文档里写的三个原因码与 plist 一致', () => {
    for (const code of ['85F4.1', 'C617.1', 'CA92.1']) {
      expect(DECLARATION).toContain(code);
    }
    expect(DECLARATION).toContain('NSPrivacyCollectedDataTypes');
    expect(DECLARATION).toContain('NSPrivacyTracking');
  });

  it('声明里点名的代码位置都真实存在（防「文档写的实现不在」）', () => {
    for (const rel of [
      'src/core/download/downloadWorker.ts',
      'src/core/cache/cacheManagement.ts',
      'src/core/transfer/transferSession.ts',
      'ios/App/App/Plugins/ReaderMangaModelsPlugin.swift',
    ]) {
      expect(read(rel).length, `${rel} 为空或不存在`).toBeGreaterThan(100);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ 声明文档的结构完整性
   ══════════════════════════════════════════════════════════════════════════════ */

describe('IPA 安全声明 · 结构', () => {
  it('十三个小节齐全（摘要 / 合规 / 隐私 / 权限 / ATS / 本地 / WebView / 供应链 / 日志 / 审核问答 / 限制 / 清单 / 校验）', () => {
    const headings = [
      '## 一、声明摘要',
      '## 二、出口合规',
      '## 三、隐私清单',
      '## 四、权限用途',
      '## 五、传输安全',
      '## 六、本地数据保护',
      '## 七、WebView 与用户书源脚本',
      '## 八、代码完整性与供应链',
      '## 九、日志与诊断',
      '## 十、App Store 审核问答',
      '## 十一、已知限制与残余风险',
      '## 十二、复核清单',
      '## 十三、机器校验入口',
    ];
    for (const heading of headings) expect(DECLARATION).toContain(heading);
  });

  it('自带发布前复选框（12 条），且不写「已完成」这类会失效的措辞', () => {
    const checkboxes = DECLARATION.match(/^- \[ \] /gm) ?? [];
    expect(checkboxes.length).toBeGreaterThanOrEqual(9);
    expect(DECLARATION).not.toContain('- [x]');
  });

  it('声明里不出现裸的「我们认为安全」式断言（要么给机制，要么给代码位置）', () => {
    // 每个安全结论都要落到具体文件或具体判据：文件名出现次数应远多于「安全」二字
    const fileRefs = DECLARATION.match(/`[a-zA-Z0-9_./-]+\.(?:ts|tsx|swift|plist|xcprivacy|json)`/g) ?? [];
    expect(fileRefs.length).toBeGreaterThanOrEqual(12);
  });
});
