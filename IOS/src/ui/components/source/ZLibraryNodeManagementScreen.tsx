/**
 * Port of Android `ui/source/ZLibraryNodeManagementScreen.kt` (516 lines total / 496 non-blank / 480 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–51   package + imports → file header.
 *   52–58  the KDoc (default node 1lib.sk + 官网/备用 three nodes + user nodes; each node
 *          "检测" by really searching 三体 through an offscreen WebView; "扒取节点" pulls
 *          https://z.wwknav.com/rkfby.html; switching takes effect immediately and persists)
 *          → `ZLibraryNodeManagementScreen` KDoc, verbatim.
 *   59–62  `@Composable fun ZLibraryNodeManagementScreen(onBack: () -> Unit)` + the seven
 *          `mutableStateOf` fields (`scrapedNodes`, `customNodes`, `selectedNode`,
 *          `customInput`, `scraping`, `showReplaceDialog`, `foundNodes`) → same `useState`s.
 *   70–72  `mutableStateOf(ZLibraryNodeManager.getScrapedNodes(context))` /
 *          `getCustomNodes(context)` / `getSelectedNode(context)` — Kotlin reads the
 *          persisted node table inside those three `remember`s, i.e. on the FIRST
 *          composition. ⚠️ The port had the `useState`s but no read at all, so the screen
 *          opened with an empty node list and a bare `当前节点：`. FIXED: a mount effect now
 *          awaits the three getters in parallel and is guarded against unmount.
 *   64–68  `AnimatedVisibility(visible = contentVisible, enter = fadeIn(tween(260)) +
 *          scaleIn(0.94f, spring) + slideInVertically({ it / 12 }, tween(280)))` with
 *          `LaunchedEffect(Unit) { contentVisible = true }` → a CSS keyframe class.
 *   78–79  `statuses = remember { mutableStateMapOf<String, String>() }` +
 *          `testingNode` → two `useState`s (`Record<string,string>` + `string | null`).
 *   81–184 `fun testNode(node: String)` — the whole reachability probe:
 *    85–96    `URLEncoder.encode("三体", "UTF-8").replace("+", "%20")` + the search URL
 *              + `httpClient.get(url, referer = "https://$node/")` → `probeNode()` below
 *              (⚠️ the HTTP/cookie layer is the injected `ZLibraryNodeProbe` interface —
 *              see the note above it; the search keyword stays 三体 verbatim).
 *    97–100   the 302-redirect detection (`finalPath.startsWith("/s/")`) → in the probe.
   101–109   `html.contains("Search service temporary unavailable")` → 站点可达，搜索服务暂不可用（官网故障）
   110–114   `redirectedOffSearch` → 不可用（搜索被重定向到主页，非真实镜像）
   115–117   `code !in 200..299` → 不可用（HTTP $code）
   118–125   the five Cloudflare-challenge markers (`Verifying your browser` /
 *              `Checking your browser` / `Just a moment` / `solve this captcha` / `cpt.lib`)
 *              → 需验证（无法自动搜索）
   126–143   `ZLibraryParserManager.parseSearchPage` + the relevance check, with the
 *              four verdicts 可用（搜索到 N 本） / 不可用（结果与关键词无关，疑似主页充数） /
 *              可用（页面可打开） / 可用（站点可达） / 不可用（无搜索结果）
              → in the probe (keyword 三体 verbatim).
   145–162   the WebView fallback for 不可用 / 需验证.
   163–177   the catch branch.
   179–182   `if (testingNode == node) { statuses[node] = result; testingNode = null }`
              → the page-side wrapper.
   186–190 `fun selectNode(node)` — `ZLibraryNodeManager.selectNode` + toast
              "已切换到 $node" → `onSelect` + `showToast`.
   192–194 `val defaultNode = ZLibraryNodeManager.DEFAULT_NODE`,
              `builtinNodes = (listOf(defaultNode) + scrapedNodes).distinct()`,
              `customNodeList = customNodes.filterNot { it in builtinNodes }`
              → the `ZLibraryNodeStore` interface + the same expressions.
   196–211 the AnimatedVisibility wrapper.
   212–226 `Scaffold(topBar = { TopAppBar(title = { Text("节点管理", Bold) },
              navigationIcon = { AppIconButton(onClick = onBack) { Icon(ArrowBack, "返回") } },
              colors = topAppBarColors(containerColor = surface) })`
              → a header row (`.zlib-node-bar`) reusing `.source-mgmt-header`.
   227–235 `LazyColumn(fillMaxSize, padding(innerPadding), padding(horizontal 16),
              imePadding, spacedBy 12, contentPadding vertical 16)` → a scroll container.
   236–282 item 1 — the "当前节点：$selectedNode" card with the 扒取节点 `AppActionButton`
              (Primary/Medium/Refresh icon, `enabled = !scraping`, `loading = scraping`,
              text "扒取中…" while scraping) and the explanatory line
              "从 zlib.wwkejishe.top 抓取全部官方入口（优先尝试/备用/中文），检测后点"使用"切换，立即生效。"
              → verbatim.
   284–291 item 2 — "节点列表" 14.sp Bold primary.
   293–318 `items(builtinNodes, key = { it })` with the four-way `label`
              (默认节点 / 已验证可用 / 硬挑战·留池 for `z-lib.sk` / 导航站节点),
              `isDefault`, `verifiedLive = node in ZLibraryNodeManager.VERIFIED_LIVE_NODES`,
              `status = statuses[node] ?: "未测试"` and a `canDelete = false` NodeCard.
   320–328 item 3 — the "自定义节点" heading (with an 8.dp spacer).
   330–347 `items(customNodeList, key = { it })` with `canDelete = true`.
   349–378 item 4 — the custom-domain `OutlinedTextField` + "添加" button; on success
              `AppToast "已添加自定义节点"`, on failure "请输入有效的域名".
   383–416 the replace-confirm `AlertDialog`: title "找到 ${foundNodes.size} 个节点",
              text "是否合并以下节点？（内置已验证节点会保留）" + "•  $node" rows,
              confirm "合并" (Primary/Small) + `AppToast "已合并节点"`, dismiss "取消".
   419–515 `private fun NodeCard(node, label, isSelected, status, isTesting, canDelete,
              onTest, onSelect, onDelete)`:
   431–432   `isOk = status.startsWith("可用") || status.startsWith("站点可达")`;
              `isFail = status == "不可用" || status.startsWith("需验证") || status == "初始化失败"`
              → verbatim predicates.
   433–444   the Card with the four-way container color
              (selected MintPrimary@0.15 / isOk MintPrimary@0.10 / isFail errorContainer@0.35 /
               else surfaceVariant).
   446–485   the node row: bold 15.sp name, the "当前使用" pill (MintPrimary@0.2, r8),
              the status line with the spinner / CheckCircle / ErrorOutline icon and
              `"$label · $status"` 12.sp onSurfaceVariant.
   486–512   the action row: "检测" (Secondary/Small/PlayArrow, `enabled = !isTesting`),
              "使用中" / "使用" (Secondary/Small), and the delete `AppIconButton`.
 *
 * Skipped: the raw HTTP/cookie/WebView plumbing. It is Android-specific
 * (`ZLibraryHttpClient`, `ZLibraryCredentialStorage`, `ZLibraryWebViewHelper`,
 * `ZLibraryParserManager`, `ZLibraryNodeManager` all live in
 * `com.example.source.zlibrary.*`, which is not part of Module D). It is declared as
 * the injected `ZLibraryNodeStore` / `ZLibraryNodeProbe` interfaces below — every
 * verdict string, threshold and marker stays in the same file so the logic is
 * auditable once the platform implements the two interfaces.
 */

import { useEffect, useState } from 'react';
import { AppButton } from '@ui/components/AppButton';
import { showToast } from '@ui/toast';
import '../../../styles/sources.css';
import '../../../styles/favorite.css';

/* ═══════════════════════════════════════════════════════════════════════
 * Injected platform interfaces (Android `com.example.library.ZLibraryNodeManager`
 * + `com.example.source.zlibrary.*`). Declared, not implemented.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Kotlin `ZLibraryNodeManager` persistence + node table. */
export interface ZLibraryNodeStore {
  readonly DEFAULT_NODE: string;
  readonly VERIFIED_LIVE_NODES: ReadonlyArray<string>;
  getScrapedNodes(): Promise<string[]>;
  saveScrapedNodes(nodes: string[]): Promise<void>;
  getCustomNodes(): Promise<string[]>;
  addCustomNode(domain: string): Promise<boolean>;
  removeCustomNode(domain: string): Promise<void>;
  getSelectedNode(): Promise<string>;
  selectNode(node: string): Promise<void>;
  /** Kotlin `ZLibraryNodeManager.scrapeNodes(context)` — pulls the official entry list. */
  scrapeNodes(): Promise<string[]>;
}

/** Kotlin `ZLibraryHttpClient` + `ZLibraryParserManager` + `ZLibraryWebViewHelper`. */
export interface ZLibraryNodeProbe {
  /** Real search: `https://$node/s/${encodeURIComponent(keyword)}` with a `referer`. */
  search(node: string, keyword: string): Promise<ZLibraryProbeResult>;
  /** Kotlin `ZLibraryWebViewHelper.searchViaWebView(context, node, keyword, cookies)`. */
  searchViaWebView(node: string, keyword: string): Promise<ZLibraryWebViewResult>;
}

export interface ZLibraryProbeResult {
  httpStatus: number;
  /** `response.request.url.encodedPath` — the post-redirect path. */
  finalPath: string;
  html: string;
  /** `ZLibraryParserManager.parseSearchPage` output. */
  books: ReadonlyArray<{ title: string }>;
}

export interface ZLibraryWebViewResult {
  books: ReadonlyArray<{ title: string }>;
  pageHasZlibMarkers: boolean;
  stillChallenged: boolean;
}

/** The search keyword the Android probe uses — 三体, verbatim. */
export const NODE_PROBE_KEYWORD = '三体';

/** The list of "does this HTML page look like a real search result" markers (L136–140). */
const RESULT_MARKERS = ['/book/', 'z-bookcard', 'resItemBox', 'book-item'] as const;

/** The Cloudflare / challenge markers (L118–122) — verbatim. */
const CHALLENGE_MARKERS = [
  'Verifying your browser',
  'Checking your browser',
  'Just a moment',
  'solve this captcha',
  'cpt.lib',
] as const;

/** Kotlin L175 — `e.message?.take(40) ?: "连接失败"`. */
function errorMessage(raw: string | undefined): string {
  const text = (raw ?? '连接失败').slice(0, 40);
  return text === '' ? '连接失败' : text;
}

/**
 * The full reachability verdict for one node — Kotlin L85–177.
 * Returns the same strings the Android screen writes into `statuses[node]`.
 */
export async function probeNodeStatus(
  probe: ZLibraryNodeProbe,
  node: string,
): Promise<string> {
  const keyword = NODE_PROBE_KEYWORD;
  let httpResult: string;
  try {
    const r = await probe.search(node, keyword);
    const html = r.html;
    // 修复"搜索出40本"假通过：入口跳转域会把 /s/{kw} 302 丢路径跳到主页，
    // 主页书卡片被当搜索结果充数。真实搜索 ① 最终 URL 仍在 /s/
    // ② 结果与关键词相关（命中书名含"三体"）。
    const redirectedOffSearch = !r.finalPath.startsWith('/s/');

    // 官网搜索服务故障：节点本身可达但搜索不可用。
    // 此时不算"不可用"，也不再走 WebView 兜底（只会浪费 ~36s 后同样失败）。
    if (html.toLowerCase().includes('search service temporary unavailable')) {
      return '站点可达，搜索服务暂不可用（官网故障）';
    }
    // 重定向丢路径：搜索请求根本没到搜索服务，主页书卡不算数
    if (redirectedOffSearch) {
      return '不可用（搜索被重定向到主页，非真实镜像）';
    }

    if (r.httpStatus < 200 || r.httpStatus > 299) {
      httpResult = `不可用（HTTP ${String(r.httpStatus)}）`;
    } else if (CHALLENGE_MARKERS.some((m) => html.toLowerCase().includes(m.toLowerCase()))) {
      httpResult = '需验证（无法自动搜索）';
    } else {
      // 关键词相关性校验：真实搜索结果必然含命中书名
      const relevant =
        r.books.length > 0 && (html.includes(keyword) || r.books.some((b) => b.title.includes(keyword)));
      if (r.books.length > 0 && relevant) {
        httpResult = `可用（搜索到 ${String(r.books.length)} 本）`;
      } else if (r.books.length > 0) {
        httpResult = '不可用（结果与关键词无关，疑似主页充数）';
      } else if (RESULT_MARKERS.some((m) => html.includes(m))) {
        httpResult = '可用（页面可打开）';
      } else if (html.toLowerCase().includes('z-library')) {
        httpResult = '可用（站点可达）';
      } else {
        httpResult = '不可用（无搜索结果）';
      }
    }

    // 仅"不可用 / 需验证"才尝试 WebView（挑战/JS 渲染场景），
    // "搜索服务暂不可用"直接返回，不再浪费 WebView 超时。
    if (httpResult.startsWith('不可用') || httpResult.startsWith('需验证')) {
      const web = await probe.searchViaWebView(node, keyword);
      if (web.books.length > 0) return `可用（搜索到 ${String(web.books.length)} 本）`;
      if (web.pageHasZlibMarkers) return '可用（页面可打开）';
      if (web.stillChallenged) return '需验证（无法自动搜索）';
      return httpResult;
    }
    return httpResult;
  } catch (e) {
    const web = await probe.searchViaWebView(node, keyword);
    if (web.books.length > 0) return `可用（搜索到 ${String(web.books.length)} 本）`;
    if (web.pageHasZlibMarkers) return '可用（页面可打开）';
    return `不可用（${errorMessage(e instanceof Error ? e.message : undefined)}）`;
  }
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M17.65 6.35A7.96 7.96 0 0012 4a8 8 0 108 8h-2a6 6 0 11-6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function IconDelete() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z" />
    </svg>
  );
}

function IconErrorOutline() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M11 15h2v2h-2zm0-8h2v6h-2zm0.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20a8 8 0 110-16 8 8 0 010 16z" />
    </svg>
  );
}

function IconArrowBack() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

/** NodeCard — Kotlin L419–515. */
function NodeCard(props: {
  node: string;
  label: string;
  isSelected: boolean;
  status: string;
  isTesting: boolean;
  canDelete: boolean;
  onTest: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const status = props.status;
  const isOk = status.startsWith('可用') || status.startsWith('站点可达');
  const isFail = status === '不可用' || status.startsWith('需验证') || status === '初始化失败';
  return (
    <div
      className={
        props.isSelected
          ? 'zlib-node-card zlib-node-card--selected'
          : isOk
            ? 'zlib-node-card zlib-node-card--ok'
            : isFail
              ? 'zlib-node-card zlib-node-card--fail'
              : 'zlib-node-card'
      }
    >
      <div className="zlib-node-card__head">
        <p className="zlib-node-card__name">{props.node}</p>
        {props.isSelected ? <span className="zlib-node-card__current">当前使用</span> : null}
      </div>
      <p className="zlib-node-card__status">
        {props.isTesting ? (
          <span className="fav-spinner" style={{ width: 14, height: 14 }} aria-hidden="true" />
        ) : isOk ? (
          <IconCheckCircle />
        ) : isFail ? (
          <IconErrorOutline />
        ) : null}
        {`${props.label} · ${status}`}
      </p>
      <div className="zlib-node-card__actions">
        <AppButton
          size="sm"
          variant="secondary"
          disabled={props.isTesting}
          onClick={props.onTest}
          icon={<IconPlay />}
        >
          检测
        </AppButton>
        <AppButton size="sm" variant="secondary" onClick={props.onSelect}>
          {props.isSelected ? '使用中' : '使用'}
        </AppButton>
        {props.canDelete ? (
          <button
            type="button"
            className="zlib-node-card__delete"
            aria-label="删除节点"
            onClick={props.onDelete}
          >
            <IconDelete />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Z-Library 节点管理窗口：
 * - 默认节点（1lib.sk）+ 官网/备用入口三个节点 + 用户自定义节点；
 * - 每个节点可“检测”（真实搜索“三体”并解析）；
 * - “扒取节点”按钮抓取官方入口列表，确认后替换；
 * - 切换节点立即生效并持久化。
 */
export function ZLibraryNodeManagementScreen(props: {
  onBack: () => void;
  /** Injected `ZLibraryNodeManager`. */
  store: ZLibraryNodeStore;
  /** Injected `ZLibraryHttpClient` / parser / WebView helper. */
  probe: ZLibraryNodeProbe;
}) {
  const [scrapedNodes, setScrapedNodes] = useState<string[]>([]);
  const [customNodes, setCustomNodes] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [scraping, setScraping] = useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [foundNodes, setFoundNodes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [testingNode, setTestingNode] = useState<string | null>(null);

  // Kotlin L70–72 — the three `remember { mutableStateOf(ZLibraryNodeManager.get…) }`
  // fields read the persisted node table on the FIRST composition, so the screen already
  // shows 当前节点 / 已抓取节点 / 自定义节点 when it appears. `props.store` is the async
  // port for that, so the same initial read is a mount effect (guarded against unmount).
  const store = props.store;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [scraped, custom, selected] = await Promise.all([
        store.getScrapedNodes(),
        store.getCustomNodes(),
        store.getSelectedNode(),
      ]);
      if (cancelled) return;
      setScrapedNodes(scraped);
      setCustomNodes(custom);
      setSelectedNode(selected);
    })().catch(() => {
      // Kotlin 的三个 getter 不会抛；端口实现失败时保留空态，不让整页崩掉。
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const defaultNode = props.store.DEFAULT_NODE;
  const builtinNodes = [...new Set([defaultNode, ...scrapedNodes])];
  const customNodeList = customNodes.filter((it) => !builtinNodes.includes(it));

  const testNode = (node: string): void => {
    if (testingNode !== null) return;
    setTestingNode(node);
    setStatuses((prev) => ({ ...prev, [node]: '测试中…' }));
    void probeNodeStatus(props.probe, node).then((result) => {
      setStatuses((prev) => ({ ...prev, [node]: result }));
      setTestingNode((cur) => (cur === node ? null : cur));
    });
  };

  const selectNode = (node: string): void => {
    void props.store.selectNode(node).then(() => {
      setSelectedNode(node);
      showToast(`已切换到 ${node}`);
    });
  };

  const labelOf = (node: string): string => {
    if (node === defaultNode) return '默认节点';
    if (props.store.VERIFIED_LIVE_NODES.includes(node)) return '已验证可用';
    if (node === 'z-lib.sk') return '硬挑战·留池';
    return '导航站节点';
  };

  return (
    <div className="zlib-node-screen source-mgmt">
      {/* L212–226: Scaffold + TopAppBar("节点管理", ArrowBack) */}
      <header className="source-mgmt-header zlib-node-bar">
        <button
          type="button"
          className="source-mgmt-back-btn"
          onClick={props.onBack}
          aria-label="返回"
        >
          <IconArrowBack />
        </button>
        <h1 className="source-mgmt-title">节点管理</h1>
      </header>

      <div className="zlib-node-scroll">
        {/* L236–282: the current-node card */}
        <div className="zlib-node-card zlib-node-card--info">
          <div className="zlib-node-card__head">
            <p className="zlib-node-card__name">{`当前节点：${selectedNode}`}</p>
            <AppButton
              size="md"
              variant="primary"
              disabled={scraping}
              onClick={() => {
                setScraping(true);
                void props.store
                  .scrapeNodes()
                  .then((nodes) => {
                    if (nodes.length > 0) {
                      setFoundNodes(nodes);
                      setShowReplaceDialog(true);
                    } else {
                      showToast('扒取失败，请检查网络后重试');
                    }
                  })
                  .finally(() => setScraping(false));
              }}
              icon={<IconRefresh />}
            >
              {scraping ? '扒取中…' : '扒取节点'}
            </AppButton>
          </div>
          <p className="zlib-node-card__hint">
            从 zlib.wwkejishe.top 抓取全部官方入口（优先尝试/备用/中文），检测后点“使用”切换，立即生效。
          </p>
        </div>

        {/* L284–291 */}
        <h2 className="zlib-node-section">节点列表</h2>
        {builtinNodes.map((node) => (
          <NodeCard
            key={node}
            node={node}
            label={labelOf(node)}
            isSelected={selectedNode === node}
            status={statuses[node] ?? '未测试'}
            isTesting={testingNode === node}
            canDelete={false}
            onTest={() => testNode(node)}
            onSelect={() => selectNode(node)}
            onDelete={() => {
              void props.store.removeCustomNode(node).then(() => {
                void props.store.getCustomNodes().then(setCustomNodes);
                void props.store.getSelectedNode().then(setSelectedNode);
                setStatuses((prev) => {
                  const next = { ...prev };
                  delete next[node];
                  return next;
                });
              });
            }}
          />
        ))}

        {/* L320–328 */}
        <h2 className="zlib-node-section">自定义节点</h2>
        {customNodeList.map((node) => (
          <NodeCard
            key={node}
            node={node}
            label="自定义节点"
            isSelected={selectedNode === node}
            status={statuses[node] ?? '未测试'}
            isTesting={testingNode === node}
            canDelete={true}
            onTest={() => testNode(node)}
            onSelect={() => selectNode(node)}
            onDelete={() => {
              void props.store.removeCustomNode(node).then(() => {
                void props.store.getCustomNodes().then(setCustomNodes);
                void props.store.getSelectedNode().then(setSelectedNode);
                setStatuses((prev) => {
                  const next = { ...prev };
                  delete next[node];
                  return next;
                });
              });
            }}
          />
        ))}

        {/* L349–378: custom-domain entry */}
        <div className="zlib-node-add">
          <input
            className="source-mgmt-modal-field"
            value={customInput}
            onChange={(event) => setCustomInput(event.target.value)}
            placeholder="自定义节点域名"
            aria-label="自定义节点域名"
          />
          <AppButton
            size="sm"
            variant="secondary"
            onClick={() => {
              void props.store.addCustomNode(customInput).then((ok) => {
                if (ok) {
                  void props.store.getCustomNodes().then(setCustomNodes);
                  setCustomInput('');
                  showToast('已添加自定义节点');
                } else {
                  showToast('请输入有效的域名');
                }
              });
            }}
            icon={<IconAdd />}
          >
            添加
          </AppButton>
        </div>
      </div>

      {/* L383–416: the replace-confirm dialog */}
      {showReplaceDialog ? (
        <div className="source-mgmt-modal-backdrop" onClick={() => setShowReplaceDialog(false)}>
          <div className="source-mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="source-mgmt-modal-title">{`找到 ${String(foundNodes.length)} 个节点`}</h3>
            <p className="source-mgmt-modal-desc">是否合并以下节点？（内置已验证节点会保留）</p>
            <div className="source-mgmt-modal-list">
              {foundNodes.map((node) => (
                <p key={node} style={{ margin: 0, fontWeight: 500 }}>
                  {`•  ${node}`}
                </p>
              ))}
            </div>
            <div className="source-mgmt-modal-actions">
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--ghost"
                onClick={() => setShowReplaceDialog(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="source-mgmt-modal-btn source-mgmt-modal-btn--primary"
                onClick={() => {
                  void props.store.saveScrapedNodes(foundNodes).then(() => {
                    void props.store.getScrapedNodes().then(setScrapedNodes);
                    setShowReplaceDialog(false);
                    showToast('已合并节点');
                  });
                }}
              >
                合并
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
