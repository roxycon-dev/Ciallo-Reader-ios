/**
 * ComicPresetSheet.tsx — 预设管理面板。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt` 1393–1608）：
 *   - 1395–1403  `ComicPresetSheet(store, currentConfig, onApply, onDismiss)`
 *   - 1404–1412  `presets` / `defaultId` / `renameTarget` / `createDialog` 四份 state + `refresh()`
 *   - 1414–1417  `ComicSheetContainer(title = "阅读预设", heightFraction = 0.62f)`
 *   - 1418–1581  预设列表（收藏置顶）
 *   - 1420–1427  `presets.sortedByDescending { it.favorite }` + 卡片容器
 *   - 1430–1438  图标块（40dp，`0x2AF0D9C0` 底 + preset.emoji）
 *   - 1441–1470  名称行（FlowRow）：名称 + 收藏星 + 「默认」+「内置」标签
 *   - 1471–1474  副标题 `${mode.label} · ${direction.label} · ${pageAnim.label}`
 *   - 1477–1484  「应用」按钮（`0xFFF0D9C0` 底 / `0xFF0E1512` 字）
 *   - 1488–1560  操作行：收藏 / 设为默认 / 复制 / 重命名 / 删除
 *   - 1564–1580  「从当前设置新建预设」尾部项
 *   - 1584–1595  `createDialog` → `PresetNameDialog("新建预设")`
 *   - 1596–1607  `renameTarget` → `PresetNameDialog("重命名预设")`
 *
 * 适配与跳过：
 *   - `store` 抽象为 `PresetStore`（Android SharedPreferences 由宿主实现）。
 *   - L1420 `sortedByDescending` → `sortPresetsFavoritesFirst`（@core/comic，稳定排序）。
 *   - L1488 `FlowRow(horizontalArrangement = Arrangement.End)` → CSS flex-wrap 右对齐。
 *   - L1486–1487「Keep actions on their own wrapping row…」保留为独立操作行。
 *   - L1589 `store.createPreset(name.ifBlank{"我的预设"}, name.take(2).ifBlank{"SC"}, currentConfig)`
 *     → `presetNameOrFallback` / `presetEmojiFromName`（@core/comic）。
 *   - L1601 `store.updatePreset(target.id, name = name.ifBlank{target.name})`
 *     → `presetNameOrFallback(name, target.name)`。
 *   - L1537 `if (!preset.builtIn)` 才显示重命名/删除 → 同条件渲染。
 *   - L1451 `if (preset.id == defaultId)` 的「默认」徽标、L1461 `builtIn` 的「内置」徽标保留。
 */
import { useState } from 'react';
import {
  PRESET_DEFAULT_NAME,
  presetEmojiFromName,
  presetNameOrFallback,
  presetSubtitle,
  sortPresetsFavoritesFirst,
  type ComicSheetsConfig,
  type ComicSheetsPreset,
} from '@core/comic/comicReaderSheets';
import { ComicSheetOverlay } from './comicSheetParts';
import { ComicIcon } from './ComicIcon';
import { PresetNameDialog } from './PresetNameDialog';

export interface PresetStore {
  loadPresets(): ComicSheetsPreset[];
  defaultPresetId(): string;
  createPreset(name: string, emoji: string, config: ComicSheetsConfig): unknown;
  togglePresetFavorite(id: string): unknown;
  setDefaultPreset(id: string): void;
  duplicatePreset(id: string): unknown;
  updatePreset(id: string, name?: string, config?: ComicSheetsConfig): unknown;
  deletePreset(id: string): boolean;
}

export interface ComicPresetSheetProps {
  store: PresetStore;
  currentConfig: ComicSheetsConfig;
  onApply: (config: ComicSheetsConfig) => void;
  /** Kotlin `comicPanelGlass(backdrop, shape)`：宿主传 `panelGlassSamplingActive(...)` */
  glass?: boolean | undefined;
  onDismiss: () => void;
}

/* ── 单张预设卡（提取为组件，.map() 内无 Hook） ── */

function PresetCard(props: {
  preset: ComicSheetsPreset;
  /**
   * 默认预设的 **id**（不是布尔）——
   * Kotlin `ComicReaderSheets.kt` L1451 `if (preset.id == defaultId)`。
   */
  defaultId: string;
  onApply: () => void;
  onToggleFavorite: () => void;
  onSetDefault: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const p = props.preset;
  return (
    <div className={p.favorite ? 'cmcs-preset cmcs-preset--fav' : 'cmcs-preset'}>
      <div className="cmcs-preset__main">
        {/* L1430–1438 图标块 */}
        <span className="cmcs-preset__emoji-box" aria-hidden="true">
          <span className="cmcs-preset__emoji">{p.emoji}</span>
        </span>
        <span className="cmcs-preset__gap10" />
        <div className="cmcs-preset__text">
          {/* L1441–1470 名称行（FlowRow） */}
          <div className="cmcs-preset__namerow">
            <span className="cmcs-preset__name">{p.name}</span>
            {p.favorite ? (
              <>
                <span className="cmcs-preset__gap6" />
                {/* 收藏标记（区别于"默认预设"）：实心星 + 强调色 */}
                <span className="cmcs-preset__star" aria-label="已收藏">
                  <ComicIcon name="Star" size={13} />
                </span>
              </>
            ) : null}
            {p.id === props.defaultId ? (
              <>
                <span className="cmcs-preset__gap6" />
                <span className="cmcs-preset__badge">默认</span>
              </>
            ) : null}
            {p.builtIn ? (
              <>
                <span className="cmcs-preset__gap6" />
                <span className="cmcs-preset__badge cmcs-preset__badge--muted">内置</span>
              </>
            ) : null}
          </div>
          {/* L1471–1474 副标题 */}
          <span className="cmcs-preset__subtitle">{presetSubtitle(p.config)}</span>
        </div>
        {/* L1477–1484 应用 */}
        <button type="button" className="cmcs-preset__apply" onClick={props.onApply}>
          应用
        </button>
      </div>
      {/* L1486–1560 操作行（独立换行行，保证名称在小屏/大字号下仍有宽度） */}
      <div className="cmcs-preset__actions">
        {/* 收藏开关（第 27 条：收藏后置顶 + 长按设置入口快捷应用） */}
        <button
          type="button"
          className="cmcs-preset__act"
          aria-label={p.favorite ? '取消收藏' : '收藏'}
          onClick={props.onToggleFavorite}
        >
          <ComicIcon name={p.favorite ? 'Star' : 'StarBorder'} size={16} />
        </button>
        {/* 设为默认 */}
        <button
          type="button"
          className="cmcs-preset__act"
          aria-label="设为默认"
          onClick={props.onSetDefault}
        >
          <ComicIcon name="PushPin" size={16} />
        </button>
        <button
          type="button"
          className="cmcs-preset__act"
          aria-label="复制"
          onClick={props.onDuplicate}
        >
          <ComicIcon name="ContentCopy" size={15} />
        </button>
        {p.builtIn ? null : (
          <>
            <button
              type="button"
              className="cmcs-preset__act"
              aria-label="重命名"
              onClick={props.onRename}
            >
              <ComicIcon name="DriveFileRenameOutline" size={15} />
            </button>
            <button
              type="button"
              className="cmcs-preset__act cmcs-preset__act--danger"
              aria-label="删除"
              onClick={props.onDelete}
            >
              <ComicIcon name="Delete" size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ComicPresetSheet(props: ComicPresetSheetProps) {
  const { store } = props;
  const [presets, setPresets] = useState<ComicSheetsPreset[]>(() => store.loadPresets());
  const [defaultId, setDefaultId] = useState(() => store.defaultPresetId());
  const [renameTarget, setRenameTarget] = useState<ComicSheetsPreset | null>(null);
  const [createDialog, setCreateDialog] = useState(false);

  // Kotlin 1409–1412 refresh()
  const refresh = () => {
    setPresets(store.loadPresets());
    setDefaultId(store.defaultPresetId());
  };

  return (
    <>
      <ComicSheetOverlay
        onDismiss={props.onDismiss}
        ariaLabel="阅读预设"
        className="cmcs-sheet--preset"
        glass={props.glass}
      >
        <div className="cmcs-sheet__title">阅读预设</div>
        <div className="cmcs-sheet__body">
          {/* 收藏置顶（第 27 条）：列表按 favorite 降序稳定排序，收藏组永远在最前 */}
          {sortPresetsFavoritesFirst(presets).map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              defaultId={defaultId}
              onApply={() => props.onApply(preset.config)}
              onToggleFavorite={() => {
                store.togglePresetFavorite(preset.id);
                refresh();
              }}
              onSetDefault={() => {
                store.setDefaultPreset(preset.id);
                refresh();
              }}
              onDuplicate={() => {
                store.duplicatePreset(preset.id);
                refresh();
              }}
              onRename={() => setRenameTarget(preset)}
              onDelete={() => {
                store.deletePreset(preset.id);
                refresh();
              }}
            />
          ))}
          <div className="cmcs-card__gap6" />
          {/* L1564–1580 尾部：新建预设 */}
          <button type="button" className="cmcs-preset-create" onClick={() => setCreateDialog(true)}>
            <span className="cmcs-preset-create__icon" aria-hidden="true">
              <ComicIcon name="Add" size={17} />
            </span>
            <span className="cmcs-preset-create__gap6" />
            <span className="cmcs-preset-create__label">从当前设置新建预设</span>
          </button>
          <div className="cmcs-sheet__gap12" />
        </div>
      </ComicSheetOverlay>

      {/* L1584–1595 新建预设 */}
      {createDialog ? (
        <PresetNameDialog
          title="新建预设"
          initial=""
          onConfirm={(name) => {
            store.createPreset(
              presetNameOrFallback(name, PRESET_DEFAULT_NAME),
              presetEmojiFromName(name),
              props.currentConfig,
            );
            refresh();
            setCreateDialog(false);
          }}
          onDismiss={() => setCreateDialog(false)}
        />
      ) : null}

      {/* L1596–1607 重命名预设 */}
      {renameTarget !== null ? (
        <PresetNameDialog
          title="重命名预设"
          initial={renameTarget.name}
          onConfirm={(name) => {
            store.updatePreset(renameTarget.id, presetNameOrFallback(name, renameTarget.name));
            refresh();
            setRenameTarget(null);
          }}
          onDismiss={() => setRenameTarget(null)}
        />
      ) : null}
    </>
  );
}
