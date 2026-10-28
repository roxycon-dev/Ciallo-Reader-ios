/**
 * Port of Android `ui/source/ZLibraryLoginDialog.kt` (351 lines total / 333 non-blank / 332 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–57   package + imports → file header. The file has a long run of duplicated
 *          `import com.example.ui.components.AppIconButton` (9×, L40/41/44/45/48/49/51/53)
 *          — duplicated imports are not reproduced (they carry no behaviour).
 *   58–67  `@Composable fun ZLibraryLoginDialog(source, onDismiss, onSuccess, hazeState,
 *          onRegister)` → same props; `hazeState` is dropped (Android-only blur source).
 *   68–71  `LocalContext`, `LocalContext as Activity`, `blurPx = 18.dp.toPx()`,
 *          `rememberCoroutineScope()` → the injected `hazeState` / no-ops.
 *   72–74  `produceState<String?>(null, source) { value = withTimeoutOrNull(5_000) {
 *          source.getRegistrationUrl() } }` → `useEffect` + a 5 s race, storing the URL.
 *   75–76  `isJsSource = source.id.startsWith("js_")`;
 *          `supportsCookieLogin = !isJsSource || source.id == "js_mycomic"`
 *   77–82  `loginModeTab` (0: 账号密码, 1: Cookie; defaults to 1 for `js_mycomic`),
 *          `username`, `password`, `cookieString`, `isLoading` → same five `useState`s.
 *   83–88  `Dialog(onDismissRequest, properties = DialogProperties(
 *          usePlatformDefaultWidth = false, decorFitsSystemWindows = false))`
 *          → `.fav-dialog-scrim` + a full-bleed `.zlib-login-panel`.
 *   90–92  `DialogLiquidGlass { GlassDialogWindowEffect(activity, blurRadiusPx) }` → CSS
 *          `backdrop-filter` + a `.zlib-login-panel` glass surface.
 *   92–107 the appear spring (`0.85 → 1`, `spring(MediumBouncy, StiffnessLow)`) + fade
 *          (`tween(220)`) → `.zlib-login-panel` keyframes.
 *  109–118 the outer full-size click-to-dismiss `Box` → the scrim `onClick`.
 *  119–149 the panel modifier chain — `fillMaxWidth(0.9f)`, `widthIn(max = AdaptiveSpec.dialogMaxWidth)`,
 *          `graphicsLayer { scaleX/Y = panelScale, alpha = panelAlpha }`,
 *          `liquidGlass(blurRadius = 22.dp, refraction = false)`, `clip(cardShape)`,
 *          `filmGrain(alpha = 0.04f)`, `iridescentBorder(width = 2.dp, alpha = 0.22f)`
 *          → CSS (grain + iridescent border approximated; documented on the class).
 *  151–180 the header `Row`: the 40×12-radius `secondary@0.15` lock tile, the title
 *          `if (isJsSource) "登录 ${source.name}" else "登录 Z-Library"` at 20.sp Bold,
 *          a `Spacer(weight 1f)`, and the `AppIconButton(Close, "关闭")`.
 *  182     `Spacer(24.dp)`.
 *  184–201 the `TabRow` — shown when `supportsCookieLogin && source.id != "js_mycomic"`;
 *          tab 0 = 账号密码, tab 1 = `if (source.id == "js_mycomic") "cf_clearance" else "粘贴 Cookie"`,
 *          14.sp, Bold when selected. → a CSS two-tab row.
 *  203     `Spacer(20.dp)`.
 *  205–211 the `OutlinedTextFieldDefaults.colors(secondary, outline@0.3, …)`
 *          → `.zlib-login-field` CSS.
 *  213–235 mode 0: the 账号 field (label "邮箱 / 账号", leading `AccountCircle`, singleLine,
 *          `RoundedCornerShape(16.dp)`) + the 密码 field (label "密码", leading `Key`,
 *          `PasswordVisualTransformation`, singleLine).
 *  236–248 mode 1: the cookie `OutlinedTextField` (label
 *          `if (source.id == "js_mycomic") "cf_clearance 的值" else "Cookie (包含 remix_userkey)"`,
 *          placeholder `if (source.id == "js_mycomic") "从浏览器复制 cf_clearance 的值"
 *          else "remix_userid=...; remix_userkey=..."`, `height(130.dp)`).
 *  250–257 `if (isLoading)` → a 4.dp `LinearProgressIndicator` r2, secondary on secondary@0.2.
 *  259     `Spacer(24.dp)`.
 *  261–291 `AppLiquidButton(text = if (isLoading) "登录中" else "确认登录", enabled = !isLoading)`;
 *          on click builds a `LoginCredential(username, password)` **or**
 *          `LoginCredential(cookie = cookieString)`, calls `source.login(credential)` and
 *          on `Success` → toast "登录成功" + `onSuccess()` + `onDismiss()`;
 *          on `Error` → toast `result.exception.message ?: "登录失败"`.
 *  293     `Spacer(10.dp)`.
 *  295–321 the register `TextButton` (when `onRegister != null`): text
 *          "没有账号？注册新账号", runs `onRegister()`, success → toast
 *          "注册成功，已自动登录" + onSuccess + onDismiss, failure → toast
 *          `it.message ?: "注册失败"`.
 *  323–344 the `registrationUrl?.let` `TextButton`: text "没有账号？去注册", opens the URL
 *          through `Intent(ACTION_VIEW)`; failure → toast "无法打开注册页面".
 *  345–350 closing braces.
 *
 * ADAPTATIONS (all documented at their call site):
 *   - `WebView`/`Intent` → `externalBrowser` 端口（iOS `SFSafariViewController`、
 *     浏览器 `window.open`）for the registration link. The **source
 *     login WebView** (`CfWebViewSolver`) is NOT implemented here: it lives in
 *     `com.example.source.zlibrary.network`, outside Module D. `source.login` is
 *     therefore an injected capability (`LoginCapableSource`), declared not implemented.
 *   - `produceState` + `withTimeoutOrNull` → `Promise.race` with a 5 s timer.
 */

import { useEffect, useState } from 'react';
import { AppButton } from '@ui/components/AppButton';
import { showToast } from '@ui/toast';
import { openExternalUrl } from '@ui/lib/openExternalUrl';
import { createLoginCredential, type LoginCredential } from '@core/source/loginCredential';
import type { SourceResultLike } from './sourceCapabilities';
import '../../../styles/sources.css';
import '../../../styles/favorite.css';

/** `com.example.source.BookSource` subset this dialog needs (Android `source.login`). */
export interface LoginCapableSource {
  id: string;
  name: string;
  /** `SourceResult.Success` | `SourceResult.Error`. */
  login(credential: LoginCredential): Promise<SourceResultLike<null>>;
  /** `source.getRegistrationUrl()` — may resolve slowly; raced against 5 s. */
  getRegistrationUrl(): Promise<string | null>;
}

const SECONDARY = '#10B981';
const ON_SURFACE = '#18191C';
const ON_SURFACE_VARIANT = '#61666D';

/** Kotlin L72–74 — `withTimeoutOrNull(5_000)`. */
const REGISTRATION_URL_TIMEOUT_MS = 5000;

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function IconAccount() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12.65 10A6 6 0 0012 4a6 6 0 00-5.93 7.51L2 15.58V22h6.42l1.09-1.09V19H13a6 6 0 00-.35-9zm2.2 4.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  );
}

export function ZLibraryLoginDialog(props: {
  source: LoginCapableSource;
  onDismiss: () => void;
  onSuccess: () => void;
  /** 源支持站内注册时提供（如 vomic）：登录窗口下方出现「注册新账号」入口 */
  onRegister?: (() => Promise<void>) | null;
}) {
  const { source } = props;
  // L72–74: `produceState<String?>(null, source) { … withTimeoutOrNull(5_000) … }`
  const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setRegistrationUrl(null);
    }, REGISTRATION_URL_TIMEOUT_MS);
    void source
      .getRegistrationUrl()
      .then((url) => {
        window.clearTimeout(timer);
        if (!cancelled) setRegistrationUrl(url);
      })
      .catch(() => {
        window.clearTimeout(timer);
        if (!cancelled) setRegistrationUrl(null);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source]);

  // L75–76
  const isJsSource = source.id.startsWith('js_');
  const supportsCookieLogin = !isJsSource || source.id === 'js_mycomic';
  // L77 — `remember(source.id) { mutableStateOf(if (source.id == "js_mycomic") 1 else 0) }`
  const [loginModeTab, setLoginModeTab] = useState(source.id === 'js_mycomic' ? 1 : 0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cookieString, setCookieString] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const submit = (): void => {
    if (isLoading) return;
    setIsLoading(true);
    // Kotlin `LoginCredential`'s four fields all carry defaults (username = "", password = "",
    // cookie = null, extraData = emptyMap()), so each tab supplies only its own pair.
    const credential: LoginCredential =
      loginModeTab === 0
        ? createLoginCredential({ username, password })
        : createLoginCredential({ cookie: cookieString });
    void source
      .login(credential)
      .then((result) => {
        setIsLoading(false);
        if (result.kind === 'success') {
          showToast('登录成功');
          props.onSuccess();
          props.onDismiss();
        } else {
          showToast(result.exception.message || '登录失败');
        }
      })
      .catch(() => {
        setIsLoading(false);
        showToast('登录失败');
      });
  };

  const cookieLabel = source.id === 'js_mycomic' ? 'cf_clearance 的值' : 'Cookie (包含 remix_userkey)';
  const cookiePlaceholder =
    source.id === 'js_mycomic'
      ? '从浏览器复制 cf_clearance 的值'
      : 'remix_userid=...; remix_userkey=...';

  return (
    <div
      className="fav-dialog-scrim zlib-login-scrim"
      role="presentation"
      onClick={props.onDismiss}
    >
      <div
        className="zlib-login-panel"
        role="dialog"
        aria-modal="true"
        aria-label={isJsSource ? `登录 ${source.name}` : '登录 Z-Library'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="zlib-login-panel__head">
          <span className="zlib-login-panel__tile" style={{ color: SECONDARY }}>
            <IconLock />
          </span>
          <h3 className="zlib-login-panel__title">
            {isJsSource ? `登录 ${source.name}` : '登录 Z-Library'}
          </h3>
          <button
            type="button"
            className="zlib-login-panel__close"
            aria-label="关闭"
            onClick={props.onDismiss}
          >
            <IconClose />
          </button>
        </div>

        <div style={{ height: 24 }} />

        {/* L184–201: the 账号密码 / Cookie tab row */}
        {supportsCookieLogin && source.id !== 'js_mycomic' ? (
          <div className="zlib-login-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={loginModeTab === 0}
              className={
                loginModeTab === 0
                  ? 'zlib-login-tabs__tab zlib-login-tabs__tab--on'
                  : 'zlib-login-tabs__tab'
              }
              onClick={() => setLoginModeTab(0)}
            >
              账号密码
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginModeTab === 1}
              className={
                loginModeTab === 1
                  ? 'zlib-login-tabs__tab zlib-login-tabs__tab--on'
                  : 'zlib-login-tabs__tab'
              }
              onClick={() => setLoginModeTab(1)}
            >
              {source.id === 'js_mycomic' ? 'cf_clearance' : '粘贴 Cookie'}
            </button>
          </div>
        ) : null}

        <div style={{ height: 20 }} />

        {loginModeTab === 0 ? (
          <>
            <label className="zlib-login-field">
              <span className="zlib-login-field__icon" style={{ color: SECONDARY }}>
                <IconAccount />
              </span>
              <input
                className="zlib-login-field__input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="邮箱 / 账号"
                aria-label="邮箱 / 账号"
                autoComplete="username"
              />
            </label>
            <div style={{ height: 16 }} />
            <label className="zlib-login-field">
              <span className="zlib-login-field__icon" style={{ color: SECONDARY }}>
                <IconKey />
              </span>
              <input
                className="zlib-login-field__input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
                aria-label="密码"
                autoComplete="current-password"
              />
            </label>
          </>
        ) : (
          <textarea
            className="zlib-login-field zlib-login-field--area"
            value={cookieString}
            onChange={(event) => setCookieString(event.target.value)}
            placeholder={cookiePlaceholder}
            aria-label={cookieLabel}
            style={{ color: ON_SURFACE, height: 130 }}
          />
        )}

        {isLoading ? (
          <>
            <div style={{ height: 20 }} />
            <div className="zlib-login-progress" style={{ background: `${SECONDARY}33` }}>
              <span style={{ background: SECONDARY }} />
            </div>
          </>
        ) : null}

        <div style={{ height: 24 }} />

        <AppButton
          fullWidth
          variant="primary"
          disabled={isLoading}
          onClick={submit}
        >
          {isLoading ? '登录中' : '确认登录'}
        </AppButton>

        <div style={{ height: 10 }} />

        {props.onRegister != null ? (
          <button
            type="button"
            className="zlib-login-link"
            disabled={isLoading}
            onClick={() => {
              setIsLoading(true);
              void props
                .onRegister?.()
                .then(() => {
                  showToast('注册成功，已自动登录');
                  props.onSuccess();
                  props.onDismiss();
                })
                .catch((e: unknown) => {
                  showToast(e instanceof Error && e.message !== '' ? e.message : '注册失败');
                })
                .finally(() => setIsLoading(false));
            }}
          >
            没有账号？注册新账号
          </button>
        ) : null}

        {registrationUrl != null ? (
          <button
            type="button"
            className="zlib-login-link"
            disabled={isLoading}
            onClick={() => {
              // Kotlin L328 `context.startActivity(Intent(ACTION_VIEW, Uri.parse(url)))`
              // + toast「无法打开注册页面」（L323-344 的失败分支）。
              // ⚠️ 原先是裸 `window.open(...)`，在 WKWebView 里被`_blank`
              // 导航拦截后**既不报错也不打开**（用户点了没反应）。改走
              // `externalBrowser` 端口：iOS = `SFSafariViewController`。
              void openExternalUrl(registrationUrl).then(
                () => {},
                () => showToast('无法打开注册页面'),
              );
            }}
          >
            没有账号？去注册
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { ON_SURFACE_VARIANT };
