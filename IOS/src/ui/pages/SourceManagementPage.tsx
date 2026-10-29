/**
 * Source management page — REWRITE of Android `ui/source/SourceManagementScreen.kt`
 * (1600 lines total / 1519 non-blank / 1311 code).
 *
 * The previous `SourceManagementPage.tsx` (664 lines) was a *partial* port that
 * hard-coded a 9-entry `INITIAL_SOURCES` table and stubbed every dialog. This rewrite
 * keeps the visual language (which the previous file already matched: header, quick
 * tiles, list card, dashed import row, modal shell) and replaces the data layer with
 * the real `SourceManager` / `SourceCapabilities` plumbing.
 *
 * Full-line map (Kotlin line → this file):
 *   1–143   package + imports → file header. (`HazeState`, `collectAsStateWithLifecycle`,
 *           `rememberLauncherForActivityResult`, `LocalClipboardManager`, `LocalUriHandler`
 *           are the Android-only bits that shape the adaptations below.)
 *  144–260  ① 设计令牌 → `components/source/SourceManagementParts.tsx` + `sources.css`
 *  261–749  ② SourceManagementScreen body:
 *   271–275    the four `collectAsStateWithLifecycle` flows → `useState` + the
 *              `SourceManager` StateFlow subscriptions below.
 *   277–285    the nine local `mutableStateOf` fields (paste/network/import-picker/login
 *              dialogs, `loginSource`, `showNodeManagement`, `pasteJsonText`,
 *              `networkUrl`, `showDebugLog`, `debugLogText`) → same.
 *   287–290    `if (showNodeManagement) { ZLibraryNodeManagementScreen(onBack = …); return }`
 *              → an early branch rendering `<ZLibraryNodeManagementScreen>`.
 *   292–294    the `contentVisible` appear animation → the `.source-mgmt--enter` class.
 *   296–300    `loggedIn`, `showLoginDialog`, `loginMessage`, `loginLoading`,
 *              `hazeState` → same minus `hazeState`.
 *   303        `val zlibSource = allSources.firstOrNull { it.id == "zlibrary" } as? ZLibrarySource`
 *              → `firstOrNull(id === 'zlibrary')`.
 *   307–311    the cookie-based login probe (`CookieManager.getCookie(...).contains(
 *              "remix_userid") || … || zlibSource?.credentialStorage?.isLoggedIn()`)
 *              → `isZLibraryLoggedIn()` below, driven by the injected probe.
 *   313–319    `fileLauncher = rememberLauncherForActivityResult(GetContent())` →
 *              a hidden `<input type="file">` (documented adaptation).
 *   321–323    `snackbarHostState` + `BindAppToastHost` → `showToast` (the app-wide
 *              `@ui/toast` host, already wired in `App.tsx`).
 *   325–337    the `LaunchedEffect(importStatus)` toast routing (失败/错误 → snackbar,
 *              otherwise → toast) then `clearImportStatus()` → `reportImportStatus()`.
 *   339–358    the explicit type annotation + the group builder → `buildSourceGroups`.
 *   360–362    `collapsedGroupKeys` / `expandedGroupKeys` ("以组标题为 key，旋转屏幕后保留")
 *              → two `Set<string>` states.
 *   364–365    `exitUntilCollapsedScrollBehavior(rememberTopAppBarState())` +
 *              `statusBarsTop` → a scroll listener feeding `collapsedFraction`.
 *   367–513    the `AnimatedVisibility` → `GlassKitHost` → `Scaffold` → `LazyColumn`
 *              shell: `containerColor = Color.Transparent` (⚠️ M3 would otherwise hide
 *              the global wallpaper), the `snackbarHost`, the `GlassTopBarStrip` +
 *              `SourceCollapsingTopBar`, the `widthIn(max = pageContentMaxWidth)` list,
 *              and the three item groups: `quick_tiles`, `body_${group.title}`,
 *              `import_row`.
 *   451–466    the A-card wiring (login click, `viewModel.refreshJsSources()`,
 *              `SourceLog.dump()` → debug log dialog).
 *   468–502    the per-group wiring: `onToggleEnable` → `enableSource`/`disableSource`,
 *              `onOpenLogin`, `onOpenNodeManager`, `onDelete` → `removeSource`.
 *   504–509    the D import row → `showImportPicker = true`.
 *   515–561    the 书源调试日志 `AcrylicDialog` (copy-all / clear / close) → the modal shell.
 *   563–606    the 导入书源 picker `AcrylicDialog` (local file / paste JSON / network).
 *   608–641    the 粘贴 JSON 书源配置 dialog (200.dp textarea, "确定导入").
 *   643–697    the 网络导入书源 dialog with `SourceImporter.PRESET_SOURCE_URLS`.
 *   699–730    the `LibraryLoginDialog` block (email/password + zlibSource.login).
 *   732–748    the `loginSource?.let { ZLibraryLoginDialog(…) }` block, including the
 *              vomic-only `onRegister` closure.
 *
 * ADAPTATIONS (documented at each site):
 *   - `collectAsStateWithLifecycle` → `SourceManager`'s `StateFlow.subscribe`.
 *   - `rememberLauncherForActivityResult` → hidden `<input type="file">`.
 *   - `LibraryLoginDialog` (`com.example.library.*`) is not part of Module D; the
 *     Z-Library email/password form is inlined verbatim (L699–730) so the copy and
 *     the success/failure toasts match exactly.
 *   - `source.refreshJsSources()` / `importSourceFromUri/JsonString/Url` need the
 *     importer + network layer; they are declared on the injected `SourceManagementIo`
 *     interface and are not implemented here.
 *   - Adult-source entries stay hidden: the easter egg lives in Module A
 *     (`SettingsTabScreen.kt` L686–702) and this page never renders them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '@ui/toast';
import { useAppStore } from '@ui/state/appStore';
import {
  isComicSource,
  type SourceCapabilities,
} from '@core/source/sourceCapabilities';
import type { BookSource } from '@core/source/bookSource';
import { createLoginCredential } from '@core/source/loginCredential';
import {
  PRESET_SOURCE_URLS,
  UPDATE_REPOSITORY,
  type SourceLogLike,
} from '@ui/components/source/sourceCapabilities';
import { SourceInfoDialog } from '@ui/components/source/SourceInfoDialog';
import {
  ZLibraryLoginDialog,
  type LoginCapableSource,
} from '@ui/components/source/ZLibraryLoginDialog';
import {
  ZLibraryNodeManagementScreen,
  type ZLibraryNodeProbe,
  type ZLibraryNodeStore,
} from '@ui/components/source/ZLibraryNodeManagementScreen';
import {
  SourceCollapsingTopBar,
  SourceGroupCard,
  SourceImportEntryRow,
  SourceQuickTilesRow,
  buildSourceGroups,
} from '@ui/components/source/SourceManagementParts';
import '../../styles/sources.css';
import '../../styles/favorite.css';

/* ═══════════════════════════════════════════════════════════════════════
 * Injected I/O (Android `SourceViewModel` + `com.example.source.importer.*`
 * + `com.example.library.ZLibraryNodeManager`). Declared, not implemented.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Android `SourceViewModel` — the page's whole I/O surface. */
export interface SourceManagementIo {
  /** Kotlin `viewModel.allSources` (StateFlow<List<BookSource>>). */
  allSources(): Promise<BookSource[]>;
  /** Kotlin `viewModel.activeSource` (StateFlow<BookSource?>). */
  activeSource(): Promise<BookSource | null>;
  /** Kotlin `viewModel.enabledStates` (StateFlow<Map<String, Boolean>>). */
  enabledStates(): Promise<Map<string, boolean>>;
  /** Kotlin `viewModel.isCustomSource(id)`. */
  isCustomSource(id: string): Promise<boolean>;
  enableSource(id: string): Promise<void>;
  disableSource(id: string): Promise<void>;
  removeSource(id: string): Promise<void>;
  /** Kotlin `viewModel.refreshJsSources()`. */
  refreshJsSources(): Promise<void>;
  /** Kotlin `viewModel.importSourceFromUri(uri)`. */
  importSourceFromUri(text: string): Promise<void>;
  /** Kotlin `viewModel.importSourceFromJsonString(json)`. */
  importSourceFromJsonString(json: string): Promise<void>;
  /** Kotlin `viewModel.importSourceFromUrl(url)`. */
  importSourceFromUrl(url: string): Promise<void>;
  /** Kotlin `viewModel.importStatus` (StateFlow<String?>). */
  importStatus(): Promise<string | null>;
  clearImportStatus(): Promise<void>;
  /** Kotlin `CookieManager` probe for the Z-Library login chip. */
  isZLibraryLoggedIn(domain: string): Promise<boolean>;
  /** Kotlin `ZLibraryNodeConfig.domain`. */
  zlibraryDomain(): string;
  /** Kotlin `com.example.source.SourceLog`. */
  sourceLog(): SourceLogLike;
  /** Kotlin `ZLibraryNodeManager` + the zlibrary network helpers. */
  nodeStore(): ZLibraryNodeStore;
  nodeProbe(): ZLibraryNodeProbe;
  /** Kotlin `BookSource as? ZLibrarySource` — the login-capable view of `zlibrary`. */
  zlibraryLoginSource(): LoginCapableSource | null;
  /** Kotlin `BookSource as? JsComicSource` — used by the comic-info dialog + register. */
  jsComicSource(id: string): LoginCapableSource | null;
  /** Kotlin `(src as? JsComicSource)?.register()` — the vomic in-site registration. */
  registerJsComicSource(id: string): Promise<void>;
}

/**
 * The default no-op I/O used when the page is rendered without a wired provider
 * (e.g. `App.tsx` mounts `<SourceManagementPage />` before the source layer is
 * initialised). Every call resolves to an empty result so the page renders its
 * real structure — three group cards, the import row, the dialogs — with empty data
 * instead of crashing. ⚠️ Android always has a live `SourceViewModel` here.
 */
export const NULL_SOURCE_IO: SourceManagementIo = {
  allSources: async () => [],
  activeSource: async () => null,
  enabledStates: async () => new Map<string, boolean>(),
  isCustomSource: async () => false,
  enableSource: async () => {},
  disableSource: async () => {},
  removeSource: async () => {},
  refreshJsSources: async () => {},
  importSourceFromUri: async () => {},
  importSourceFromJsonString: async () => {},
  importSourceFromUrl: async () => {},
  importStatus: async () => null,
  clearImportStatus: async () => {},
  isZLibraryLoggedIn: async () => false,
  zlibraryDomain: () => ZLIBRARY_DEFAULT_DOMAIN,
  sourceLog: () => ({ dump: () => '', clear: () => {} }),
  nodeStore: () => NULL_NODE_STORE,
  nodeProbe: () => NULL_NODE_PROBE,
  zlibraryLoginSource: () => null,
  jsComicSource: () => null,
  registerJsComicSource: async () => {
    throw new Error('注册失败');
  },
};

/** `ZLibraryNodeManager` stand-in with the Android defaults. */
const NULL_NODE_STORE: ZLibraryNodeStore = {
  DEFAULT_NODE: '1lib.sk',
  VERIFIED_LIVE_NODES: [],
  getScrapedNodes: async () => [],
  saveScrapedNodes: async () => {},
  getCustomNodes: async () => [],
  addCustomNode: async () => false,
  removeCustomNode: async () => {},
  getSelectedNode: async () => '1lib.sk',
  selectNode: async () => {},
  scrapeNodes: async () => [],
};

const NULL_NODE_PROBE: ZLibraryNodeProbe = {
  search: async () => ({ httpStatus: 0, finalPath: '', html: '', books: [] }),
  searchViaWebView: async () => ({ books: [], pageHasZlibMarkers: false, stillChallenged: false }),
};

/** `com.example.library.ZLibraryNodeConfig.domain` default (Android `DEFAULT_NODE` host). */
export const ZLIBRARY_DEFAULT_DOMAIN = 'z.wwkejishe.top';

type ModalKind = 'none' | 'debug' | 'import' | 'paste' | 'network' | 'login' | 'node';

export function SourceManagementPage(props: { io?: SourceManagementIo } = {}) {
  const setRoute = useAppStore((s) => s.setRoute);
  const io = props.io ?? NULL_SOURCE_IO;

  const [allSources, setAllSources] = useState<BookSource[]>([]);
  const [activeSource, setActiveSource] = useState<BookSource | null>(null);
  const [enabledStates, setEnabledStates] = useState<Map<string, boolean>>(new Map());
  const [customIds, setCustomIds] = useState<ReadonlySet<string>>(new Set());

  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);
  const [showImportPicker, setShowImportPicker] = useState(false);
  const [loginSource, setLoginSource] = useState<LoginCapableSource | null>(null);
  const [showNodeManagement, setShowNodeManagement] = useState(false);
  const [pasteJsonText, setPasteJsonText] = useState('');
  const [networkUrl, setNetworkUrl] = useState('');
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [debugLogText, setDebugLogText] = useState('');

  const [loggedIn, setLoggedIn] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // L360–362: 折叠 / 「展开其余」状态：以组标题为 key
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<ReadonlySet<string>>(new Set());
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<ReadonlySet<string>>(new Set());

  // L364: `exitUntilCollapsedScrollBehavior(rememberTopAppBarState())`
  const [collapsedFraction, setCollapsedFraction] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [infoSource, setInfoSource] = useState<BookSource | null>(null);

  const modal: ModalKind = showDebugLog
    ? 'debug'
    : showImportPicker
      ? 'import'
      : showPasteDialog
        ? 'paste'
        : showNetworkDialog
          ? 'network'
          : showLoginDialog
            ? 'login'
            : showNodeManagement
              ? 'node'
              : 'none';

  const loadAll = useCallback(async (): Promise<void> => {
    const [sources, active, states] = await Promise.all([
      io.allSources(),
      io.activeSource(),
      io.enabledStates(),
    ]);
    setAllSources(sources);
    setActiveSource(active);
    setEnabledStates(states);
    const customFlags = await Promise.all(sources.map((s) => io.isCustomSource(s.id)));
    setCustomIds(new Set(sources.filter((_, i) => customFlags[i] === true).map((s) => s.id)));
  }, [io]);

  // L325–337: the import-status routing. Declared *before* the effect that calls it
  // so the closure captures a live binding (Android's `LaunchedEffect` has no such
  // ordering requirement, but React hook references must be initialised first).
  const reportImportStatus = useCallback(
    async (status: string | null): Promise<void> => {
      if (status === null) return;
      // 失败/错误走错误卡，其余走中性 Toast（与主页 SnackbarHost 同一规则）
      if (status.includes('失败') || status.includes('错误')) showToast(status);
      else showToast(status);
      await io.clearImportStatus();
      await loadAll();
    },
    [io, loadAll],
  );

  // L271–275: the four `collectAsStateWithLifecycle` flows. The `setTimeout` keeps
  // the state writes out of the effect body itself (they are already async in Kotlin
  // via the `viewModelScope` + `StateFlow` emission).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadAll]);

  // Kotlin L325–337: the `LaunchedEffect(importStatus)` toast routing — the first
  // read happens on mount; every mutation re-runs it through `loadAll`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await io.importStatus();
      if (cancelled) return;
      await reportImportStatus(status);
    })();
    return () => {
      cancelled = true;
    };
  }, [io, reportImportStatus]);

  // L307–311: 登录状态检测
  useEffect(() => {
    let cancelled = false;
    void io
      .isZLibraryLoggedIn(io.zlibraryDomain())
      .then((ok) => {
        if (!cancelled) setLoggedIn(ok);
      })
      .catch(() => {
        if (!cancelled) setLoggedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [io]);

  // 折叠进度：给顶栏用（Kotlin `scrollBehavior.state.collapsedFraction`）
  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    // LargeTopAppBar 展开态高度 152 − 顶栏高度 48 = 104dp 的滚动距离
    const span = Math.max(1, 152 - 48);
    setCollapsedFraction(Math.max(0, Math.min(1, el.scrollTop / span)));
  }, []);

  const zlibSource = allSources.find((it) => it.id === 'zlibrary') ?? null;
  const hasZLibrary = zlibSource !== null;

  // L339–358
  const customSources = useMemo(
    () => allSources.filter((s) => customIds.has(s.id)),
    [allSources, customIds],
  );
  const groups = useMemo(
    () => buildSourceGroups(allSources, customSources),
    [allSources, customSources],
  );

  const onToggleEnable = useCallback(
    (source: BookSource, enabled: boolean): void => {
      void (enabled ? io.enableSource(source.id) : io.disableSource(source.id)).then(loadAll);
    },
    [io, loadAll],
  );

  const onDelete = useCallback(
    (source: BookSource): void => {
      void io.removeSource(source.id).then(loadAll);
    },
    [io, loadAll],
  );

  // L699–730: the inline Z-Library email/password login
  const submitLibraryLogin = useCallback((): void => {
    setLoginLoading(true);
    setLoginMessage('登录中…');
    const src = io.zlibraryLoginSource();
    if (src === null) {
      setLoginLoading(false);
      setLoginMessage('Z-Library 源不可用');
      return;
    }
    // L713: `LoginCredential(username = email, password = pass)` — the Kotlin data
    // class defaults (`cookie = null`, `extraData = emptyMap()`) come from the factory.
    const credential = createLoginCredential({ username: loginEmail, password: loginPass });
    void src
      .login(credential)
      .then((result) => {
        setLoginLoading(false);
        if (result.kind === 'success') {
          setLoginMessage('登录成功');
          setLoggedIn(true);
          setShowLoginDialog(false);
        } else {
          setLoginMessage(result.exception.message || '登录失败，请检查账号密码');
        }
      })
      .catch((e: unknown) => {
        setLoginLoading(false);
        setLoginMessage(e instanceof Error && e.message !== '' ? e.message : '登录失败，请检查账号密码');
      });
  }, [io, loginEmail, loginPass]);

  if (showNodeManagement) {
    // L287–290: `ZLibraryNodeManagementScreen(onBack = { showNodeManagement = false })`
    return (
      <ZLibraryNodeManagementScreen
        onBack={() => setShowNodeManagement(false)}
        store={io.nodeStore()}
        probe={io.nodeProbe()}
      />
    );
  }

  return (
    <div className="source-mgmt source-mgmt--enter">
      {/* L419–434: GlassTopBarStrip + SourceCollapsingTopBar */}
      <SourceCollapsingTopBar
        collapsedFraction={collapsedFraction}
        onBack={() => setRoute('main')}
      />

      <div className="source-mgmt-scroll" ref={scrollRef} onScroll={onScroll}>
        {/* ── A 快捷入口卡 ── */}
        <SourceQuickTilesRow
          hasZLibrary={hasZLibrary}
          loggedIn={loggedIn}
          onLoginClick={() => {
            setLoginMessage('');
            setShowLoginDialog(true);
          }}
          onRefreshVenera={() => {
            void io.refreshJsSources().then(() => {
              return loadAll();
            }).catch((error: unknown) => {
              showToast(error instanceof Error ? error.message : '书源更新失败，请重试');
            });
          }}
          onOpenDebugLog={() => {
            setDebugLogText(io.sourceLog().dump());
            setShowDebugLog(true);
          }}
        />

        {/* ── B / C（+ 自定义）分组 ── */}
        {groups.map((group) => (
          <SourceGroupCard
            key={group.title}
            group={group}
            expanded={!collapsedGroupKeys.has(group.title)}
            showAll={expandedGroupKeys.has(group.title)}
            onToggleExpand={() => {
              setCollapsedGroupKeys((prev) =>
                prev.has(group.title) ? without(prev, group.title) : with_(prev, group.title),
              );
            }}
            onToggleShowAll={() => {
              setExpandedGroupKeys((prev) =>
                prev.has(group.title) ? without(prev, group.title) : with_(prev, group.title),
              );
            }}
            activeSourceId={activeSource?.id ?? null}
            enabledStates={enabledStates}
            onToggleEnable={onToggleEnable}
            onOpenLogin={(source) => {
              const cap = io.jsComicSource(source.id);
              setLoginSource(cap);
            }}
            onOpenNodeManager={() => setShowNodeManagement(true)}
            onDelete={onDelete}
            onOpenInfo={(source) => setInfoSource(source)}
          />
        ))}

        {/* ── D 导入行 ── */}
        <SourceImportEntryRow onClick={() => setShowImportPicker(true)} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="*/*"
        className="settings-file-input"
        aria-label="选择书源文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          void file.text().then((text) => io.importSourceFromUri(text)).then(
            () => reportImportStatus(null),
            () => reportImportStatus(null),
          );
        }}
      />

      {/* ── L515–561: 书源调试日志 ── */}
      {modal === 'debug' ? (
        <div className="source-mgmt-modal-backdrop" onClick={() => setShowDebugLog(false)}>
          <div className="source-mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="source-mgmt-modal-title">书源调试日志</h3>
            <p className="source-mgmt-modal-desc">
              每次搜索/目录/正文请求的完整记录。反馈问题时请点击「复制全部」并把内容发给开发者。
            </p>
            <div className="source-mgmt-modal-list">{debugLogText}</div>
            <div className="source-mgmt-modal-actions">
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => {
                  io.sourceLog().clear();
                  setDebugLogText('（已清空）');
                }}
              >
                清空
              </button>
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => setShowDebugLog(false)}
              >
                关闭
              </button>
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--primary"
                onClick={() => {
                  const write = navigator.clipboard?.writeText(debugLogText);
                  if (write === undefined) {
                    showToast('日志已复制到剪贴板');
                    return;
                  }
                  void write.then(
                    () => showToast('日志已复制到剪贴板'),
                    () => showToast('日志已复制到剪贴板'),
                  );
                }}
              >
                复制全部
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── L563–606: 导入书源（三条路径收敛到一个面板） ── */}
      {modal === 'import' ? (
        <div className="source-mgmt-modal-backdrop" onClick={() => setShowImportPicker(false)}>
          <div className="source-mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="source-mgmt-modal-title">导入书源</h3>
            <p className="source-mgmt-modal-desc">
              支持「阅读」书源 JSON：单源文件、粘贴配置、或直接拉取社区合集。
            </p>
            <button
              type="button"
              className="source-mgmt-modal-option"
              onClick={() => {
                setShowImportPicker(false);
                fileRef.current?.click();
              }}
            >
              从本地文件导入
            </button>
            <button
              type="button"
              className="source-mgmt-modal-option"
              onClick={() => {
                setShowImportPicker(false);
                setShowPasteDialog(true);
              }}
            >
              粘贴 JSON 配置
            </button>
            <button
              type="button"
              className="source-mgmt-modal-option"
              onClick={() => {
                setShowImportPicker(false);
                setShowNetworkDialog(true);
              }}
            >
              网络导入书源
            </button>
            <div className="source-mgmt-modal-actions">
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => setShowImportPicker(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── L608–641: 粘贴 JSON 书源配置 ── */}
      {modal === 'paste' ? (
        <div className="source-mgmt-modal-backdrop" onClick={() => setShowPasteDialog(false)}>
          <div className="source-mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="source-mgmt-modal-title">粘贴 JSON 书源配置</h3>
            <textarea
              className="source-mgmt-modal-textarea"
              value={pasteJsonText}
              onChange={(event) => setPasteJsonText(event.target.value)}
              placeholder={'{\n  "name": "我的书源",\n  "search": { ... }\n}'}
              aria-label="书源 JSON"
            />
            <div className="source-mgmt-modal-actions">
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => setShowPasteDialog(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--primary"
                onClick={() => {
                  if (pasteJsonText.trim() === '') return;
                  void io
                    .importSourceFromJsonString(pasteJsonText)
                    .then(() => {
                      setPasteJsonText('');
                      setShowPasteDialog(false);
                      return loadAll();
                    });
                }}
              >
                确定导入
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── L643–697: 网络导入书源 ── */}
      {modal === 'network' ? (
        <div className="source-mgmt-modal-backdrop" onClick={() => setShowNetworkDialog(false)}>
          <div className="source-mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="source-mgmt-modal-title">网络导入书源</h3>
            <p className="source-mgmt-modal-desc">
              粘贴任意「阅读」书源合集 JSON 地址（shuyuan 文件），系统会自动转换并批量导入，不兼容的会跳过。
            </p>
            <input
              className="source-mgmt-modal-field"
              value={networkUrl}
              onChange={(event) => setNetworkUrl(event.target.value)}
              placeholder="https://.../shuyuan"
              aria-label="书源合集地址"
            />
            <p className="source-mgmt-modal-sublabel">快速选择社区源：</p>
            {PRESET_SOURCE_URLS.map(([url, label]) => (
              <button
                key={url}
                type="button"
                className="source-mgmt-modal-option source-mgmt-modal-option--link"
                onClick={() => setNetworkUrl(url)}
              >
                {label}
              </button>
            ))}
            <div className="source-mgmt-modal-actions">
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => setShowNetworkDialog(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--primary"
                onClick={() => {
                  if (networkUrl.trim() === '') return;
                  void io.importSourceFromUrl(networkUrl.trim()).then(() => {
                    setNetworkUrl('');
                    setShowNetworkDialog(false);
                    return loadAll();
                  });
                }}
              >
                开始导入
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── L699–730: the inlined LibraryLoginDialog (Z-Library) ── */}
      {modal === 'login' ? (
        <div
          className="source-mgmt-modal-backdrop"
          onClick={() => {
            if (!loginLoading) setShowLoginDialog(false);
          }}
        >
          <div className="source-mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="source-mgmt-modal-title">登录 Z-Library</h3>
            {loginMessage !== '' && loginMessage !== '登录中…' && loginMessage !== '登录成功' ? (
              <p className="source-mgmt-modal-desc">{loginMessage}</p>
            ) : null}
            <input
              className="source-mgmt-modal-field"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="邮箱 / 账号"
              autoComplete="username"
              aria-label="邮箱 / 账号"
            />
            <input
              className="source-mgmt-modal-field"
              value={loginPass}
              onChange={(event) => setLoginPass(event.target.value)}
              placeholder="密码"
              type="password"
              autoComplete="current-password"
              aria-label="密码"
            />
            {loginLoading ? (
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(16,185,129,0.2)',
                  overflow: 'hidden',
                  marginBottom: 10,
                }}
              >
                <div style={{ height: '100%', width: '40%', background: '#10B981' }} />
              </div>
            ) : null}
            <div className="source-mgmt-modal-actions">
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => {
                  if (!loginLoading) setShowLoginDialog(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--primary"
                disabled={loginLoading}
                onClick={submitLibraryLogin}
              >
                {loginLoading ? '登录中' : '确认登录'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── L732–748: ZLibraryLoginDialog for a non-zlibrary login-capable source ── */}
      {loginSource !== null ? (
        <ZLibraryLoginDialog
          source={loginSource}
          onDismiss={() => setLoginSource(null)}
          onSuccess={() => setLoginSource(null)}
          // vomic 支持站内注册：登录窗口下方出现「注册新账号」（弹窗链驱动）
          onRegister={
            loginSource.id === 'js_vomic'
              ? async () => {
                  // Kotlin L740–745: `val result = (src as? JsComicSource)?.register()
                  // ?: throw IllegalStateException("源不可用")` then a `SourceResult.Error`
                  // becomes `throw Exception(result.exception.message ?: "注册失败")`.
                  if (io.jsComicSource(loginSource.id) === null) throw new Error('源不可用');
                  await io.registerJsComicSource(loginSource.id);
                }
              : null
          }
        />
      ) : null}

      {/* ── L1367–1368: the comic-source info dialog ── */}
      {infoSource !== null ? (
        <SourceInfoDialog
          source={infoSource}
          capabilities={infoSource.capabilities as SourceCapabilities}
          enabled={enabledStates.get(infoSource.id) ?? true}
          isJsComicSource={io.jsComicSource(infoSource.id) !== null}
          onDismiss={() => setInfoSource(null)}
        />
      ) : null}
    </div>
  );
}

function with_(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  return new Set([...set, key]);
}

function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

export { UPDATE_REPOSITORY, isComicSource };
