/**
 * PresetNameDialog.tsx — 预设命名对话框。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt` 1611–1641）：
 *   - 1611–1617 `PresetNameDialog(title, initial, onConfirm, onDismiss)`
 *   - 1618      `var name by remember { mutableStateOf(initial) }`
 *   - 1620      `AlertDialog(onDismissRequest = onDismiss, …)`
 *   - 1621      `title = { Text(title, color = TextPrimary) }`
 *   - 1622–1636 `text = { OutlinedTextField(singleLine = true, placeholder = "预设名称") }`
 *   - 1637      `confirmButton = { TextButton { onConfirm(name) } Text("确定") }`
 *   - 1638      `dismissButton = { TextButton(onDismiss) Text("取消") }`
 *   - 1639      `containerColor = Color(0xFF232327)`
 *
 * 适配：
 *   - Compose `AlertDialog` → 居中遮罩 overlay（Adaptation #2），
 *     容器色保持暗色 `0xFF232327`，聚焦边框/光标为薄荷绿。
 *   - L1625 `name = it.take(12)` → `clampPresetName`（`@core/comic`，12 字符上限）。
 *   - L1631–1633 `focusedBorderColor = MintPrimary` / `unfocusedBorderColor = 0x33FFFFFF` /
 *     `cursorColor = MintPrimary` → CSS `:focus` 边框 + `caret-color`。
 *   - L1274 遮罩点击（`onDismissRequest` 的等价）：点击 backdrop 关闭。
 */
import { useState } from 'react';
import { clampPresetName } from '@core/comic/comicReaderSheets';

export function PresetNameDialog(props: {
  title: string;
  initial: string;
  onConfirm: (name: string) => void;
  onDismiss: () => void;
}) {
  // Kotlin 1618：初始值来自 props，之后本地自持
  const [name, setName] = useState(props.initial);

  return (
    <div className="cmcs-dialog-overlay" onClick={props.onDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="cmcs-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="cmcs-dialog__title">{props.title}</h2>
        <div className="cmcs-dialog__body">
          <input
            type="text"
            className="cmcs-dialog__field"
            value={name}
            autoFocus
            placeholder="预设名称"
            aria-label="预设名称"
            onChange={(e) => setName(clampPresetName(e.currentTarget.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                props.onConfirm(name);
              }
            }}
          />
        </div>
        <div className="cmcs-dialog__actions">
          <button type="button" className="cmcs-dialog__btn" onClick={props.onDismiss}>
            取消
          </button>
          <button type="button" className="cmcs-dialog__btn cmcs-dialog__btn--primary" onClick={() => props.onConfirm(name)}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
