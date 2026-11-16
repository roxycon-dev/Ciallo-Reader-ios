/**
 * `ui/components/PullOutHosts.kt`（436 行）二轮复核的回归网。
 *
 * 首轮审计把这个文件判成「Android 内 0 引用 / 两侧同为死代码」，那是错的：
 * 排除定义文件后，`rememberPaperClose` 4、`rememberPaperHandoff` 2、`paperOpen` 10、
 * `openPaperPage` 21、`replacePaperPage` 2、`dismissPaperPage` 22 —— 它是全站导航与
 * 弹窗的转场宿主（详见 `docs/PARITY_EXCEPTIONS.md` E111 与「2026-11-16 复核补记」第 5 节）。
 *
 * 本文件分四段：
 *   ① GAP → 已补：常量 / 时序逐条对 Kotlin 权威（直接读 `.kt` 文本，不靠转写）；
 *   ② GAP → 已补：状态机（claim / freeze / close / handoff / dismissPaperLayer）；
 *   ③ EQUIVALENT 抽查：落点文件存在且导出对应符号；
 *   ④ 文档断言：首轮的错误结论已从登记表里消失，更正记录已写入。
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { androidReference } from '../helpers/androidReference';
import {
  PAPER_TRANSITION_CONFIG,
  paperLayerDepth,
  registerPaperLayer,
  resetPaperLayers,
  topPaperLayerKey,
  dismissPaperLayer,
  type PaperTransitionResult,
} from '@ui/shared/paperPageTransition';
import {
  PAPER_SHEET_DRAG_STYLE,
  PAPER_VISIBLE_TARGET_SETTLED,
  PULL_OUT_DISMISS_DISTANCE,
  PULL_OUT_DRAG_TRAVEL,
  PULL_OUT_RETURN_DEPTH,
  PULL_OUT_SCRIM,
  PULL_OUT_SOURCE_LIFETIME_MS,
  PULL_OUT_SPRING,
  PaperButtonActionContext,
  PaperLayerContext,
  PaperSource,
  activatePaperSource,
  claimPaperSource,
  createPaperCloseController,
  createPaperDisposalQueue,
  createPaperHandoffController,
  isPaperOpenAction,
  latestPaperSource,
  paperBackdropProgress,
  paperOpenAction,
  paperOpenOptions,
  paperPageDirectionSpec,
  paperPageRevealSpec,
  paperReplaceOptions,
  PAPER_PAGE_COVERED_FRACTION,
  PAPER_PAGE_EASE,
  resetPaperSources,
  type PaperRect,
} from '@ui/shared/pullOutHosts';

/* ══════════════════════════════════════════════════════════════════════════════
 * Kotlin 权威（只读）。与 `tests/unit/backupKotlinAuthority.test.ts` 同一手法：
 * 断言直接对着源码文本，任何一侧漂移都会红。
 * ══════════════════════════════════════════════════════════════════════════════ */

const PULL_OUT_MOTION_KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/PullOutMotion.kt'),
  'utf8',
);
const PULL_OUT_HOSTS_KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/PullOutHosts.kt'),
  'utf8',
);

const MAIN_ACTIVITY_KT = readFileSync(
  androidReference('app/src/main/java/com/example/MainActivity.kt'),
  'utf8',
);
const WENKU_PAGE_ENTRANCE_KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/WenkuPageEntrance.kt'),
  'utf8',
);

const repoRoot = process.cwd();

function sourceText(relative: string): string {
  return readFileSync(`${repoRoot}/${relative}`, 'utf8');
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const rect = (left: number, top: number, width: number, height: number): PaperRect => ({
  left,
  top,
  width,
  height,
});

afterEach(() => {
  resetPaperSources();
  resetPaperLayers();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ① 常量与曲线：GAP → 已补（PullOutConfig / paperBackdropProgress / 弹簧）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('PullOutConfig 常量（PullOutMotion.kt L25-59）', () => {
  it('SCRIM / DISMISS_DISTANCE / DRAG_TRAVEL / SOURCE_LIFETIME_MS 逐值一致', () => {
    expect(PULL_OUT_MOTION_KT).toContain('const val SCRIM = .35f');
    expect(PULL_OUT_MOTION_KT).toContain('const val DISMISS_DISTANCE = 64f');
    expect(PULL_OUT_MOTION_KT).toContain('const val DRAG_TRAVEL = 300f');
    expect(PULL_OUT_MOTION_KT).toContain('const val SOURCE_LIFETIME_MS = 900L');

    expect(PULL_OUT_SCRIM).toBe(0.35);
    expect(PULL_OUT_DISMISS_DISTANCE).toBe(64);
    expect(PULL_OUT_DRAG_TRAVEL).toBe(300);
    expect(PULL_OUT_SOURCE_LIFETIME_MS).toBe(900);
    // 遮罩与整页弹簧是同一个数：paperPageTransition 的 scrim 也必须同步。
    expect(PAPER_TRANSITION_CONFIG.scrim).toBe(PULL_OUT_SCRIM);
  });

  it('弹簧系数取自 PAPER_TRANSITION_CONFIG（OPEN 140/24、CLOSE 260/34）', () => {
    expect(PULL_OUT_MOTION_KT).toContain('const val OPEN_K = 140f');
    expect(PULL_OUT_MOTION_KT).toContain('const val OPEN_D = 24f');
    expect(PULL_OUT_MOTION_KT).toContain('const val CLOSE_K = 260f');
    expect(PULL_OUT_MOTION_KT).toContain('const val CLOSE_D = 34f');

    expect(PULL_OUT_SPRING).toEqual({
      openStiffness: 140,
      openDamping: 24,
      closeStiffness: 260,
      closeDamping: 34,
    });
    expect(PULL_OUT_SPRING.openStiffness).toBe(PAPER_TRANSITION_CONFIG.openStiffness);
    expect(PULL_OUT_SPRING.closeDamping).toBe(PAPER_TRANSITION_CONFIG.closeDamping);
  });

  it('paperBackdropProgress = 端点平滑 p*p*(3-2p)（PullOutMotion.kt L97-100）', () => {
    expect(PULL_OUT_MOTION_KT).toContain('return p * p * (3f - 2f * p)');
    expect(paperBackdropProgress(0)).toBe(0);
    expect(paperBackdropProgress(0.5)).toBeCloseTo(0.5, 12);
    expect(paperBackdropProgress(1)).toBe(1);
    expect(paperBackdropProgress(-1)).toBe(0);
    expect(paperBackdropProgress(2)).toBe(1);
    // 线性进度在 0.25 处是 0.25，端点平滑后必须更慢（0.15625）。
    expect(paperBackdropProgress(0.25)).toBeCloseTo(0.15625, 12);
  });

  it('LocalPaperVisibleTarget 默认 1；LocalPaperSheetDrag 的 Web 落点是 touch-action:none', () => {
    expect(PULL_OUT_HOSTS_KT).toContain('internal val LocalPaperVisibleTarget = compositionLocalOf { 1f }');
    expect(PULL_OUT_HOSTS_KT).toContain('private val LocalPaperSheetDrag = compositionLocalOf<Modifier> { Modifier }');
    expect(PAPER_VISIBLE_TARGET_SETTLED).toBe(1);
    expect(PAPER_SHEET_DRAG_STYLE).toEqual({ touchAction: 'none' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ② 来源表：PullOutSource / PullOutSources（PullOutMotion.kt L61-92）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('PaperSource / claimPaperSource', () => {
  it('claim 的四个判据：几何非零、未领过、≤900ms、frozenOpening 短路', () => {
    expect(PULL_OUT_MOTION_KT).toContain('if (it.frozenOpening) it else it.returnSource()');
    expect(PULL_OUT_MOTION_KT).toContain('android.os.SystemClock.uptimeMillis() - it.activatedAt <= PullOutConfig.SOURCE_LIFETIME_MS');

    const source = new PaperSource({ bounds: rect(10, 20, 40, 40) });
    activatePaperSource(source, 1_000);
    expect(latestPaperSource()).toBe(source);
    // 900ms 整仍然有效（Kotlin 是 `<=`）。
    expect(claimPaperSource(1_900)).toBe(source);
    // 领过一次就没了。
    expect(claimPaperSource(1_900)).toBeNull();

    const expired = new PaperSource({ bounds: rect(10, 20, 40, 40) });
    activatePaperSource(expired, 1_000);
    expect(claimPaperSource(1_901)).toBeNull();

    const flat = new PaperSource({ bounds: rect(0, 0, 0, 40) });
    activatePaperSource(flat, 1_000);
    expect(claimPaperSource(1_000)).toBeNull();

    const frozen = new PaperSource({ bounds: rect(4, 4, 12, 12) });
    frozen.frozenOpening = true;
    activatePaperSource(frozen, 1_000);
    expect(claimPaperSource(1_000)).toBe(frozen);
  });

  it('freezeForHandoff 拷几何 + 置 disposed/frozenOpening + 预先算好 parent（不回原对象）', () => {
    expect(PULL_OUT_MOTION_KT).toContain('snapshot.parent = parent?.returnSource() ?: returnSource()');
    expect(PULL_OUT_MOTION_KT).toContain('snapshot.disposed = true; snapshot.frozenOpening = true');

    const grandParent = new PaperSource({ bounds: rect(1, 1, 8, 8) });
    const disposedParent = new PaperSource({ bounds: rect(2, 2, 16, 16), parent: grandParent });
    disposedParent.disposed = true;
    const trigger = new PaperSource({ bounds: rect(30, 40, 60, 24), parent: disposedParent });

    const snapshot = trigger.freezeForHandoff();
    expect(snapshot).not.toBe(trigger);
    expect(snapshot.bounds).toEqual(rect(30, 40, 60, 24));
    expect(snapshot.disposed).toBe(true);
    expect(snapshot.frozenOpening).toBe(true);
    // parent 是「退回后仍然活着的那个」：disposed 的 parent 被跳过，落到 grandParent。
    expect(snapshot.parent).toBe(grandParent);
    // 原对象不被改动。
    expect(trigger.disposed).toBe(false);
    expect(trigger.frozenOpening).toBe(false);
  });

  it('returnSource 最多回溯 8 层、virtual 直接返回、不回到自己', () => {
    expect(PULL_OUT_MOTION_KT).toContain('repeat(8)');
    expect(PULL_OUT_MOTION_KT).toContain('if (next === this) return origin');
    expect(PULL_OUT_RETURN_DEPTH).toBe(8);

    // 9 个全 disposed 的来源串成链：8 跳之后停在链尾，不会无限回溯。
    let tail = new PaperSource({ bounds: rect(0, 0, 1, 1) });
    tail.disposed = true;
    const chain: PaperSource[] = [];
    for (let index = 0; index < 9; index += 1) {
      const next = new PaperSource({ bounds: rect(0, 0, 1, 1), parent: tail });
      next.disposed = true;
      chain.push(next);
      tail = next;
    }
    const head = chain[chain.length - 1];
    expect(head).toBeDefined();
    expect(head?.returnSource()).toBe(chain[0]);

    const virtual = new PaperSource({ bounds: rect(0, 0, 4, 4), virtual: true });
    virtual.disposed = true;
    expect(virtual.returnSource()).toBe(virtual);

    const self = new PaperSource({ bounds: rect(0, 0, 4, 4) });
    self.disposed = true;
    self.parent = self;
    expect(self.returnSource()).toBe(self);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ③ 关闭：dismissPaperPage / rememberPaperClose
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('dismissPaperLayer（NavController.dismissPaperPage 的等价层）', () => {
  it('空注册表返回 false；LIFO 关最上层；finished 之后才跑 action', async () => {
    expect(PULL_OUT_HOSTS_KT).toContain('fun NavController.dismissPaperPage() {');
    expect(dismissPaperLayer()).toBe(false);
    expect(paperLayerDepth()).toBe(0);

    const calls: string[] = [];
    const lower = deferred<PaperTransitionResult>();
    const upper = deferred<PaperTransitionResult>();
    registerPaperLayer({ key: 'sheet', close: () => lower.promise });
    registerPaperLayer({ key: 'dialog', close: () => upper.promise });
    expect(topPaperLayerKey()).toBe('dialog');

    expect(dismissPaperLayer(() => calls.push('dialog-closed'))).toBe(true);
    expect(calls).toEqual([]);
    upper.resolve('finished');
    await flush();
    expect(calls).toEqual(['dialog-closed']);
    // 下一层还在，下一轮才轮到它。
    expect(topPaperLayerKey()).toBe('dialog');
    lower.resolve('interrupted');
  });

  it('同一次退场里重复调用只顶替 action、不重启退场；interrupted 不执行', async () => {
    const calls: string[] = [];
    let closeCount = 0;
    const exit = deferred<PaperTransitionResult>();
    registerPaperLayer({
      key: 'inline',
      close: () => {
        closeCount += 1;
        return exit.promise;
      },
    });

    dismissPaperLayer(() => calls.push('first'));
    dismissPaperLayer(() => calls.push('second'));
    expect(closeCount).toBe(1);
    exit.resolve('interrupted');
    await flush();
    expect(calls).toEqual([]);

    const retry = deferred<PaperTransitionResult>();
    registerPaperLayer({ key: 'inline2', close: () => retry.promise });
    dismissPaperLayer(() => calls.push('third'));
    retry.resolve('finished');
    await flush();
    expect(calls).toEqual(['third']);
  });
});

describe('createPaperCloseController（rememberPaperClose, PullOutHosts.kt L44-81）', () => {
  it('退场 finished → 先 dismiss，再激活来源、再跑跟随动作', async () => {
    expect(PULL_OUT_HOSTS_KT).toContain('val action = pending; pending = null');
    expect(PULL_OUT_HOSTS_KT).toContain('if (action != null) life.origin?.returnSource()?.let(PullOutSources::activate)');

    const order: string[] = [];
    const exit = deferred<PaperTransitionResult>();
    const origin = new PaperSource({ bounds: rect(12, 34, 56, 18) });
    const controller = createPaperCloseController({
      isOpen: () => true,
      dismiss: () => order.push('dismiss'),
      requestExit: () => exit.promise,
      origin: () => origin,
    });

    controller.close(() => order.push('action'));
    expect(order).toEqual([]);
    expect(controller.pending).not.toBeNull();

    exit.resolve('finished');
    await flush();
    expect(order).toEqual(['dismiss', 'action']);
    expect(latestPaperSource()).toBe(origin);
  });

  it('interrupted 不跑跟随动作；未打开时整次调用被丢弃', async () => {
    expect(PULL_OUT_HOSTS_KT).toContain('if (state.targetState && !life.handingOff)');

    const order: string[] = [];
    const exit = deferred<PaperTransitionResult>();
    const controller = createPaperCloseController({
      isOpen: () => true,
      dismiss: () => order.push('dismiss'),
      requestExit: () => exit.promise,
      origin: () => null,
    });
    controller.close(() => order.push('action'));
    exit.resolve('interrupted');
    await flush();
    expect(order).toEqual([]);

    let exits = 0;
    const closed = createPaperCloseController({
      isOpen: () => false,
      dismiss: () => order.push('never'),
      requestExit: () => {
        exits += 1;
        return undefined;
      },
      origin: () => null,
    });
    closed.close(() => order.push('never-action'));
    expect(exits).toBe(0);
    expect(order).toEqual([]);
  });

  it('action === dismiss 时不入 pending（Kotlin takeUnless）；同步退场也会走完整完成路径', () => {
    expect(PULL_OUT_HOSTS_KT).toContain('pending = action.takeUnless { it === latest }');

    const order: string[] = [];
    const dismiss = (): void => {
      order.push('dismiss');
    };
    const controller = createPaperCloseController({
      isOpen: () => true,
      dismiss,
      requestExit: () => undefined,
      origin: () => null,
    });
    controller.close(dismiss);
    expect(controller.pending).toBeNull();
    expect(order).toEqual(['dismiss']);
  });

  it('handingOff 时关闭被忽略（前递交已接管）', () => {
    const order: string[] = [];
    let handingOff = true;
    const controller = createPaperCloseController({
      isOpen: () => true,
      dismiss: () => order.push('dismiss'),
      requestExit: () => {
        order.push('exit');
        return undefined;
      },
      origin: () => null,
      handingOff: () => handingOff,
    });
    controller.close(() => order.push('action'));
    expect(order).toEqual([]);
    handingOff = false;
    controller.close(() => order.push('action'));
    expect(order).toEqual(['exit', 'dismiss', 'action']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ④ 前递交：rememberPaperHandoff + WindowPaperFinalizer 的 afterDismiss 闸门
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('createPaperHandoffController（PullOutHosts.kt L87-112）', () => {
  it('claim + freeze 来源，等窗口销毁后才 forward；第二次调用被 handingOff 挡住', () => {
    expect(PULL_OUT_HOSTS_KT).toContain('val source = PullOutSources.claim()?.freezeForHandoff() ?: life.origin?.freezeForHandoff()');
    expect(PULL_OUT_HOSTS_KT).toContain('state.targetState = false; life.retained = false; life.closed = true');

    const order: string[] = [];
    const queue = createPaperDisposalQueue();
    const trigger = new PaperSource({ bounds: rect(20, 30, 44, 44) });
    // 用真实时钟激活：`claimPaperSource()` 默认按 `Date.now()` 判 900ms 寿命。
    activatePaperSource(trigger);
    let handingOff = false;

    const forward = createPaperHandoffController({
      isOpen: () => true,
      origin: () => null,
      forward: (action) => {
        order.push('forward');
        action();
      },
      retire: () => order.push('retire'),
      disposal: () => queue,
      handingOff: () => handingOff,
      beginHandoff: () => {
        handingOff = true;
      },
    });

    queue.attach();
    forward(() => order.push('action'));
    // 窗口还挂着：只退役，不前进。
    expect(order).toEqual(['retire']);
    queue.dispose();
    expect(order).toEqual(['retire', 'forward', 'action']);

    const snapshot = latestPaperSource();
    expect(snapshot).not.toBe(trigger);
    expect(snapshot?.frozenOpening).toBe(true);
    expect(snapshot?.disposed).toBe(true);

    forward(() => order.push('second'));
    expect(order).toEqual(['retire', 'forward', 'action']);
  });

  it('life.origin 兜底：没有可领来源时冻结打开这一层时的来源', () => {
    const order: string[] = [];
    const origin = new PaperSource({ bounds: rect(1, 2, 3, 4) });
    const forward = createPaperHandoffController({
      isOpen: () => true,
      origin: () => origin,
      forward: (action) => action(),
    });
    forward(() => order.push('action'));
    expect(order).toEqual(['action']);
    expect(latestPaperSource()?.bounds).toEqual(rect(1, 2, 3, 4));
    expect(latestPaperSource()?.frozenOpening).toBe(true);
  });

  it('createPaperDisposalQueue 是单槽（后写覆盖前写）且只 flush 一次', () => {
    const order: string[] = [];
    const queue = createPaperDisposalQueue();
    expect(queue.attached).toBe(false);
    queue.attach();
    queue.defer(() => order.push('first'));
    queue.defer(() => order.push('second'));
    queue.dispose();
    queue.dispose();
    expect(order).toEqual(['second']);
    expect(queue.attached).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ⑤ 导航参数 / Context 形态（openPaperPage / replacePaperPage / paperClick …）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('openPaperPage / replacePaperPage 的 NavOptions', () => {
  it('replace = popUpTo(outgoing){inclusive} + launchSingleTop；open = launchSingleTop', () => {
    expect(PULL_OUT_HOSTS_KT).toContain('fun NavController.openPaperPage(route: String) {');
    expect(PULL_OUT_HOSTS_KT).toContain('navigate(route) { launchSingleTop = true }');
    expect(PULL_OUT_HOSTS_KT).toContain('if (outgoing != null) popUpTo(outgoing) { inclusive = true }');
    expect(PULL_OUT_HOSTS_KT).toContain('val outgoing = currentDestination?.id');

    expect(paperOpenOptions()).toEqual({ launchSingleTop: true });
    expect(paperReplaceOptions('comic_chapters')).toEqual({
      popUpTo: 'comic_chapters',
      inclusive: true,
      launchSingleTop: true,
    });
  });

  it('LocalPaperButtonAction / LocalPaperHandoff 落到同一个 context；paperOpen 动作带 brand', () => {
    expect(PULL_OUT_HOSTS_KT).toContain('internal val LocalPaperButtonAction = compositionLocalOf<((() -> Unit) -> Unit)?> { null }');
    expect(PULL_OUT_HOSTS_KT).toContain('internal val LocalPaperHandoff = compositionLocalOf<((() -> Unit) -> Unit)?> { null }');
    expect(PULL_OUT_HOSTS_KT).toContain('if (action is PaperOpenAction) action()');

    expect(PaperButtonActionContext).toBe(PaperLayerContext);
    const action = paperOpenAction(() => undefined);
    expect(isPaperOpenAction(action)).toBe(true);
    expect(isPaperOpenAction(() => undefined)).toBe(false);
    expect(isPaperOpenAction(null)).toBe(false);
  });

  it('pullOutHosts.ts 导出全部补齐符号（GAP → 已补清单）', () => {
    const text = sourceText('src/ui/shared/pullOutHosts.ts');
    for (const symbol of [
      'export class PaperSource',
      'freezeForHandoff(): PaperSource',
      'returnSource(): PaperSource',
      'export function claimPaperSource(',
      'export function activatePaperSource(',
      'export function paperBackdropProgress(',
      'export function createPaperDisposalQueue(',
      'export function createPaperCloseController(',
      'export function createPaperHandoffController(',
      'export const PaperLayerContext',
      'export function usePaperDismiss(',
      'export function usePaperClick(',
      'export function usePaperOpen(',
      'export function usePaperOpen(',
      'export function usePaperVisibleTarget(',
      'export function usePaperSheetDragHandle(',
      'export function paperReplaceOptions(',
      'export function paperOpenOptions(',
      'export const PULL_OUT_SOURCE_LIFETIME_MS = 900;',
      'export const PULL_OUT_SCRIM = 0.35;',
    ]) {
      expect(text, `pullOutHosts.ts 缺少 ${symbol}`).toContain(symbol);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ⑥ EQUIVALENT 抽查：只核对落点文件存在且导出对应符号
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('EQUIVALENT 落点抽查', () => {
  it('openPaperPage → appStore.setRoute + NavStack.navigate（launchSingleTop / popUpTo）', () => {
    const store = sourceText('src/ui/state/appStore.ts');
    expect(store).toContain('setRoute: (route) => {');
    expect(store).toContain('if (current === route) return;');
    expect(store).toContain('changePaperRoute(current, route, commit);');

    const navigation = sourceText('src/core/app/navigation.ts');
    expect(navigation).toContain('export class NavStack {');
    expect(navigation).toContain('export const ROUTE_TRANSITIONS');
    expect(navigation).toContain('if (options.popUpTo !== undefined) {');
  });

  it('paperComposable / 整页宿主 → paperRouteHost.mountLibraryPaperRoute', () => {
    const host = sourceText('src/ui/shared/paperRouteHost.ts');
    expect(host).toContain('export function mountLibraryPaperRoute(');
    expect(host).toContain('export function closeLibraryPaperRoute(');
    expect(host).toContain('export function pruneLibraryPaperRoutes(');
  });

  it('rememberPaperClose 的既有等价写法（退场 finished 后才提交）仍在 DownloadCenter', () => {
    const center = sourceText('src/ui/components/library/DownloadCenter.tsx');
    expect(center).toContain('createPaperPageTransitionController');
    expect(center).toContain("result === 'finished' && !visibleRef.current");
    expect(center).toContain('onDismissComplete');
  });

  it('PullOutDropdownMenu / PullOutBottomSheet / PullOutAlertDialog → 玻璃宿主三件套', () => {
    expect(sourceText('src/ui/components/wenku/WenkuMenuHost.tsx')).toContain('export function WenkuMenuHost(');
    expect(sourceText('src/ui/components/wenku/WenkuActionSheet.tsx')).toContain('export function WenkuActionSheet(');
    expect(sourceText('src/ui/components/AcrylicDialog.tsx')).toContain('export function AcrylicDialog(');
    // PLATFORM：Android 的 setWindowAnimations(0)/setDimAmount(0) 在 Web 不存在，落点是 overlay div + CSS。
    expect(sourceText('src/ui/components/AcrylicDialog.tsx')).toContain('role="dialog" aria-modal="true"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ⑦ 文档：首轮错误结论已清除、更正记录已写入
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('docs/PARITY_EXCEPTIONS.md 登记更正', () => {
  it('「Android 内 0 引用」结论已不存在，且更正记录与 E111 已写入', () => {
    const doc = sourceText('docs/PARITY_EXCEPTIONS.md');
    expect(doc).not.toContain('Android 内 **0 引用**');
    expect(doc).not.toContain('两侧同为死代码，不移植');

    expect(doc).toContain('更正记录（2026-11-16 二轮复核）');
    expect(doc).toContain('| E111 |');
    expect(doc).toContain('Android 内 **4** 处');
    expect(doc).toContain('Android 内 **21** 处');
    expect(doc).toContain('Android 内 **22** 处');
    expect(doc).toContain('src/ui/shared/pullOutHosts.ts');
    expect(doc).toContain('dismissPaperLayer');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ⑧ 补正：paperPageEnter/Exit/PopEnter/PopExit 是 NavHost 默认转场，不是死代码
 *    （2026-11-16 二轮复核补正，见 PARITY_EXCEPTIONS 第 6 节）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('paperPage* 四向路由转场（PullOutHosts.kt L151-175）', () => {
  it('四个符号在 MainActivity 里都有调用点（NavHost 的四个 transition 参数）', () => {
    expect(MAIN_ACTIVITY_KT).toContain('paperPageEnter(navigationReduceMotion)');
    expect(MAIN_ACTIVITY_KT).toContain('paperPageExit(');
    expect(MAIN_ACTIVITY_KT).toContain('paperPagePopEnter(navigationReduceMotion)');
    expect(MAIN_ACTIVITY_KT).toContain('paperPagePopExit(navigationReduceMotion)');
    // 传它们的是 NavHost，不是 paperComposable（后者签名里只有 revealContent）。
    expect(MAIN_ACTIVITY_KT).toContain('enterTransition = {');
    expect(MAIN_ACTIVITY_KT).toContain('popExitTransition = {');
    expect(PULL_OUT_HOSTS_KT).toContain('revealContent: Boolean = false');
  });

  it('Kotlin 原文：pageEase + 420/420/320/320 + { it } / { -it / 3 }', () => {
    expect(PULL_OUT_HOSTS_KT).toContain('CubicBezierEasing(.18f, 1f, .04f, 1f)');
    const pullOutHostsLf = PULL_OUT_HOSTS_KT.replace(/\r\n/g, '\n');
    expect(pullOutHostsLf).toContain('slideInHorizontally(\n        animationSpec = androidx.compose.animation.core.tween(420, easing = pageEase)');
    expect(pullOutHostsLf).toContain('slideOutHorizontally(\n        animationSpec = androidx.compose.animation.core.tween(420, easing = pageEase)');
    expect(PULL_OUT_HOSTS_KT).toContain('{ -it / 3 }');
    expect(PULL_OUT_HOSTS_KT).toContain('tween(320');

    expect(PAPER_PAGE_EASE).toBe('cubic-bezier(0.18, 1, 0.04, 1)');
    expect(PAPER_PAGE_COVERED_FRACTION).toBeCloseTo(1 / 3, 12);

    // enter：从右边缘整幅滑入 → 原位。
    expect(paperPageDirectionSpec('enter')).toEqual({
      ms: 420,
      easing: PAPER_PAGE_EASE,
      fromFraction: 1,
      toFraction: 0,
    });
    // exit：被覆盖页左移三分之一。
    expect(paperPageDirectionSpec('exit')).toEqual({
      ms: 420,
      easing: PAPER_PAGE_EASE,
      fromFraction: 0,
      toFraction: -1 / 3,
    });
    // popEnter：从左侧三分之一回位。
    expect(paperPageDirectionSpec('popEnter')).toEqual({
      ms: 320,
      easing: PAPER_PAGE_EASE,
      fromFraction: -1 / 3,
      toFraction: 0,
    });
    // popExit：整幅退出到右侧。
    expect(paperPageDirectionSpec('popExit')).toEqual({
      ms: 320,
      easing: PAPER_PAGE_EASE,
      fromFraction: 0,
      toFraction: 1,
    });
  });

  it('revealContent → WenkuPageEntrance：首次呈现 + 420ms 线性 + decorativeMotion 闸门', () => {
    expect(WENKU_PAGE_ENTRANCE_KT).toContain('tween(WenkuMotion.ENTER_MS, easing = LinearEasing)');
    expect(WENKU_PAGE_ENTRANCE_KT).toContain('rememberSaveable { mutableStateOf(false) }');
    expect(WENKU_PAGE_ENTRANCE_KT).toContain('rememberWenkuAccessibility().decorativeMotion');
    expect(WENKU_PAGE_ENTRANCE_KT).toContain('WenkuContentClock(progress, content)');

    expect(paperPageRevealSpec()).toEqual({
      durationMs: 420,
      easing: 'linear',
      firstPresentationOnly: true,
      requiresDecorativeMotion: true,
    });
  });
});

describe('docs/PARITY_EXCEPTIONS.md 第 6 节（paperPage* 补正）', () => {
  it('旧的「死代码」结论已删净，逐值表与 iOS 现值已写入', () => {
    const doc = sourceText('docs/PARITY_EXCEPTIONS.md');
    expect(doc).not.toContain('这三条按「Android 侧死代码」处理');
    expect(doc).not.toContain('全树各只有 1 处命中（定义行）');
    expect(doc).not.toContain('iOS 不要照抄 420/320');

    expect(doc).toContain('### 6. `paperPage*` 四向路由转场');
    expect(doc).toContain('MainActivity.kt:629-662');
    expect(doc).toContain('paperPageDirectionSpec');
    expect(doc).toContain('DEFAULT_ROUTE_TRANSITION');
    expect(doc).toContain('viewTransitions.ts');
    expect(doc).toContain('WenkuPageEntrance');
    expect(doc).toContain('paperPageRevealSpec');
  });
});