/**
 * ZLibraryLoginDialog.tsx  ←  `ui/source/ZLibraryLoginDialog.kt`（245 行 / 203 非空）
 *
 * ⚠️ 本文件此前是按 **351 行的旧版** Kotlin 写的（旧版有 `hazeState` / `TabRow` /
 * `AppLiquidButton` / `supportsCookieLogin`）。当前 Kotlin 早已改成 `WenkuActionSheet` +
 * `SegmentedPillSelector` + `SourceCredentialFields`，并新增了「站点验证」形态
 * （`js_mycomic`）。本轮按原文整体重写（E193）。
 *
 * 逐段对照：
 *   L44-50    形参 `source / onDismiss / onSuccess / onRegister: (suspend () -> Unit)? = null`
 *   L51-52    `LocalContext` / `rememberCoroutineScope()` → 宿主注入
 *   L53-55    `rememberAsyncState<String?>(null, source) { value = withTimeoutOrNull(5_000) { source.getRegistrationUrl() } }`
 *             → `useEffect` + 5 s 计时器（`REGISTRATION_URL_TIMEOUT_MS`）
 *   L56       `val isJsSource = source.id.startsWith("js_")`
 *   L57       `val siteVerification = source.id == "js_mycomic"`
 *   L58-63    `loginMode` / `username` / `password` / `cookie` / `loading` / `error`
 *   L64       `title = if (siteVerification) "验证 ${source.name}" else "登录 ${source.name}"`
 *   L66       `WenkuActionSheet(title, onDismiss, fitKeyboard = !siteVerification)`
 *   L69-70    `canSubmit = !loading && (siteVerification || if (loginMode == 0) username.isNotBlank() && password.isNotBlank() else cookie.isNotBlank())`
 *   L71-101   `submit`：收键盘 → loading → 按 mode 造 `LoginCredential` → `source.login`
 *             → Success 弹「登录成功 / 验证成功」并 `closeAfterSuccess()`
 *             → Error 落 `error = result.exception.message ?: "登录失败"`（loading 复位）
 *             → `CancellationException` 原样抛，其余 `Exception` 同样落 `error`
 *   L103-110  `if (!isJsSource) SegmentedPillSelector(0 账号密码 / 1 粘贴 Cookie, fontSp = 14f)`
 *             —— 切模式时 `error = null`，loading 中不可切
 *   L111-116  `siteVerification` → 提示文案「在应用内完成站点验证后会自动返回，浏览凭据由应用保存。」
 *   L117-147  否则 `AnimatedContent(loginMode)`：0 → `SourceCredentialFields`；
 *             1 → Cookie 多行框（label「Cookie」、placeholder
 *             `remix_userid=…; remix_userkey=…`、`heightIn(min = 112.dp)`、`enabled = !loading`）
 *   L148-150  `error` 内联红字（`bodySmall`），**不是** toast
 *   L151      `if (loading) LinearProgressIndicator(fillMaxWidth)`
 *   L152-162  四态动作文案 + `WenkuTextButton(selected = true, enabled = canSubmit,
 *             wenkuSymbol = if (siteVerification) Shield else Check)`
 *   L164-186  `onRegister != null` → 「没有账号？注册新账号」（`enabled = !loading`、compact、PersonAdd）
 *   L187-198  `registrationUrl != null` → 「没有账号？去注册」（`enabled = !loading`、compact、External）
 *   L202-245  `SourceCredentialFields` → 独立文件 `./SourceCredentialFields.tsx`
 *
 * 逐字保留的**裸字面量**（Kotlin 这几处没包 `tr()`，英文界面也显示中文，照抄）：
 *   `"没有账号？注册新账号"`（L166）、`"没有账号？去注册"`（L189）、`"Cookie"` /
 *   `"remix_userid=…; remix_userkey=…"`（L139-140）、`"登录失败"`（L90/L97）、
 *   `"注册失败"`（L179）、`title`（L64）。
 * 包了 `tr()` 的：`账号密码` / `粘贴 Cookie` / `等待站点验证` / `打开站点验证` / `登录中` /
 *   `确认登录` / `登录成功` / `验证成功` / `注册成功，已自动登录` / `无法打开注册页面`。
 *
 * ADAPTATION：
 *   - `Intent(ACTION_VIEW, Uri.parse(url))` → `openExternalUrl` 端口（iOS
 *     `SFSafariViewController`；WKWebView 里 `_blank` 会被静默拦截）。
 *   - `AnimatedContent` 的横向滑入 + 淡入（`WenkuMotion.ENTER_MS` / `EXIT_MS`，`/8` 位移）
 *     → `.zlib-login-mode--next/--prev` 两个 CSS 关键帧；`LocalReduceMotion` →
 *     `prefers-reduced-motion` 关掉动画。
 *   - `LocalSoftwareKeyboardController.hide()` 在 Web 无对应（点按钮时浏览器自然收键盘）。
 */

import { useEffect, useState } from 'react';

import { tr } from '@core/i18n';
import { createLoginCredential } from '@core/source/loginCredential';
import type { LoginCredential } from '@core/source/loginCredential';
import { showToast } from '@ui/toast';
import { openExternalUrl } from '@ui/lib/openExternalUrl';
import { SegmentedPillSelector } from '@ui/components/SegmentedPillSelector';
import { WenkuActionSheet } from '@ui/components/wenku/WenkuActionSheet';
import { WenkuTextButton } from '@ui/components/wenku/WenkuGlass';

import { SourceCredentialFields } from './SourceCredentialFields';
import type { SourceResultLike } from './sourceCapabilities';

import '../../../styles/sources.css';

/** `com.example.source.BookSource` 子集：本对话框只用到这三个成员。 */
export interface LoginCapableSource {
  id: string;
  name: string;
  /** `SourceResult.Success` | `SourceResult.Error`。 */
  login(credential: LoginCredential): Promise<SourceResultLike<null>>;
  /** `source.getRegistrationUrl()` —— 可能很慢，Kotlin 用 5 s 超时包住。 */
  getRegistrationUrl(): Promise<string | null>;
}

/** L54 `withTimeoutOrNull(5_000)`。 */
export const REGISTRATION_URL_TIMEOUT_MS = 5000;

/** L58 `mutableIntStateOf(0)`。 */
export const LOGIN_MODE_PASSWORD = 0;
export const LOGIN_MODE_COOKIE = 1;

/** L113 站点验证提示（裸字面量，Kotlin 未包 `tr()`）。 */
export const SITE_VERIFICATION_HINT = '在应用内完成站点验证后会自动返回，浏览凭据由应用保存。';
/** L139 `label = { Text("Cookie") }`。 */
export const COOKIE_FIELD_LABEL = 'Cookie';
/** L140 `placeholder = { Text("remix_userid=…; remix_userkey=…") }`。 */
export const COOKIE_FIELD_PLACEHOLDER = 'remix_userid=…; remix_userkey=…';
/** L141 `heightIn(min = 112.dp)`。 */
export const COOKIE_FIELD_MIN_HEIGHT_DP = 112;
/** L119-131 `AnimatedContent` 的位移是宽度的 1/8。 */
export const LOGIN_MODE_SLIDE_FRACTION = 0.125;

/** L56 `source.id.startsWith("js_")`。 */
export function isJsSourceId(id: string): boolean {
  return id.startsWith('js_');
}

/**
 * L57 `val siteVerification = source.id in setOf("js_mycomic", "js_bilimanga", "xbookcn")`。
 *
 * 三者都是「没有账号体系、只需要过一次站点挑战」的源：mycomic 与 bilimanga 是站点验证页，
 * xbookcn 是 CF managed challenge（Kotlin L116-150 为它单开「内置验证 / 粘贴 Cookie」两段）。
 */
export function isSiteVerificationSource(id: string): boolean {
  return id === 'js_mycomic' || id === 'js_bilimanga' || id === 'xbookcn';
}

/** L64 `if (siteVerification) "验证 ${source.name}" else "登录 ${source.name}"`（裸字面量）。 */
export function loginDialogTitle(siteVerification: boolean, sourceName: string): string {
  return siteVerification ? `验证 ${sourceName}` : `登录 ${sourceName}`;
}

/** L105 `options = listOf(0 to tr("账号密码"), 1 to tr("粘贴 Cookie"))`。 */
export function loginModeOptions(): ReadonlyArray<{ readonly value: number; readonly label: string }> {
  return [
    { value: LOGIN_MODE_PASSWORD, label: tr('账号密码') },
    { value: LOGIN_MODE_COOKIE, label: tr('粘贴 Cookie') },
  ];
}

export interface LoginFormState {
  readonly loading: boolean;
  readonly siteVerification: boolean;
  readonly loginMode: number;
  readonly username: string;
  readonly password: string;
  readonly cookie: string;
  /** L69 `val xbookcnCookieMode = source.id == "xbookcn" && loginMode == 1`。 */
  readonly xbookcnCookieMode?: boolean;
}

/** L69-70 `canSubmit`。`isNotBlank` = 至少一个非空白字符。 */
export function canSubmitLogin(state: LoginFormState): boolean {
  if (state.loading) return false;
  // L70-75 的顺序：xbookcn 的「粘贴 Cookie」形态必须先要求 cookie 非空，
  // 否则它会同时命中下面的 siteVerification 分支，变成「空 cookie 也能提交」。
  if (state.xbookcnCookieMode === true) return state.cookie.trim() !== '';
  if (state.siteVerification) return true;
  if (state.loginMode === LOGIN_MODE_PASSWORD) {
    return state.username.trim() !== '' && state.password.trim() !== '';
  }
  return state.cookie.trim() !== '';
}

/**
 * L77-81 —— `siteVerification || loginMode == 1` 时只带 `cookie`，否则带账号密码。
 * 站点验证形态没有任何输入框，cookie 也可能是空串（服务端会话才是凭据）。
 */
export function loginCredentialFor(state: LoginFormState): LoginCredential {
  return state.siteVerification || state.loginMode === LOGIN_MODE_COOKIE
    ? createLoginCredential({ cookie: state.cookie })
    : createLoginCredential({ username: state.username, password: state.password });
}

/** L152-157 `val action = when { … }` 的四态。 */
export function loginActionLabel(siteVerification: boolean, loading: boolean): string {
  if (siteVerification) return loading ? tr('等待站点验证') : tr('打开站点验证');
  return loading ? tr('登录中') : tr('确认登录');
}

/** L85 `if (siteVerification) tr("验证成功") else tr("登录成功")`。 */
export function loginSuccessMessage(siteVerification: boolean): string {
  return siteVerification ? '验证成功' : '登录成功';
}

/** L90 / L97 的兜底文案（裸字面量）。 */
export const LOGIN_FAILED_FALLBACK = '登录失败';
/** L179 的兜底文案（裸字面量）。 */
export const REGISTER_FAILED_FALLBACK = '注册失败';

export function ZLibraryLoginDialog(props: {
  source: LoginCapableSource;
  onDismiss: () => void;
  onSuccess: () => void;
  /** 源支持站内注册时提供：登录窗口下方出现「没有账号？注册新账号」（L164-186）。 */
  onRegister?: (() => Promise<void>) | null;
}) {
  const { source } = props;

  // L53-55 `rememberAsyncState<String?>(null, source) { withTimeoutOrNull(5_000) { … } }`
  const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setRegistrationUrl(null);
    }, REGISTRATION_URL_TIMEOUT_MS);
    void source.getRegistrationUrl().then(
      (url) => {
        window.clearTimeout(timer);
        if (!cancelled) setRegistrationUrl(url);
      },
      () => {
        window.clearTimeout(timer);
        if (!cancelled) setRegistrationUrl(null);
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source]);

  // L56-57
  const isJsSource = isJsSourceId(source.id);
  const siteVerification = isSiteVerificationSource(source.id);
  // L58-63
  const [loginMode, setLoginMode] = useState(LOGIN_MODE_PASSWORD);
  const [modeDirection, setModeDirection] = useState(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cookie, setCookie] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state: LoginFormState = { loading, siteVerification, loginMode, username, password, cookie };
  const canSubmit = canSubmitLogin(state);
  const title = loginDialogTitle(siteVerification, source.name); // L64

  // L71-101
  const submit = (): void => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    void source.login(loginCredentialFor(state)).then(
      (result) => {
        if (result.kind === 'success') {
          showToast(tr(loginSuccessMessage(siteVerification)));
          props.onSuccess();
          props.onDismiss();
          return;
        }
        setLoading(false);
        setError(result.exception.message !== '' ? result.exception.message : LOGIN_FAILED_FALLBACK);
      },
      (reason: unknown) => {
        setLoading(false);
        setError(reason instanceof Error && reason.message !== '' ? reason.message : LOGIN_FAILED_FALLBACK);
      },
    );
  };

  // L164-186
  const register = (): void => {
    if (props.onRegister == null) return;
    setLoading(true);
    setError(null);
    void props.onRegister().then(
      () => {
        showToast(tr('注册成功，已自动登录'));
        props.onSuccess();
        props.onDismiss();
      },
      (reason: unknown) => {
        setLoading(false);
        setError(reason instanceof Error && reason.message !== '' ? reason.message : REGISTER_FAILED_FALLBACK);
      },
    );
  };

  // L187-198
  const openRegistration = (): void => {
    if (registrationUrl === null) return;
    void openExternalUrl(registrationUrl).then(
      () => {},
      () => showToast(tr('无法打开注册页面')),
    );
  };

  return (
        <WenkuActionSheet title={title} onDismiss={props.onDismiss} fitKeyboard={!siteVerification || source.id === 'xbookcn'}>
      {/* L103-110 */}
        {isJsSource || siteVerification ? null : (
        <SegmentedPillSelector
          options={loginModeOptions()}
          value={loginMode}
          onChange={(mode) => {
            if (loading) return;
            setModeDirection(mode > loginMode ? 1 : -1);
            setLoginMode(mode);
            setError(null);
          }}
        />
      )}

      {/* L111-147 */}
      {siteVerification ? (
        <p className="zlib-login-hint">{SITE_VERIFICATION_HINT}</p>
      ) : (
        <div
          key={loginMode}
          className={`zlib-login-mode ${modeDirection > 0 ? 'zlib-login-mode--next' : 'zlib-login-mode--prev'}`}
        >
          {loginMode === LOGIN_MODE_PASSWORD ? (
            <SourceCredentialFields
              username={username}
              onUsernameChange={setUsername}
              password={password}
              onPasswordChange={setPassword}
              enabled={!loading}
              onSubmit={submit}
            />
          ) : (
            <textarea
              className="zlib-login-cookie"
              aria-label={COOKIE_FIELD_LABEL}
              placeholder={COOKIE_FIELD_PLACEHOLDER}
              value={cookie}
              disabled={loading}
              style={{ minHeight: COOKIE_FIELD_MIN_HEIGHT_DP }}
              onChange={(event) => setCookie(event.currentTarget.value)}
            />
          )}
        </div>
      )}

      {/* L148-150 */}
      {error === null ? null : <p className="zlib-login-error">{error}</p>}

      {/* L151 */}
      {loading ? (
        <div className="zlib-login-progress">
          <span />
        </div>
      ) : null}

      {/* L158-162 + L164-186 + L187-198 */}
      <div className="zlib-login-actions">
        <WenkuTextButton
          text={loginActionLabel(siteVerification, loading)}
          onClick={submit}
          selected
          enabled={canSubmit}
          symbol={siteVerification ? 'Shield' : 'Check'}
        />
        {props.onRegister == null ? null : (
          <WenkuTextButton
            text="没有账号？注册新账号"
            onClick={register}
            enabled={!loading}
            compact
            symbol="PersonAdd"
          />
        )}
        {registrationUrl === null ? null : (
          <WenkuTextButton
            text="没有账号？去注册"
            onClick={openRegistration}
            enabled={!loading}
            compact
            symbol="External"
          />
        )}
      </div>
    </WenkuActionSheet>
  );
}

/** 旧导出保留（深色主题令牌文案与它同值）。 */
export const ON_SURFACE_VARIANT = '#61666D';