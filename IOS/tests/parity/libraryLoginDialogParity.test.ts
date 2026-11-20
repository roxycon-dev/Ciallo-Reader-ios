/**
 * libraryLoginDialogParity.test.ts —— `library/LibraryLoginDialog.kt`（71 行）
 *                                  + `ui/source/ZLibraryLoginDialog.kt` L202-245 `SourceCredentialFields`。
 *
 * 端口在 `src/ui/pages/LibraryPage.tsx` 的 `LibraryLoginDialog`。本轮补四处真漂移：
 *   1. 注册地址写死 `https://z-library.sk/registration`，Kotlin 读 `ZLibraryNodeConfig.domain`；
 *   2. 加载中两个输入框没有禁用（Kotlin `SourceCredentialFields(..., enabled = !loading)`）；
 *   3. 注册按钮没有 `enabled = !loading`；
 *   4. 密码框缺「显示/隐藏密码」那个 trailing icon（`passwordVisible` 状态）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const KOTLIN = kt('library/LibraryLoginDialog.kt');
const FIELDS = kt('ui/source/ZLibraryLoginDialog.kt');
const PAGE = readFileSync('src/ui/pages/LibraryPage.tsx', 'utf8');

describe('LibraryLoginDialog.kt L23-71 登录面板', () => {
  it('标题 / 可关闭 / 键盘适配', () => {
    expect(KOTLIN).toContain('WenkuActionSheet(tr("登录 Z-Library"), onDismiss, dismissEnabled = !loading, fitKeyboard = true)');
    expect(PAGE).toContain("tr('登录 Z-Library')");
    // dismissEnabled = !loading → 背景点击与关闭按钮都要过同一道闸
    expect(PAGE).toContain('onClick={() => { if (!props.loading) props.onDismiss(); }}');
    expect(PAGE).toContain("aria-label={tr('关闭')}");
  });

  it('canSubmit = !loading && email.isNotBlank() && password.isNotBlank()', () => {
    expect(KOTLIN).toContain('val canSubmit = !loading && email.isNotBlank() && password.isNotBlank()');
    expect(PAGE).toContain("disabled={props.loading || email.trim() === '' || password.trim() === ''}");
    expect(PAGE).toContain("if (!props.loading && email.trim() !== '' && password.trim() !== '')");
  });

  it('提交前先收键盘，且只有 canSubmit 时才回调 onLogin(email, password)', () => {
    expect(KOTLIN).toContain('keyboard?.hide()');
    expect(KOTLIN).toContain('onLogin(email, password, closeAfterSuccess)');
    expect(PAGE).toContain('props.onLogin(email, password);');
  });

  it('message 非空白才显示；loading 时显示进度条与「登录中」', () => {
    expect(KOTLIN).toContain('if (message.isNotBlank()) {');
    expect(KOTLIN).toContain('if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())');
    expect(KOTLIN).toContain('if (loading) tr("登录中") else tr("确认登录")');
    expect(PAGE).toContain("props.message.trim() !== ''");
    expect(PAGE).toContain('props.loading ? (');
    expect(PAGE).toContain("props.loading ? tr('登录中') : tr('确认登录')");
  });

  it('注册：地址来自 ZLibraryNodeConfig.domain，失败 toast「无法打开注册页面」', () => {
    expect(KOTLIN).toContain('val url = "https://${ZLibraryNodeConfig.domain}/registration"');
    expect(KOTLIN).toContain('onFailure {');
    expect(KOTLIN).toContain('tr("无法打开注册页面")');
    expect(PAGE).toContain('return `https://${nodeDomain()}/registration`;');
    expect(PAGE).toContain("showToast(tr('无法打开注册页面'))");
    // 换节点后必须跟着走：不能再出现写死的 z-library.sk
    expect(PAGE).not.toContain("'https://z-library.sk/registration'");
  });

  it('注册按钮 enabled = !loading；两个按钮都 proven 全宽', () => {
    expect(KOTLIN).toContain('enabled = !loading,');
    const register = PAGE.slice(PAGE.indexOf('className="lib-login__register"'));
    expect(register.slice(0, 120)).toContain('disabled={props.loading}');
  });
});

/**
 * `LibraryLoginDialog.kt` L44 与 `ZLibraryLoginDialog.kt` L134 调的是**同一个**
 * `SourceCredentialFields`。端口此前在两处各写了一遍（标签、禁用态、眼睛按钮都是两份），
 * 现在 `LibraryPage` 改为复用 `@ui/components/source/SourceCredentialFields`，
 * 因此下面这几条断言落在组件上，`LibraryPage` 只负责传 `enabled` / `onSubmit`。
 */
const COMPONENT = readFileSync('src/ui/components/source/SourceCredentialFields.tsx', 'utf8');

describe('ZLibraryLoginDialog.kt L202-245 SourceCredentialFields', () => {
  it('两个字段的标签、Email/Password 键盘类型与 IME 动作', () => {
    expect(FIELDS).toContain('label = { Text(tr("邮箱 / 账号")) }');
    expect(FIELDS).toContain('label = { Text(tr("密码")) }');
    expect(FIELDS).toContain('keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next)');
    expect(FIELDS).toContain('keyboardActions = KeyboardActions(onDone = { onSubmit() })');
    expect(COMPONENT).toContain("tr(SOURCE_CREDENTIAL_LABEL_USERNAME)");
    expect(COMPONENT).toContain("tr(SOURCE_CREDENTIAL_LABEL_PASSWORD)");
    expect(COMPONENT).toContain('type="email"');
    expect(COMPONENT).toContain('inputMode="email"');
    expect(COMPONENT).toContain("autoComplete=\"username\"");
    expect(COMPONENT).toContain("autoComplete=\"current-password\"");
  });

  it('enabled = !loading 传进两个输入框', () => {
    expect(FIELDS).toContain('enabled = enabled,');
    // 组件里三处（账号框 / 密码框 / 眼睛按钮）都以 `!props.enabled` 取反
    expect(COMPONENT.split('disabled={!props.enabled}')).toHaveLength(4);
    // 两处调用点都传 `!loading`
    expect(PAGE).toContain('enabled={!props.loading}');
    expect(readFileSync('src/ui/components/source/ZLibraryLoginDialog.tsx', 'utf8')).toContain('enabled={!loading}');
  });

  it('密码可见性开关：VisualTransformation.None ↔ PasswordVisualTransformation', () => {
    expect(FIELDS).toContain('visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation()');
    expect(FIELDS).toContain('if (passwordVisible) tr("隐藏密码") else tr("显示密码")');
    expect(COMPONENT).toContain("type={passwordVisible ? 'text' : 'password'}");
    expect(COMPONENT).toContain('tr(passwordVisible ? SOURCE_CREDENTIAL_HIDE_PASSWORD : SOURCE_CREDENTIAL_SHOW_PASSWORD)');
    expect(COMPONENT).toContain('const [passwordVisible, setPasswordVisible] = useState(false);');
  });

  it('两处调用点共用同一份实现（面板里不再各写一遍输入框）', () => {
    expect(PAGE).toContain("import { SourceCredentialFields } from '@ui/components/source/SourceCredentialFields';");
    expect(PAGE).toContain('<SourceCredentialFields');
    // 负断言：面板不再自己画 label / 眼睛按钮
    expect(PAGE).not.toContain('lib-login__field');
    expect(PAGE).not.toContain('lib-login__reveal');
    expect(PAGE).not.toContain('passwordVisible');
  });
});