/**
 * 主页渲染失败的 React 错误边界 — Android `HomeRenderRecovery` 的**捕获端**。
 *
 * Android 侧没有错误边界的概念：未捕获异常走 `Thread.setDefaultUncaughtExceptionHandler`
 * （E108 里由 `HomeRenderRecovery.onUncaught` 消费）。Web 的等价物有三条：
 *   1. React 错误边界（本文件）—— 绘制期抛出的异常，React 会卸载整棵树；
 *   2. `window` 的 `error` 事件 —— 边界之外的同步异常；
 *   3. `window` 的 `unhandledrejection` 事件 —— 异步/懒加载异常。
 * 2、3 在 `src/main.tsx` 里接到同一个 `onUncaught()`，三条路径的降级判定完全一致。
 *
 * 与 Android 的关键差别：Compose 里渲染异常 = 进程崩溃 → 下次冷启动才看到降级后的画质；
 * 浏览器里整棵树被卸载后**同一个文档还在**，所以边界必须自己给出一个可用的最小 UI
 * （否则就是白屏 —— 那正是 `docs/PARITY_EXCEPTIONS.md` E108 记的缺口），并且提示
 * 「已切换到极简画质」。「重新加载」= Android 的下次冷启动（`location.reload()`）。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { onUncaught as reportUncaughtFailure } from '@core/app/homeRenderRecovery';

export interface RenderRecoveryBoundaryProps {
  children: ReactNode;
  /**
   * 异常上报钩子。默认交给 `homeRenderRecovery.onUncaught`（内部还会再跑一次
   * `isRenderFailure` 判定窗口与画质，所以这里**不需要**预判）。
   * 测试注入 spy 用；生产不要传。
   */
  onUncaught?: (failure: unknown) => void;
}

export interface RenderRecoveryBoundaryState {
  failed: boolean;
}

/** Android 侧 `Toast.LENGTH_LONG` 语义的兜底：边界自己的提示常驻到用户点按钮。 */
function reloadPage(): void {
  try {
    window.location.reload();
  } catch {
    // 某些 WebView / 测试环境禁止 reload：保持回退 UI 可用，不要二次抛错。
  }
}

function defaultOnUncaught(failure: unknown): void {
  // 边界渲染路径不能等待 Promise：写库失败也不阻塞回退 UI（Android 同样忽略
  // `commit()` 的布尔返回值）。
  void reportUncaughtFailure(failure).catch(() => {
    /* 降级写库失败 → 保持当前画质，回退 UI 仍然可用 */
  });
}

export class RenderRecoveryBoundary extends Component<
  RenderRecoveryBoundaryProps,
  RenderRecoveryBoundaryState
> {
  override state: RenderRecoveryBoundaryState = { failed: false };

  /**
   * 渲染期异常 → 立刻切到回退 UI（React 要求这里必须是纯函数，不能有副作用，
   * 所以真正的上报放在 `componentDidCatch`）。
   */
  static getDerivedStateFromError(): RenderRecoveryBoundaryState {
    return { failed: true };
  }

  /** 对应 `HomeRenderRecovery.onUncaught(context, failure)`（Kotlin L23-32）。 */
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const handler = this.props.onUncaught ?? defaultOnUncaught;
    try {
      handler(error);
    } catch {
      // 上报本身出错不能再让边界抛第二次（会连回退 UI 一起卸载）。
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="startup-page" role="alert">
        <h1>主页渲染失败，已切换到极简画质</h1>
        <p>下次进入主页会自动使用极简画质，可在设置中调整画质。</p>
        <button type="button" onClick={reloadPage}>
          重新加载
        </button>
      </main>
    );
  }
}
