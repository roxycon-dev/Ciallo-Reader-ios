/**
 * Port of Android `ui/source/SourceInfoDialog.kt` (38 lines total / 36 non-blank / 35 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–12   package + imports → file header.
 *   13     the KDoc "Describe declared capabilities separately from current enablement
 *          or reachability." → preserved verbatim above the component.
 *   14–15  `@Composable internal fun SourceInfoDialog(source: BookSource, enabled: Boolean,
 *          onDismiss: () -> Unit)` + `val caps = source.capabilities` → same props.
 *   16     `AlertDialog(onDismissRequest = onDismiss, title = { Text(source.name) }, …)`
 *          → `.fav-dialog-scrim` + `.fav-dialog` (the AcrylicDialog/AlertDialog shell
 *          reused from `favorite.css`; this dialog is 2 KB, not worth a second shell).
 *   18     `title = { Text(source.name) }` → `.fav-dialog__title`.
 *   19–20  `text = { Column(Modifier.verticalScroll(rememberScrollState()),
 *          verticalArrangement = Arrangement.spacedBy(8.dp)) { … } }`
 *          → `.fav-dialog__row` inside the scrollable dialog body.
 *   21     `Text("来源 ID：${source.id}")` → verbatim.
 *   22     `Text("启用状态：${if (enabled) "已启用" else "已停用"}")` → verbatim.
 *   23–25  `if (source is JsComicSource) { Text("适配方式：Venera / JS 漫画源");
 *          Text("脚本版本：${source.version}") } else Text("适配方式：应用内漫画源")`
 *          → `adaptation` + `scriptVersion` props (the `instanceof` narrowing becomes
 *          two optional props; the *JS source* check itself lives in the page, which
 *          owns the BookSource union).
 *   26     `Text("站内搜索：${if (caps.supportSearch) "支持" else "不支持"}")` → verbatim.
 *   27     `Text("章节阅读：${if (caps.supportComic) "支持图片漫画" else "未声明"}")` → verbatim.
 *   28     `Text("章节下载：${if (caps.supportDownload) "支持" else "不支持"}")` → verbatim.
 *   29     `Text("搜索登录：${if (caps.searchRequiresLogin) "需要登录" else "适配器未要求登录"}")`
 *   30     `Text("阅读 / 下载登录：${if (caps.downloadRequiresLogin) "需要登录" else "适配器未要求登录"}")`
 *   31–33  the closing note, `bodySmall` + `onSurfaceVariant` → `.fav-dialog__note`.
 *   36     `confirmButton = { TextButton(onClick = onDismiss) { Text("知道啦") } }`
 *          → `.fav-btn` labelled 知道啦.
 *   37–38  closing braces.
 *
 * Skipped: nothing. Every user-visible string is verbatim, including the ⚠️-free
 * "未声明" wording that distinguishes "declared false" from "never declared".
 */

import type { SourceCapabilities } from '@core/source/sourceCapabilities';
import '../../../styles/favorite.css';

/** Describe declared capabilities separately from current enablement or reachability. */
export function SourceInfoDialog(props: {
  source: { id: string; name: string };
  capabilities: SourceCapabilities;
  enabled: boolean;
  /** Kotlin `source is JsComicSource` — the two adaptation lines. */
  isJsComicSource?: boolean;
  /** Kotlin `source.version` (JsComicSource only). */
  scriptVersion?: string;
  onDismiss: () => void;
}) {
  const caps = props.capabilities;
  return (
    <div className="fav-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="fav-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.source.name}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fav-dialog__title">{props.source.name}</h3>
        <div className="fav-dialog__row">
          <p style={{ margin: 0 }}>{`来源 ID：${props.source.id}`}</p>
          <p style={{ margin: 0 }}>{`启用状态：${props.enabled ? '已启用' : '已停用'}`}</p>
          {props.isJsComicSource === true ? (
            <>
              <p style={{ margin: 0 }}>适配方式：Venera / JS 漫画源</p>
              <p style={{ margin: 0 }}>{`脚本版本：${props.scriptVersion ?? ''}`}</p>
            </>
          ) : (
            <p style={{ margin: 0 }}>适配方式：应用内漫画源</p>
          )}
          <p style={{ margin: 0 }}>{`站内搜索：${caps.supportSearch ? '支持' : '不支持'}`}</p>
          <p style={{ margin: 0 }}>{`章节阅读：${caps.supportComic ? '支持图片漫画' : '未声明'}`}</p>
          <p style={{ margin: 0 }}>{`章节下载：${caps.supportDownload ? '支持' : '不支持'}`}</p>
          <p style={{ margin: 0 }}>
            {`搜索登录：${caps.searchRequiresLogin ? '需要登录' : '适配器未要求登录'}`}
          </p>
          <p style={{ margin: 0 }}>
            {`阅读 / 下载登录：${caps.downloadRequiresLogin ? '需要登录' : '适配器未要求登录'}`}
          </p>
          <p className="fav-dialog__note">
            作品资料以源站实际返回为准，缺失字段会留空。启用状态表示是否参与搜索；站点可用性以本次请求为准。
          </p>
        </div>
        <div className="fav-dialog__actions">
          <button type="button" className="fav-btn" onClick={props.onDismiss}>
            知道啦
          </button>
        </div>
      </div>
    </div>
  );
}
