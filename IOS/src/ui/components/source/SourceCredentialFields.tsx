/**
 * SourceCredentialFields.tsx  ←  `ui/source/ZLibraryLoginDialog.kt` L202-245
 *
 * Kotlin 里这是一个 `internal @Composable fun SourceCredentialFields(...)`，被
 * `ZLibraryLoginDialog`（L134）与 `library/LibraryLoginDialog`（L44）两处调用：
 * 账号框（Email 键盘、ImeAction.Next）+ 密码框（Password 键盘、ImeAction.Done →
 * `onSubmit`、`trailingIcon` 眼睛 + `PasswordVisualTransformation`）。
 *
 * 逐行对照：
 *   L203-210  形参 `username / onUsernameChange / password / onPasswordChange / enabled / onSubmit`
 *   L211      `var passwordVisible by remember { mutableStateOf(false) }`
 *   L212      `Column(fillMaxWidth, spacedBy(12.dp))`
 *   L213-222  账号 `OutlinedTextField`：label「邮箱 / 账号」、singleLine、`enabled`、
 *             `RoundedCornerShape(16.dp)`、`KeyboardType.Email` + `ImeAction.Next`
 *   L223-243  密码 `OutlinedTextField`：label「密码」、singleLine、`enabled`、
 *             `visualTransformation`、`KeyboardType.Password` + `ImeAction.Done`、
 *             `KeyboardActions(onDone = { onSubmit() })`、trailing 眼睛图标
 *
 * ADAPTATION（Compose → Web）：
 * - `OutlinedTextField` 的浮动 label 画在描边内；Web 侧用「label 在上、input 在下」，
 *   语义（可点 label 聚焦、可被读屏念出）保持一致。
 * - `PasswordVisualTransformation` → `type="password" / "text"`；`trailingIcon`
 *   的 `AppIconButton` → 右侧 32px 圆形按钮，`aria-label` 与 Kotlin 的 `contentDescription`
 *   同文案（`隐藏密码` / `显示密码`）。
 * - `ImeAction.Done` → 密码框上的 Enter 键；`ImeAction.Next` 在 Web 无对应（Tab 即可）。
 */

import { useId, useState } from 'react';

import { tr } from '@core/i18n';

/** L216 `label = { Text(tr("邮箱 / 账号")) }`。 */
export const SOURCE_CREDENTIAL_LABEL_USERNAME = '邮箱 / 账号';
/** L226 `label = { Text(tr("密码")) }`。 */
export const SOURCE_CREDENTIAL_LABEL_PASSWORD = '密码';
/** L237 `if (passwordVisible) tr("隐藏密码") else tr("显示密码")`。 */
export const SOURCE_CREDENTIAL_HIDE_PASSWORD = '隐藏密码';
export const SOURCE_CREDENTIAL_SHOW_PASSWORD = '显示密码';
/** L220 / L231 `RoundedCornerShape(16.dp)`。 */
export const SOURCE_CREDENTIAL_FIELD_RADIUS_DP = 16;
/** L212 `Arrangement.spacedBy(12.dp)`。 */
export const SOURCE_CREDENTIAL_FIELD_GAP_DP = 12;

export interface SourceCredentialFieldsProps {
  readonly username: string;
  readonly onUsernameChange: (value: string) => void;
  readonly password: string;
  readonly onPasswordChange: (value: string) => void;
  /** L208 `enabled: Boolean` —— 登录/验证进行中时两个框都禁用。 */
  readonly enabled: boolean;
  /** L209 `onSubmit: () -> Unit` —— 密码框的 ImeAction.Done。 */
  readonly onSubmit: () => void;
}

export function SourceCredentialFields(props: SourceCredentialFieldsProps) {
  // L211
  const [passwordVisible, setPasswordVisible] = useState(false);
  const fieldId = useId();

  return (
    <div className="source-credential-fields">
      <div className="source-credential-field">
        <label className="source-credential-field__label" htmlFor={`${fieldId}-username`}>
          {tr(SOURCE_CREDENTIAL_LABEL_USERNAME)}
        </label>
        <input
          id={`${fieldId}-username`}
          className="source-credential-field__input"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={props.username}
          disabled={!props.enabled}
          onChange={(event) => props.onUsernameChange(event.currentTarget.value)}
        />
      </div>
      <div className="source-credential-field">
        <label className="source-credential-field__label" htmlFor={`${fieldId}-password`}>
          {tr(SOURCE_CREDENTIAL_LABEL_PASSWORD)}
        </label>
        <div className="source-credential-field__row">
          <input
            id={`${fieldId}-password`}
            className="source-credential-field__input"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            value={props.password}
            disabled={!props.enabled}
            onChange={(event) => props.onPasswordChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !props.enabled) return;
              event.preventDefault();
              props.onSubmit();
            }}
          />
          <button
            type="button"
            className="source-credential-field__reveal"
            aria-label={tr(passwordVisible ? SOURCE_CREDENTIAL_HIDE_PASSWORD : SOURCE_CREDENTIAL_SHOW_PASSWORD)}
            aria-pressed={passwordVisible}
            disabled={!props.enabled}
            onClick={() => setPasswordVisible(!passwordVisible)}
          >
            <span aria-hidden="true">{passwordVisible ? '◡' : '◉'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}