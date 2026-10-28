import { Capacitor } from '@capacitor/core';

export interface WebsiteVerificationResult {
  verified: boolean;
  html?: string;
  url?: string;
  cookies: Array<{ domain: string; name: string; value: string; path: string; secure: boolean; expires?: number }>;
}
interface WebsitePlugin { verify(options: { url: string; userAgent: string; extractPage: boolean }): Promise<WebsiteVerificationResult> }

export async function verifySourceWebsite(url: string, userAgent: string, extractPage = false): Promise<WebsiteVerificationResult> {
  if (!Capacitor.isNativePlatform()) throw new Error('站点验证需要在 iOS 应用中完成；浏览器预览无法回传站点登录状态。');
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin<WebsitePlugin>('ReaderWebsite').verify({ url, userAgent, extractPage });
}
