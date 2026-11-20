/**
 * zlibraryLoginDialogParity.test.ts —— `ui/source/ZLibraryLoginDialog.kt`（245 行 / 203 非空）。
 *
 * 本文件此前是按 **351 行的旧版** Kotlin 写的：旧版有 `hazeState` / `TabRow` /
 * `AppLiquidButton` / `supportsCookieLogin` / 「登录 Z-Library」固定标题；当前原文早已改成
 * `WenkuActionSheet` + `SegmentedPillSelector` + `SourceCredentialFields`，并多了
 * 「站点验证」（`js_mycomic`）这条形态。本轮按原文整体重写（E193），并把 L202-245 的
 * `SourceCredentialFields` 落成独立组件。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  COOKIE_FIELD_LABEL,
  COOKIE_FIELD_MIN_HEIGHT_DP,
  COOKIE_FIELD_PLACEHOLDER,
  LOGIN_FAILED_FALLBACK,
  LOGIN_MODE_COOKIE,
  LOGIN_MODE_PASSWORD,
  REGISTRATION_URL_TIMEOUT_MS,
  REGISTER_FAILED_FALLBACK,
  SITE_VERIFICATION_HINT,
  canSubmitLogin,
  isJsSourceId,
  isSiteVerificationSource,
  loginActionLabel,
  loginCredentialFor,
  loginDialogTitle,
  loginModeOptions,
  loginSuccessMessage,
  type LoginFormState,
} from '@ui/components/source/ZLibraryLoginDialog';
import {
  SOURCE_CREDENTIAL_FIELD_GAP_DP,
  SOURCE_CREDENTIAL_FIELD_RADIUS_DP,
  SOURCE_CREDENTIAL_HIDE_PASSWORD,
  SOURCE_CREDENTIAL_LABEL_PASSWORD,
  SOURCE_CREDENTIAL_LABEL_USERNAME,
  SOURCE_CREDENTIAL_SHOW_PASSWORD,
} from '@ui/components/source/SourceCredentialFields';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const KT = kt('ui/source/ZLibraryLoginDialog.kt');
const DIALOG = readFileSync('src/ui/components/source/ZLibraryLoginDialog.tsx', 'utf8');
const FIELDS = readFileSync('src/ui/components/source/SourceCredentialFields.tsx', 'utf8');

function state(overrides: Partial<LoginFormState> = {}): LoginFormState {
  return {
    loading: false,
    siteVerification: false,
    loginMode: LOGIN_MODE_PASSWORD,
    username: '',
    password: '',
    cookie: '',
    ...overrides,
  };
}

describe('ZLibraryLoginDialog.kt L44-66 形参与注册地址', () => {
  it('四个形参：source / onDismiss / onSuccess / onRegister（可空挂起函数）', () => {
    expect(KT).toContain('fun ZLibraryLoginDialog(');
    expect(KT).toContain('    source: BookSource,');
    expect(KT).toContain('    onDismiss: () -> Unit,');
    expect(KT).toContain('    onSuccess: () -> Unit,');
    expect(KT).toContain('    onRegister: (suspend () -> Unit)? = null,');
    expect(DIALOG).toContain('onRegister?: (() => Promise<void>) | null;');
  });

  it('注册地址：`rememberAsyncState(null, source)` + 5 秒超时', () => {
    expect(KT).toContain('val registrationUrl by rememberAsyncState<String?>(null, source) {');
    expect(KT).toContain('value = withTimeoutOrNull(5_000) { source.getRegistrationUrl() }');
    expect(REGISTRATION_URL_TIMEOUT_MS).toBe(5000);
  });

  it('两条身份判定：isJsSource（前缀）与 siteVerification（js_mycomic）', () => {
    expect(KT).toContain('val isJsSource = source.id.startsWith("js_")');
    expect(KT).toContain('val siteVerification = source.id in setOf("js_mycomic", "js_bilimanga", "xbookcn")');
    expect(isJsSourceId('js_vomic')).toBe(true);
    expect(isJsSourceId('js_mycomic')).toBe(true);
    expect(isJsSourceId('zlibrary')).toBe(false);
    expect(isSiteVerificationSource('js_mycomic')).toBe(true);
    expect(isSiteVerificationSource('js_vomic')).toBe(false);
  });

  it('标题：验证 <源名> / 登录 <源名>（裸字面量，不是「登录 Z-Library」）', () => {
    expect(KT).toContain('val title = if (siteVerification) "验证 ${source.name}" else "登录 ${source.name}"');
    expect(loginDialogTitle(true, '漫画柜')).toBe('验证 漫画柜');
    expect(loginDialogTitle(false, '漫画柜')).toBe('登录 漫画柜');
    expect(DIALOG).not.toContain('登录 Z-Library');
  });

  it('外壳是 WenkuActionSheet，且站点验证形态不抬键盘', () => {
    expect(KT).toContain('WenkuActionSheet(title, onDismiss, fitKeyboard = !siteVerification || source.id == "xbookcn") {');
    expect(DIALOG).toContain("fitKeyboard={!siteVerification || source.id === 'xbookcn'}");
  });
});

describe('ZLibraryLoginDialog.kt L69-101 可提交判定与凭据', () => {
  it('canSubmit = !loading && (siteVerification || 账号密码非空 / cookie 非空)', () => {
    expect(KT).toContain('val canSubmit = !loading && when {');
    expect(KT).toContain('xbookcnCookieMode -> cookie.isNotBlank()');
    expect(KT).toContain('siteVerification -> true');
    expect(KT).toContain('loginMode == 0 -> username.isNotBlank() && password.isNotBlank()');
    expect(KT).toContain('else -> cookie.isNotBlank()');
    expect(canSubmitLogin(state())).toBe(false);
    expect(canSubmitLogin(state({ username: 'a' }))).toBe(false);
    expect(canSubmitLogin(state({ username: 'a', password: 'b' }))).toBe(true);
    expect(canSubmitLogin(state({ username: '  ', password: 'b' }))).toBe(false);
    expect(canSubmitLogin(state({ loginMode: LOGIN_MODE_COOKIE }))).toBe(false);
    expect(canSubmitLogin(state({ loginMode: LOGIN_MODE_COOKIE, cookie: 'c=1' }))).toBe(true);

    // 站点验证形态没有输入框，永远可提交
    // xbookcn 的「粘贴 Cookie」形态：cookie 空 → 不可提交（必须先于 siteVerification 判）
    expect(canSubmitLogin(state({ xbookcnCookieMode: true, siteVerification: true }))).toBe(false);
    expect(canSubmitLogin(state({ xbookcnCookieMode: true, siteVerification: true, cookie: 'cf_clearance=1' }))).toBe(true);
    // 站点验证形态没有输入框，永远可提交
    expect(canSubmitLogin(state({ siteVerification: true }))).toBe(true);
    // loading 中一律不可提交
    expect(canSubmitLogin(state({ siteVerification: true, loading: true }))).toBe(false);
    expect(canSubmitLogin(state({ username: 'a', password: 'b', loading: true }))).toBe(false);
  });

  it('凭据：siteVerification 或 cookie 模式只带 cookie；账号密码模式带两个字段', () => {
    expect(KT).toContain('val credential = if (siteVerification || loginMode == 1) {');
    expect(KT).toContain('LoginCredential(cookie = cookie)');
    expect(KT).toContain('LoginCredential(username = username, password = password)');
    const cookieOnly = loginCredentialFor(state({ siteVerification: true, cookie: 'c=1' }));
    expect(cookieOnly).toEqual({ username: '', password: '', cookie: 'c=1', extraData: {} });
    const byCookie = loginCredentialFor(state({ loginMode: LOGIN_MODE_COOKIE, cookie: 'c=2' }));
    expect(byCookie.cookie).toBe('c=2');
    const byPassword = loginCredentialFor(state({ username: 'u', password: 'p', cookie: 'ignored' }));
    expect(byPassword.username).toBe('u');
    expect(byPassword.password).toBe('p');
    expect(byPassword.cookie).toBeNull();
  });

  it('成功后才关闭；失败把 message 落进内联 error（不是 toast）', () => {
    expect(KT).toContain('AppToast.makeText(context, if (siteVerification) tr("验证成功") else tr("登录成功"), Toast.LENGTH_SHORT).show()');
    expect(KT).toContain('error = result.exception.message ?: "登录失败"');
    expect(KT).toContain('closeAfterSuccess()');
    expect(loginSuccessMessage(true)).toBe('验证成功');
    expect(loginSuccessMessage(false)).toBe('登录成功');
    expect(LOGIN_FAILED_FALLBACK).toBe('登录失败');
    // 错误是内联段落，不是 toast
    expect(DIALOG).toContain('<p className="zlib-login-error">{error}</p>');
    expect(DIALOG).toContain('setError(result.exception.message !== \'\' ? result.exception.message : LOGIN_FAILED_FALLBACK)');
  });

  it('取消异常原样抛（CancellationException 分支在 catch Exception 之前）', () => {
    const cancelIndex = KT.indexOf('} catch (e: CancellationException) {');
    const catchIndex = KT.indexOf('} catch (e: Exception) {');
    expect(cancelIndex).toBeGreaterThan(0);
    expect(catchIndex).toBeGreaterThan(cancelIndex);
    expect(KT.slice(cancelIndex, cancelIndex + 80)).toContain('throw e');
  });
});

describe('ZLibraryLoginDialog.kt L103-147 两种输入形态', () => {
  it('非 JS 源才显示 SegmentedPillSelector：0 账号密码 / 1 粘贴 Cookie，14sp', () => {
    expect(KT).toContain('if (!isJsSource && !siteVerification) {');
    expect(KT).toContain('options = listOf(0 to tr("账号密码"), 1 to tr("粘贴 Cookie")),');
    expect(KT).toContain('fontSp = 14f,');
    const options = loginModeOptions();
    expect(options).toHaveLength(2);
    expect(options[0]!.value).toBe(LOGIN_MODE_PASSWORD);
    expect(options[1]!.value).toBe(LOGIN_MODE_COOKIE);
  });

  it('切模式时清 error，loading 中不可切', () => {
    expect(KT).toContain('onSelect = { if (!loading) { loginMode = it; error = null } },');
    expect(DIALOG).toContain('if (loading) return;');
    expect(DIALOG).toContain('setError(null);');
  });

  it('站点验证形态：一句提示，没有任何输入框', () => {
    expect(KT).toContain('"在应用内完成站点验证后会自动返回，浏览凭据由应用保存。",');
    expect(SITE_VERIFICATION_HINT).toBe('在应用内完成站点验证后会自动返回，浏览凭据由应用保存。');
    expect(DIALOG).toContain('{siteVerification ? (\n        <p className="zlib-login-hint">{SITE_VERIFICATION_HINT}</p>');
  });

  it('Cookie 框：label「Cookie」/ placeholder `remix_userid=…; remix_userkey=…` / 最小高 112dp', () => {
    expect(KT).toContain('label = { Text("Cookie") },');
    expect(KT).toContain('placeholder = { Text("remix_userid=…; remix_userkey=…") },');
    expect(KT).toContain('modifier = Modifier.fillMaxWidth().heightIn(min = 112.dp),');
    expect(COOKIE_FIELD_LABEL).toBe('Cookie');
    expect(COOKIE_FIELD_PLACEHOLDER).toBe('remix_userid=…; remix_userkey=…');
    expect(COOKIE_FIELD_MIN_HEIGHT_DP).toBe(112);
    expect(DIALOG).toContain('style={{ minHeight: COOKIE_FIELD_MIN_HEIGHT_DP }}');
  });

  it('模式切换有滑入淡入（位移 1/8 宽），减少动态效果时关掉', () => {
    expect(KT).toContain('(slideInHorizontally(tween(WenkuMotion.ENTER_MS, easing = WenkuMotion.ease)) { direction * it / 8 } +');
    expect(KT).toContain('if (reduceMotion) EnterTransition.None togetherWith ExitTransition.None');
    expect(DIALOG).toContain('zlib-login-mode--next');
    const css = readFileSync('src/styles/sources.css', 'utf8');
    expect(css).toContain('translateX(12.5%)');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});

describe('ZLibraryLoginDialog.kt L148-198 动作区', () => {
  it('四态动作文案', () => {
    expect(KT).toContain('siteVerification && loading -> tr("等待站点验证")');
    expect(KT).toContain('siteVerification -> tr("打开站点验证")');
    expect(KT).toContain('loading -> tr("登录中")');
    expect(KT).toContain('else -> tr("确认登录")');
    expect(loginActionLabel(true, true)).toBe('等待站点验证');
    expect(loginActionLabel(true, false)).toBe('打开站点验证');
    expect(loginActionLabel(false, true)).toBe('登录中');
    expect(loginActionLabel(false, false)).toBe('确认登录');
  });

  it('主按钮：selected、enabled = canSubmit、图标随形态切换', () => {
    expect(KT).toContain('wenkuSymbol = if (siteVerification) WenkuSymbol.Shield else WenkuSymbol.Check,');
    expect(DIALOG).toContain('selected');
    expect(DIALOG).toContain('enabled={canSubmit}');
    expect(DIALOG).toContain("symbol={siteVerification ? 'Shield' : 'Check'}");
  });

  it('注册按钮：文案裸字面量、enabled = !loading、compact、PersonAdd', () => {
    expect(KT).toContain('"没有账号？注册新账号",');
    expect(KT).toContain('compact = true, wenkuSymbol = WenkuSymbol.PersonAdd,');
    expect(DIALOG).toContain('text="没有账号？注册新账号"');
    expect(DIALOG).toContain('symbol="PersonAdd"');
    expect(REGISTER_FAILED_FALLBACK).toBe('注册失败');
    expect(KT).toContain('error = e.message ?: "注册失败"');
  });

  it('注册成功 → toast + 关闭；失败 → 内联 error', () => {
    expect(KT).toContain('AppToast.makeText(context, tr("注册成功，已自动登录"), Toast.LENGTH_SHORT).show()');
    expect(DIALOG).toContain("showToast(tr('注册成功，已自动登录'));");
  });

  it('去注册：裸字面量、External、失败 toast「无法打开注册页面」', () => {
    expect(KT).toContain('"没有账号？去注册",');
    expect(KT).toContain('runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }.onFailure {');
    expect(KT).toContain('AppToast.makeText(context, tr("无法打开注册页面"), Toast.LENGTH_SHORT).show()');
    expect(DIALOG).toContain('text="没有账号？去注册"');
    expect(DIALOG).toContain('symbol="External"');
    expect(DIALOG).toContain("() => showToast(tr('无法打开注册页面'))");
  });
});

describe('ZLibraryLoginDialog.kt L202-245 SourceCredentialFields', () => {
  it('两个 label 与 16dp 圆角 / 12dp 间距', () => {
    expect(KT).toContain('label = { Text(tr("邮箱 / 账号")) },');
    expect(KT).toContain('label = { Text(tr("密码")) },');
    expect(KT).toContain('shape = RoundedCornerShape(16.dp),');
    expect(KT).toContain('Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {');
    expect(SOURCE_CREDENTIAL_LABEL_USERNAME).toBe('邮箱 / 账号');
    expect(SOURCE_CREDENTIAL_LABEL_PASSWORD).toBe('密码');
    expect(SOURCE_CREDENTIAL_FIELD_RADIUS_DP).toBe(16);
    expect(SOURCE_CREDENTIAL_FIELD_GAP_DP).toBe(12);
  });

  it('`enabled` 透传到两个输入框（登录中禁用）', () => {
    expect(KT).toContain('            enabled = enabled,');
    expect(FIELDS).toContain('disabled={!props.enabled}');
    expect(DIALOG).toContain('enabled={!loading}');
  });

  it('密码可见性：PasswordVisualTransformation ↔ None，图标标签「隐藏密码 / 显示密码」', () => {
    expect(KT).toContain('visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),');
    expect(KT).toContain('if (passwordVisible) tr("隐藏密码") else tr("显示密码"),');
    expect(FIELDS).toContain("type={passwordVisible ? 'text' : 'password'}");
    expect(SOURCE_CREDENTIAL_HIDE_PASSWORD).toBe('隐藏密码');
    expect(SOURCE_CREDENTIAL_SHOW_PASSWORD).toBe('显示密码');
  });

  it('ImeAction.Done → 密码框 Enter 触发 onSubmit；Email 键盘 → type=email', () => {
    expect(KT).toContain('keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),');
    expect(KT).toContain('keyboardActions = KeyboardActions(onDone = { onSubmit() }),');
    expect(KT).toContain('keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),');
    expect(FIELDS).toContain("if (event.key !== 'Enter' || !props.enabled) return;");
    expect(FIELDS).toContain('props.onSubmit();');
    expect(FIELDS).toContain('type="email"');
    expect(FIELDS).toContain('inputMode="email"');
  });
});