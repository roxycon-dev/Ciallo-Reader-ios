/**
 * ComicSettingsTranslationTab.tsx — 设置面板 Tab 3「翻译」。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt` 282–503）：
 *   - 282–330  TranslationTab 头部：模型就绪/下载进度/下载错误/缓存字节 + LLM 配置
 *   - 295–313  startDownload + `LaunchedEffect(config.translationEnabled)` 自动补齐
 *   - 321–330  engineSubPage 二级导航 + saveLlm（Toast 失败提示）
 *   - 332–351  二级页「自定义 AI 接口」
 *   - 352–366  二级页「在线翻译」
 *   - 367–411  一级页「翻译引擎（点击选择）」+「功能」
 *   - 413–468  「离线模型」（就绪 / 下载中 / 待下载 / 失败重试）
 *   - 470–478  「译文显示」
 *   - 480–502  「译文缓存」
 *
 * 适配与跳过：
 *   - L287 `LocalContext`、L299 `scope.launch`、L300 `TranslateModelManager.ensureDownloaded`、
 *     L292 `TranslationCache.totalBytes`、L492 `TranslationCache.clear`、
 *     L315–319/326–330 `LlmBubbleTranslator`（Android SharedPreferences + Toast）：
 *     全部通过 `TranslationBridge` props 注入（平台层由调用方实现），本文件无副作用依赖。
 *   - L324 `BackHandler(enabled = engineSubPage != null)`：改为可选的
 *     `onSubPageBack` 回调（宿主把 Escape / 返回键接上去），默认 no-op。
 *   - L369–394 `EngineCard` / L334–351 `PanelSectionCard` → `comicSheetParts.tsx` 局部副本。
 *   - L430–436 下载进度条（Compose 嵌套 Box）→ `<div>` 宽度百分比。
 *   - 429/430 `Color(0x1FFFFFFF)` / `MintPrimary` → CSS 变量（暗色面板）。
 *   - L421 `"正在下载模型 ${(downloading * 100).toInt()}%"` → `downloadProgressLabel`。
 *   - L482 缓存标签 → `translationCacheLabel`。
 *   - L464 下载失败文案 → `downloadErrorLabel`。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LLM_SAVE_ERROR,
  OCR_MODEL_READY_LABEL,
  OCR_MODEL_SIZE_HINT,
  TRANSLATION_LANG_SEGMENT,
  aiEngineState,
  downloadErrorLabel,
  downloadProgressLabel,
  isAiConfigured,
  onlineEngineState,
  scaleToTranslationTextScale,
  translationCacheLabel,
  translationLangByIndex,
  translationLangIndex,
  type ComicSheetsConfig,
} from '@core/comic/comicReaderSheets';
import {
  EngineCard,
  PanelRow,
  PanelSectionCard,
  PanelTextField,
  SegmentRow,
  SliderRow,
  SwitchRow,
} from './comicSheetParts';
import { ComicIcon } from './ComicIcon';
import { showToast } from '@ui/toast';

/** Kotlin 282–503 依赖的 Android 平台能力，由宿主注入 */
export interface TranslationBridge {
  /**
   * 漫画翻译链路是否可用。`false` → 本 Tab **不提供任何可开启翻译的入口**
   * （翻译引擎选择 / 整页自动翻译开关 / 离线 OCR 模型下载），只保留
   * 「译文显示」「译文缓存」两组无副作用设置。
   *
   * 对应 `docs/PARITY_EXCEPTIONS.md` E1：ONNX OCR + 气泡分割 + 翻译在 iOS 侧
   * 全部抛 `MangaTranslateUnsupportedError`，所以入口必须隐藏，不能让用户
   * 打开一个开关然后在流水线里炸掉。
   */
  available: boolean;
  /** Kotlin 289 `TranslateModelManager.isReady(context)` */
  isModelsReady(): boolean;
  /**
   * Kotlin 300 `TranslateModelManager.ensureDownloaded(context) { p -> ... }`
   * 返回 null 表示成功，否则为错误文案（与 Kotlin 的 `err` 语义一致）。
   */
  ensureDownloaded(onProgress: (fraction: number) => void): Promise<string | null>;
  /** Kotlin 292 `TranslationCache.totalBytes(context)` */
  totalCacheBytes(): number;
  /** Kotlin 492 `TranslationCache.clear(context)` */
  clearCache(): void;
  /** Kotlin 316–319 `llmTranslator.loadConfig()` 的四个字段 */
  loadLlmConfig(): { apiUrl: string; apiKey: string; modelName: string; geminiFormat: boolean };
  /** Kotlin 328 `llmTranslator.saveConfig(...)`，失败时抛错（Kotlin 329 → Toast） */
  saveLlmConfig(cfg: {
    apiUrl: string;
    apiKey: string;
    modelName: string;
    geminiFormat: boolean;
  }): void;
  /** Kotlin 329 `Toast.makeText(..., "配置保存失败")` 的呈现通道 */
  showError(message: string): void;
}

/**
 * 「漫画翻译在 iOS 上不可用」桥 —— 显式登记的排除项（docs/PARITY_EXCEPTIONS.md E1）。
 *
 * Android 的翻译链路是 ONNX Runtime（`OrtSessions`）+ OCR + 翻译模型，
 * iOS 侧没有对应的 Web/Native 运行时，因此**整条链路不可用**。
 * 这里不做静默降级也不留可打开的开关：`available = false` 让「翻译引擎」
 * 「功能」「离线模型」三张卡片整体不渲染（Tab 本身保留，与 Kotlin 的七 Tab
 * 结构一致），只留一句明示不可用的话。
 */
export const TRANSLATION_UNAVAILABLE_MESSAGE = '漫画翻译在 iOS 上不可用';

export const UNSUPPORTED_TRANSLATION_BRIDGE: TranslationBridge = {
  available: false,
  isModelsReady: () => false,
  ensureDownloaded: async () => TRANSLATION_UNAVAILABLE_MESSAGE,
  totalCacheBytes: () => 0,
  clearCache: () => undefined,
  loadLlmConfig: () => ({ apiUrl: '', apiKey: '', modelName: '', geminiFormat: false }),
  saveLlmConfig: () => {
    throw new Error(TRANSLATION_UNAVAILABLE_MESSAGE);
  },
  showError: (message) => {
    // Kotlin 侧是 Toast；web 端统一走全局提示条（语义见 ui/toast.tsx）
    void showToast(message, { kind: 'error' });
  },
};

export interface TranslationTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
  bridge: TranslationBridge;
  /** Kotlin 324 `BackHandler` 的 web 等价（可选） */
  onSubPageBack?: () => void;
}

/** 二级页标识（Kotlin 322 `engineSubPage: String?`） */
type EngineSubPage = 'ai' | 'online' | null;

export function TranslationTab(props: TranslationTabProps) {
  const { bridge } = props;
  const [modelsReady, setModelsReady] = useState(() => bridge.isModelsReady());
  const [downloading, setDownloading] = useState(-1); // -1=空闲，0..1=进度
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [cacheBytes, setCacheBytes] = useState(() => bridge.totalCacheBytes());
  const [engineSubPage, setEngineSubPage] = useState<EngineSubPage>(null);
  const [llm, setLlm] = useState(() => bridge.loadLlmConfig());

  // Kotlin 295–308 startDownload。Kotlin 296 的 `if (downloading >= 0f) return`
  // 重入守卫用 ref 承担（闭包内读不到最新 state）。
  // Kotlin 的 `scope` 是 `rememberCoroutineScope()`：组件离开组合时协程被取消，
  // 于是 `downloading = -1f` / `modelsReady` 等写回**一律不再发生**。web 端用
  // `mountedRef` 等价表达（`rememberCoroutineScope` 的取消 = 卸载）。
  //
  // ⚠️ 这里**不能**把「取消」标志挂在 L311–313 那个 effect 的 cleanup 上：那个
  // effect 的依赖是 `translationEnabled`，用户把开关拨掉→拨回来也会跑 cleanup，
  // 标志被永久置真后所有回调（含 `downloading = -1f`）都被丢弃，下载进度会卡在
  // 「正在下载模型 0%」再也退不出去。取消只应在**卸载**时发生。
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startDownload = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setDownloading(0);
    setDownloadError(null);
    void bridge
      .ensureDownloaded((p) => {
        if (!mountedRef.current) return;
        setDownloading(Math.min(1, Math.max(0, p)));
      })
      .then((err) => {
        busyRef.current = false;
        if (!mountedRef.current) return;
        setDownloading(-1);
        if (err === null) {
          setModelsReady(true);
        } else {
          setDownloadError(err);
        }
      })
      // 桥接契约是「resolve(null) 成功 / resolve(字符串) 失败」（Kotlin 302–306）。
      // 抛异常属于契约外：按同一契约把它当失败文案处理，保证 `downloading` 一定
      // 能从 [0,1] 退回 -1（否则 UI 与 Kotlin 292 一样会永久停在「正在下载」）。
      .catch((e: unknown) => {
        busyRef.current = false;
        if (!mountedRef.current) return;
        setDownloading(-1);
        setDownloadError(e instanceof Error && e.message !== '' ? e.message : LLM_SAVE_ERROR);
      });
  }, [bridge]);

  // Kotlin 311–313：打开开关即自动补齐模型（已就绪则跳过）
  const { translationEnabled } = props.config;
  useEffect(() => {
    if (!translationEnabled) return;
    if (bridge.isModelsReady()) return;
    startDownload();
  }, [translationEnabled, bridge, startDownload]);

  // Kotlin 324：二级页时系统返回 = 回引擎列表（不关面板）
  const onSubPageBack = props.onSubPageBack;
  useEffect(() => {
    if (onSubPageBack === undefined) return;
    if (engineSubPage === null) return;
    onSubPageBack();
  }, [engineSubPage, onSubPageBack]);

  // Kotlin 326–330 saveLlm
  const saveLlm = useCallback(
    (next: { apiUrl: string; apiKey: string; modelName: string; geminiFormat: boolean }) => {
      setLlm(next);
      try {
        bridge.saveLlmConfig(next);
      } catch (e) {
        bridge.showError(e instanceof Error && e.message !== '' ? e.message : LLM_SAVE_ERROR);
      }
    },
    [bridge],
  );

  const aiConfigured = isAiConfigured(llm.apiUrl, llm.modelName);
  const langIdx = translationLangIndex(props.config.translationLang);
  // E1：整条 ONNX 翻译链路不可用 → 隐藏一切能开启翻译的入口（引擎选择 /
  // 整页自动翻译 / 离线模型下载）。只保留译文显示 / 译文缓存两组惰性设置。
  const engineAvailable = bridge.available;

  return (
    <>
      {/* E1：不可用时的一句明示（替代被隐藏的三张卡片） */}
      {engineAvailable ? null : (
        <PanelSectionCard title="漫画翻译" icon="Bolt">
          <span className="cmcs-desc">{TRANSLATION_UNAVAILABLE_MESSAGE}</span>
        </PanelSectionCard>
      )}

      {/* L332–351 二级页：自定义 AI 配置 */}
      {engineAvailable && engineSubPage === 'ai' ? (
        <PanelSectionCard title="自定义 AI 接口" icon="Cloud">
          <PanelRow label="返回引擎列表" icon="ArrowBack" onClick={() => setEngineSubPage(null)} />
          <div className="cmcs-card__gap6" />
          <PanelTextField
            label="API 地址（如 https://api.deepseek.com）"
            value={llm.apiUrl}
            onValueChange={(v) => saveLlm({ ...llm, apiUrl: v })}
          />
          <PanelTextField
            label="API Key"
            value={llm.apiKey}
            onValueChange={(v) => saveLlm({ ...llm, apiKey: v })}
          />
          <PanelTextField
            label="模型名（如 deepseek-chat）"
            value={llm.modelName}
            onValueChange={(v) => saveLlm({ ...llm, modelName: v })}
          />
          <SwitchRow
            title="Gemini 接口格式"
            subtitle={
              llm.geminiFormat ? '走 Google Gemini generateContent' : '走 OpenAI chat/completions'
            }
            checked={llm.geminiFormat}
            onChange={(v) => saveLlm({ ...llm, geminiFormat: v })}
          />
        </PanelSectionCard>
      ) : null}

      {/* L352–366 二级页：在线翻译设置 */}
      {engineAvailable && engineSubPage === 'online' ? (
        <PanelSectionCard title="在线翻译" icon="Public">
          <PanelRow label="返回引擎列表" icon="ArrowBack" onClick={() => setEngineSubPage(null)} />
          <div className="cmcs-card__gap6" />
          <SegmentRow
            title="页面文字"
            options={TRANSLATION_LANG_SEGMENT}
            selected={langIdx}
            onSelect={(i) =>
              props.update((c) => ({ ...c, translationLang: translationLangByIndex(i) }))
            }
          />
        </PanelSectionCard>
      ) : null}

      {/* L367–394 一级页：引擎选择卡片 */}
      {engineAvailable && engineSubPage === null ? (
        <PanelSectionCard title="翻译引擎（点击选择）" icon="Bolt">
          <EngineCard
            title="自定义 AI 接口"
            desc="DeepSeek / GLM / Kimi 等 OpenAI 兼容接口"
            state={aiEngineState(props.config.translationEngine, aiConfigured)}
            selected={props.config.translationEngine === 'ai'}
            onClick={() => {
              props.update((c) => ({ ...c, translationEngine: 'ai' }));
              setEngineSubPage('ai');
            }}
          />
          <div className="cmcs-card__gap8" />
          <EngineCard
            title="在线翻译"
            desc="腾讯交互翻译，国内直连"
            state={onlineEngineState(props.config.translationEngine)}
            selected={props.config.translationEngine === 'online'}
            onClick={() => {
              props.update((c) => ({ ...c, translationEngine: 'online' }));
              setEngineSubPage('online');
            }}
          />
        </PanelSectionCard>
      ) : null}

      {/* L396–410 功能 */}
      {engineAvailable && engineSubPage === null ? (
        <PanelSectionCard title="功能" icon="Translate">
          <SwitchRow
            title="整页自动翻译"
            checked={props.config.translationEnabled}
            onChange={(v) => props.update((c) => ({ ...c, translationEnabled: v }))}
          />
          <SegmentRow
            title="页面文字"
            options={TRANSLATION_LANG_SEGMENT}
            selected={langIdx}
            onSelect={(i) =>
              props.update((c) => ({ ...c, translationLang: translationLangByIndex(i) }))
            }
          />
        </PanelSectionCard>
      ) : null}

      {/* L413–468 离线模型 */}
      {engineAvailable ? (
      <PanelSectionCard title="离线模型" icon="CloudDownload">
        {modelsReady ? (
          <SwitchRow title={OCR_MODEL_READY_LABEL} checked onChange={() => {}} />
        ) : downloading >= 0 ? (
          <div className="cmcs-download">
            <span className="cmcs-download__text">{downloadProgressLabel(downloading)}</span>
            <div className="cmcs-download__gap6" />
            <div className="cmcs-download__track">
              <div
                className="cmcs-download__fill"
                style={{ width: `${Math.min(1, Math.max(0.01, downloading)) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="cmcs-download">
            <span className="cmcs-download__hint">{OCR_MODEL_SIZE_HINT}</span>
            <div className="cmcs-download__gap8" />
            <button type="button" className="cmcs-chiprow" onClick={startDownload}>
              <span className="cmcs-chiprow__icon" aria-hidden="true">
                <ComicIcon name="Download" size={16} />
              </span>
              <span className="cmcs-chiprow__gap8" />
              <span className="cmcs-chiprow__label">
                {downloadError === null ? '下载模型' : '重试下载'}
              </span>
            </button>
            {downloadError !== null ? (
              <>
                <div className="cmcs-download__gap6" />
                <span className="cmcs-download__error">{downloadErrorLabel(downloadError)}</span>
              </>
            ) : null}
          </div>
        )}
      </PanelSectionCard>
      ) : null}

      {/* L470–478 译文显示 */}
      <PanelSectionCard title="译文显示" icon="FormatSize">
        <SliderRow
          title="译文字号"
          value={props.config.translationTextScale * 100}
          range={[80, 140]}
          format={(v) => `${Math.trunc(v)}%`}
          onChange={(v) =>
            props.update((c) => ({ ...c, translationTextScale: scaleToTranslationTextScale(v) }))
          }
        />
      </PanelSectionCard>

      {/* L480–502 译文缓存 */}
      <PanelSectionCard title="译文缓存" icon="CleaningServices">
        <SwitchRow
          title={translationCacheLabel(cacheBytes)}
          checked={cacheBytes > 0}
          onChange={() => {}}
        />
        <button
          type="button"
          className="cmcs-chiprow"
          onClick={() => {
            bridge.clearCache();
            setCacheBytes(0);
          }}
        >
          <span className="cmcs-chiprow__icon" aria-hidden="true">
            <ComicIcon name="Delete" size={16} />
          </span>
          <span className="cmcs-chiprow__gap8" />
          <span className="cmcs-chiprow__label">清空全部已翻译页面</span>
        </button>
      </PanelSectionCard>
    </>
  );
}
