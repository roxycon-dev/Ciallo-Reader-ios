/**
 * `transfer/NearbyConnector.kt`（100 行 / 92 非空）→ `@core/transfer/nearbyConnector`。
 *
 * 为什么单独一个模块：`nearby.ts` 里那个 `NearbyConnector` 是**简化玩具版**，
 * 与原文差了一整套协商状态机。逐条对照（左 = Kotlin，右 = 旧端口）：
 *
 * | Kotlin | 旧端口 | 后果 |
 * |---|---|---|
 * | L40 `onStage(tr("正在建立附近网络"))` | `onStage('正在协商直连')` | **文案错**，且没走 `tr()` |
 * | L41-55 `withTimeout(negotiationMillis)` 包住**整段协商**（读现有组 → 移除 → `pauseDiscovery` → `connect` → 轮询到组出现） | 只有 `platform.connect` + 一个 `setTimeout` | 协商根本没实现，`connect` 成功回调一到就结束 |
 * | L43 `existing.members.any { it.equals(address, true) }` | 无 | 已建成的组被忽略，会白走一遍移除 + 重连 |
 * | L46 `action { platform.removeGroup(it) }; waitForRemoval()` | 无 | 旧组没断就发起新连接 |
 * | L47 `pauseDiscovery` | 接口有、**零调用** | 协商期间不暂停发现，可能同时冒出两个组 |
 * | L58-59 `TimeoutCancellationException` → 「附近网络未建立，系统连接请求已超时。可重新连接」 | `'附近直连超时'` | **文案错** |
 * | L61 其它异常 → `platform.cancelPending(); onError(e.message ?: "附近连接未能建立")` | 无 | 异常被吞，UI 停在「协商中」 |
 * | L65-71 `stop(disconnect = false)` | `stop()` 恒 `cancelPending()` | **语义错**：只想停轮询也会取消系统连接 |
 * | L72-83 `cancelConnection()` | 无 | 无「清理并恢复观察」这条路 |
 * | L84-86 `waitForRemoval()`：5 秒内没断开 → 「旧的附近网络尚未断开，请稍后重新连接」 | 无 | 旧组残留时新连接会连到旧组 |
 * | L87-89 `readGroup()`：`withTimeoutOrNull(1_500)` | 无超时 | 平台不回调时整条链永久挂起 |
 * | L90-92 `action()`：错误转 `IllegalStateException` | 无 | 平台错误被当成功 |
 * | L93-98 `watch()`：`readGroup()?.let(onGroup); pause()` | `setTimeout` 递归 + **多一个 `onStage('等待同网设备')`** | 原文 group 为 null 时**什么都不做**，端口凭空多一次回调 |
 * | L99 `pause() = withTimeoutOrNull(pollMillis){wake.receive()}`（CONFLATED） | 无 | `refresh()` 缺失 → 无法立即唤醒 |
 * | L32 `refresh()` | 无 | |
 * | L34 `job?.cancel()`（connect 开头） | 无 | 上一个观察循环不退出，两个循环同时 `onGroup` |
 *
 * 平台差异
 * ────────
 * - `CoroutineScope` / `Job` / `isActive` → `NearbyJobToken`（一个 `cancelled` 标志 + 取消监听）。
 *   每个 `await` 之后检查 `cancelled`，取消时抛 `NearbyCancelledError`（对应
 *   `CancellationException`），与 Kotlin 的协作式取消同构。
 * - `withTimeout` / `withTimeoutOrNull` → `withTimeout` / `withTimeoutOrNull`（本文件内），
 *   超时抛 `NearbyTimeoutError`（对应 `TimeoutCancellationException`）。
 * - `Channel(CONFLATED)` → `ConflatedSignal`：容量 1、新值覆盖旧值、`trySend` 不阻塞。
 * - `suspendCancellableCoroutine` → `resumeInto()`；`c.isActive` 对应令牌未取消。
 * - `SensorManager` 式的平台调用全部走注入的 `NearbyPlatform`（`group` / `pauseDiscovery` /
 *   `connect` / `removeGroup` / `cancelPending`），本模块不碰任何原生 API。
 */

import { tr } from '@core/i18n';

/** L23 `pollMillis: Long = 750`。 */
export const NEARBY_POLL_MS = 750;
/** L23 `negotiationMillis: Long = 35_000`。 */
export const NEARBY_NEGOTIATION_MS = 35_000;
/** L87 `withTimeoutOrNull(1_500)` —— 单次 `group` 查询的窗口。 */
export const NEARBY_READ_GROUP_TIMEOUT_MS = 1_500;
/** L85 `withTimeoutOrNull(5_000)` —— 等旧组断开。 */
export const NEARBY_WAIT_REMOVAL_TIMEOUT_MS = 5_000;

/** L40 `tr("正在建立附近网络")`。 */
export const NEARBY_STAGE_NEGOTIATING = '正在建立附近网络';
/** L30 `e.message ?: tr("附近连接状态读取失败")`。 */
export const NEARBY_ERROR_READ_FAILED = '附近连接状态读取失败';
/** L59 `tr("附近网络未建立，系统连接请求已超时。可重新连接")`。 */
export const NEARBY_ERROR_TIMEOUT = '附近网络未建立，系统连接请求已超时。可重新连接';
/** L61 / L85 `e.message ?: tr("附近连接未能建立")`。 */
export const NEARBY_ERROR_CONNECT_FAILED = '附近连接未能建立';
/** L81 `e.message ?: tr("附近网络清理失败")`。 */
export const NEARBY_ERROR_CLEANUP_FAILED = '附近网络清理失败';
/** L85 `tr("旧的附近网络尚未断开，请稍后重新连接")`。 */
export const NEARBY_ERROR_STALE_GROUP = '旧的附近网络尚未断开，请稍后重新连接';

/** L9 `data class NearbyGroup(owner, host, localAddress, members)`。 */
export interface NearbyGroup {
  readonly owner: boolean;
  readonly host: string;
  readonly localAddress: string | null;
  readonly members: ReadonlySet<string>;
}

/** L12-18 `interface NearbyPlatform`。 */
export interface NearbyPlatform {
  /** `getDefaultSensor` + `SensorManager` 的投影：回调可能永不触发（所以有 1.5 s 窗口）。 */
  group(callback: (group: NearbyGroup | null) => void): void;
  /** L47 `platform.pauseDiscovery { … }` —— 协商前暂停发现，避免同时冒出两个组。 */
  pauseDiscovery(callback: () => void): void;
  /** L48 `platform.connect(address, callback)` —— 回调参数是错误文案（`null` = 已发起）。 */
  connect(address: string, callback: (error: string | null) => void): void;
  removeGroup(callback: (error: string | null) => void): void;
  /** L35 / L59 / L61 / L68 / L74 `platform.cancelPending()`。 */
  cancelPending(): void;
}

/** `CancellationException` 的端口形态（协作式取消）。 */
export class NearbyCancelledError extends Error {
  constructor() {
    super('nearby connector cancelled');
    this.name = 'NearbyCancelledError';
  }
}

/** `TimeoutCancellationException` 的端口形态。 */
export class NearbyTimeoutError extends Error {
  constructor() {
    super('nearby connector timed out');
    this.name = 'NearbyTimeoutError';
  }
}

export function isNearbyCancelled(error: unknown): boolean {
  return error instanceof NearbyCancelledError;
}

export function isNearbyTimeout(error: unknown): boolean {
  return error instanceof NearbyTimeoutError;
}

/**
 * L43 `existing.members.any { it.equals(address, true) }` —— **大小写不敏感**。
 *
 * 用 `toLowerCase` 而不是 `===`：Android 的 `P2P` 地址在不同机型上大小写不一致，
 * 精确比较会让「已经建成同一组」被误判成「没建成」，于是白走一遍移除 + 重连。
 */
export function nearbyGroupContainsMember(group: NearbyGroup, address: string): boolean {
  const wanted = address.toLowerCase();
  for (const member of group.members) {
    if (member.toLowerCase() === wanted) return true;
  }
  return false;
}

/** `Job` 的替身：一个 `cancelled` 标志 + 取消回调。 */
export interface NearbyJobToken {
  readonly cancelled: boolean;
  cancel(): void;
  onCancel(listener: () => void): void;
}

function createJobToken(): NearbyJobToken {
  const listeners = new Set<() => void>();
  let cancelled = false;
  const token: NearbyJobToken = {
    get cancelled() {
      return cancelled;
    },
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      const pending = [...listeners];
      listeners.clear();
      for (const listener of pending) listener();
    },
    onCancel(listener: () => void): void {
      if (cancelled) listener();
      else listeners.add(listener);
    },
  };
  return token;
}

/**
 * `Channel(CONFLATED)`：容量 1、新值覆盖旧值、`trySend` 不阻塞。
 *
 * L27 `Channel<Unit>(Channel.CONFLATED)` + L32 `wake.trySend(Unit)` + L99 `wake.receive()`。
 * 注意 CONFLATED 的语义是「最多存一个待消费信号」—— 连点两次 `refresh()` 只会唤醒一次，
 * 这与 `Channel(1)` 不同（后者第二次 send 会挂起）。
 */
export class ConflatedSignal {
  private ready = false;

  private readonly waiters = new Set<() => void>();

  /** L32 `wake.trySend(Unit)` —— 永不阻塞、永不失败；有等待者就唤醒**一个**。 */
  trySend(): void {
    const first = this.waiters.values().next();
    if (!first.done) {
      this.waiters.delete(first.value);
      first.value();
      return;
    }
    this.ready = true;
  }

  /** 是否有未消费的信号（测试用）。 */
  get isSignalled(): boolean {
    return this.ready || this.waiters.size > 0;
  }

  /**
   * L99 `wake.receive()`；调用方负责套超时。
   *
   * `token` 是 `withTimeoutOrNull` 的内部令牌：超时或取消时它会被取消，
   * 这里必须**把自己的 waiter 摘掉**再 resolve —— 否则一个已经超时的等待会留在集合里，
   * 下一次 `trySend()` 唤醒的就是它，真正在等的那一轮永远等不到。
   */
  async receive(token?: NearbyJobToken): Promise<void> {
    if (this.ready) {
      this.ready = false;
      return;
    }
    await new Promise<void>((resolve) => {
      const settle = (): void => {
        this.waiters.delete(settle);
        resolve();
      };
      this.waiters.add(settle);
      token?.onCancel(settle);
    });
  }

  reset(): void {
    this.ready = false;
  }
}

/** `suspendCancellableCoroutine` 的投影：`resume` / `fail` 只在不取消时生效。 */
function resumeInto<T>(
  token: NearbyJobToken,
  call: (resume: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (token.cancelled) {
      reject(new NearbyCancelledError());
      return;
    }
    call(
      (value) => {
        if (token.cancelled) return;
        resolve(value);
      },
      (error) => {
        if (token.cancelled) return;
        reject(error);
      },
    );
  });
}

/** 可被令牌取消的定时等待（`delay(ms)` 的投影）。 */
function sleep(ms: number, token: NearbyJobToken): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    const done = (): void => {
      clearTimeout(timer);
    };
    token.onCancel(() => {
      done();
      resolve();
    });
  });
}

/**
 * `withTimeout(ms) { … }`：超时抛 `NearbyTimeoutError`，并**取消内部令牌**
 * （Kotlin 的 `withTimeout` 会取消内部协程）。
 */
async function withTimeout<T>(
  token: NearbyJobToken,
  ms: number,
  action: (inner: NearbyJobToken) => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  const inner = createJobToken();
  token.onCancel(() => inner.cancel());
  const raced = await Promise.race<{ kind: 'value'; value: T } | { kind: 'timeout' }>([
    action(inner).then((value) => ({ kind: 'value' as const, value })),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
      inner.onCancel(() => clearTimeout(timer));
    }),
  ]);
  if (raced.kind === 'timeout') {
    inner.cancel();
    onTimeout();
    throw new NearbyTimeoutError();
  }
  return raced.value;
}

/**
 * `withTimeoutOrNull(ms) { … }`：超时返回 `null`（不抛），同样取消内部令牌。
 *
 * 取消**外部**令牌时抛 `NearbyCancelledError` —— 与 Kotlin 一致（取消要能穿透
 * `withTimeoutOrNull`，否则 `stop()` 之后循环还会继续跑一轮）。
 */
async function withTimeoutOrNull<T>(
  token: NearbyJobToken,
  ms: number,
  action: (inner: NearbyJobToken) => Promise<T>,
): Promise<T | null> {
  if (token.cancelled) throw new NearbyCancelledError();
  const inner = createJobToken();
  token.onCancel(() => inner.cancel());
  const raced = await Promise.race<
    { kind: 'value'; value: T } | { kind: 'null' } | { kind: 'cancelled' }
  >([
    action(inner).then((value) => ({ kind: 'value' as const, value })),
    new Promise<{ kind: 'null' }>((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'null' }), ms);
      inner.onCancel(() => clearTimeout(timer));
    }),
    new Promise<{ kind: 'cancelled' }>((resolve) => {
      token.onCancel(() => resolve({ kind: 'cancelled' }));
    }),
  ]);
  if (raced.kind === 'cancelled') throw new NearbyCancelledError();
  if (raced.kind === 'null') {
    inner.cancel();
    return null;
  }
  return raced.value;
}

export interface NearbyConnectorOptions {
  readonly platform: NearbyPlatform;
  readonly onGroup: (group: NearbyGroup) => void;
  readonly onStage: (stage: string) => void;
  readonly onError: (message: string) => void;
  readonly pollMillis?: number;
  readonly negotiationMillis?: number;
  readonly readGroupTimeoutMillis?: number;
  readonly waitRemovalTimeoutMillis?: number;
}

/**
 * L21-23 `NearbyConnector`：轮询权威连接状态 + 响应广播（含已建成的组）。
 *
 * L11 的 KDoc 说得很清楚：「Success from connect means only that negotiation was
 * requested.」—— 所以 `connect()` 之后还要轮询到组真的出现才算接上。
 */
export class NearbyConnector {
  private readonly platform: NearbyPlatform;

  private readonly onGroup: (group: NearbyGroup) => void;

  private readonly onStage: (stage: string) => void;

  private readonly onError: (message: string) => void;

  private readonly pollMillis: number;

  private readonly negotiationMillis: number;

  private readonly readGroupTimeoutMillis: number;

  private readonly waitRemovalTimeoutMillis: number;

  /** L24 `private var job: Job?` —— 这里存「当前作业的令牌 + 是否已结束」。 */
  private job: NearbyJobToken | null = null;

  /** L25 `private var connecting = false`。 */
  private connecting = false;

  /** L26 `private var epoch = 0` —— 每次发起/停止都 +1，用来判定「这次回调还属不属于我」。 */
  private epoch = 0;

  /** L27 `Channel<Unit>(CONFLATED)`。 */
  private readonly wake = new ConflatedSignal();

  constructor(options: NearbyConnectorOptions) {
    this.platform = options.platform;
    this.onGroup = options.onGroup;
    this.onStage = options.onStage;
    this.onError = options.onError;
    this.pollMillis = options.pollMillis ?? NEARBY_POLL_MS;
    this.negotiationMillis = options.negotiationMillis ?? NEARBY_NEGOTIATION_MS;
    this.readGroupTimeoutMillis = options.readGroupTimeoutMillis ?? NEARBY_READ_GROUP_TIMEOUT_MS;
    this.waitRemovalTimeoutMillis = options.waitRemovalTimeoutMillis ?? NEARBY_WAIT_REMOVAL_TIMEOUT_MS;
  }

  /** 测试与调用方观察用：当前 `connecting`。 */
  get isConnecting(): boolean {
    return this.connecting;
  }

  /** 测试与调用方观察用：当前 epoch（每次 `connect` / `stop` 都 +1）。 */
  get currentEpoch(): number {
    return this.epoch;
  }

  /**
   * L28-30 `observe()`：
   * ```
   * if(job?.isActive == true) return
   * job = scope.launch {
   *     try { watch() }
   *     catch (e: CancellationException) { throw e }
   *     catch (e: Exception) { onError(e.message ?: tr("附近连接状态读取失败")) }
   * }
   * ```
   * 「幂等」的判据是 `job?.isActive`：作业已取消但尚未被替换时**仍会重启**。
   */
  observe(): void {
    if (this.job !== null && !this.job.cancelled) return;
    const token = createJobToken();
    this.job = token;
    void this.launch(token, async () => {
      await this.watch(token);
    }, NEARBY_ERROR_READ_FAILED);
  }

  /** L32 `fun refresh() { wake.trySend(Unit) }` —— 立即唤醒正在 `pause()` 的循环。 */
  refresh(): void {
    this.wake.trySend();
  }

  /**
   * L33-64 `connect(address)`。
   *
   * ⚠️ 旧端口是 `if (this.connecting) return;` —— 原文**不早退**：已在连接时先
   * `platform.cancelPending()` 再重新发起（用户重复点「连接」应当重试，而不是被静默忽略）。
   */
  connect(address: string): void {
    // L34 `job?.cancel()`
    this.job?.cancel();
    // L35 `if(connecting) platform.cancelPending()`
    if (this.connecting) this.platform.cancelPending();
    // L36 `val token = ++epoch`
    const token = ++this.epoch;
    // L37 `connecting = true`
    this.connecting = true;
    const job = createJobToken();
    this.job = job;
    void this.launch(
      job,
      async () => {
        // L40 `onStage(tr("正在建立附近网络"))`
        this.onStage(tr(NEARBY_STAGE_NEGOTIATING));
        // L41-55 `withTimeout(negotiationMillis) { … }`
        try {
          await withTimeout(
            job,
            this.negotiationMillis,
            async (inner) => {
              const existing = await this.readGroup(inner);
              if (existing !== null && nearbyGroupContainsMember(existing, address)) {
                // L43-44 已经建成同一组 → 直接用它，不重连
                this.onGroup(existing);
                return;
              }
              if (existing !== null) {
                // L46 `action { platform.removeGroup(it) }; waitForRemoval()`
                await this.action(inner, (resume, fail) =>
                  this.platform.removeGroup((error) => (error === null ? resume(undefined) : fail(new Error(error)))),
                );
                await this.waitForRemoval(inner);
              }
              // L47 `platform.pauseDiscovery { … }`
              await resumeInto<void>(inner, (resume) => this.platform.pauseDiscovery(resume));
              // L48 `action { platform.connect(address, it) }`
              await this.action(inner, (resume, fail) =>
                this.platform.connect(address, (error) =>
                  error === null ? resume(undefined) : fail(new Error(error)),
                ),
              );
              // L49-53 轮询到组出现
              while (!inner.cancelled) {
                const group = await this.readGroup(inner);
                if (group !== null) {
                  this.onGroup(group);
                  break;
                }
                await this.pause(inner);
              }
            },
            () => {
              /* 超时后由下面的 catch 统一处理 */
            },
          );
          // L56 `if(epoch==token) connecting=false`
          if (this.epoch === token) this.connecting = false;
          // L57 `watch()`
          await this.watch(job);
        } catch (error) {
          if (isNearbyTimeout(error)) {
            // L58-59
            this.platform.cancelPending();
            this.onError(tr(NEARBY_ERROR_TIMEOUT));
            return;
          }
          if (isNearbyCancelled(error)) return;
          // L61 `platform.cancelPending(); onError(e.message ?: tr("附近连接未能建立"))`
          this.platform.cancelPending();
          this.onError(error instanceof Error && error.message !== '' ? error.message : tr(NEARBY_ERROR_CONNECT_FAILED));
        } finally {
          // L62 `finally { if(epoch==token) connecting=false }`
          if (this.epoch === token) this.connecting = false;
        }
      },
      NEARBY_ERROR_CONNECT_FAILED,
    );
  }

  /**
   * L65-71 `stop(disconnect = false)`。
   *
   * ⚠️ `disconnect` 为假时**不能**碰系统连接：`stop()` 的常见用途是「离开页面时停轮询」，
   * 顺手取消系统连接会让正在协商的会话被打断。旧端口恒 `cancelPending()`，就是这个问题。
   */
  stop(disconnect = false): void {
    // L66 `job?.cancel(); job=null`
    this.job?.cancel();
    this.job = null;
    // L67 `epoch++`
    this.epoch += 1;
    // L68 `if(disconnect) platform.cancelPending()`
    if (disconnect) this.platform.cancelPending();
    // L69 `connecting=false`
    this.connecting = false;
    // L70 `if(disconnect) platform.removeGroup {}`
    if (disconnect) this.platform.removeGroup(() => undefined);
    this.wake.reset();
  }

  /**
   * L72-83 `cancelConnection()`：先 `stop()`，再取消系统连接，然后「移除旧组 + 等它断开」，
   * 最后（若期间没有再发起连接）恢复观察。
   *
   * ⚠️ 末尾的 `if(token==epoch) watch()` 是关键：`cancelConnection` 期间用户可能又点了
   * 「连接」，那个新连接有自己的 epoch —— 此时**不能**再启动一个观察循环，
   * 否则两个循环同时 `onGroup`。
   */
  cancelConnection(): void {
    this.stop();
    this.platform.cancelPending();
    const token = this.epoch;
    const job = createJobToken();
    this.job = job;
    void this.launch(
      job,
      async () => {
        const group = await this.readGroup(job);
        if (group !== null) {
          await this.action(job, (resume, fail) =>
            this.platform.removeGroup((error) => (error === null ? resume(undefined) : fail(new Error(error)))),
          );
          await this.waitForRemoval(job);
        }
        if (token === this.epoch) await this.watch(job);
      },
      NEARBY_ERROR_CLEANUP_FAILED,
    );
  }

  /**
   * L84-86 `waitForRemoval()`：
   * ```
   * check(withTimeoutOrNull(5_000){ while(readGroup()!=null) pause(); true } == true) { … }
   * ```
   * 5 秒内没断开就抛「旧的附近网络尚未断开，请稍后重新连接」—— 继续往下走会连到旧组。
   */
  private async waitForRemoval(token: NearbyJobToken): Promise<void> {
    const done = await withTimeoutOrNull(token, this.waitRemovalTimeoutMillis, async (inner) => {
      while (!inner.cancelled) {
        const group = await this.readGroup(inner);
        if (group === null) break;
        await this.pause(inner);
      }
      return true;
    });
    if (done !== true) throw new Error(tr(NEARBY_ERROR_STALE_GROUP));
  }

  /** L87-89 `readGroup()`：`withTimeoutOrNull(1_500) { platform.group { resume(it) } }`。 */
  private readGroup(token: NearbyJobToken): Promise<NearbyGroup | null> {
    return withTimeoutOrNull(token, this.readGroupTimeoutMillis, (inner) =>
      resumeInto<NearbyGroup | null>(inner, (resume) => this.platform.group(resume)),
    );
  }

  /**
   * L90-92 `action(call)`：平台回调的错误转异常（Kotlin 用 `IllegalStateException(error)`）。
   * 不这么写的话，「平台报错」会被当成「已成功」，后续 `waitForRemoval()` 再慢慢超时 ——
   * 用户看到的是一条 5 秒后才出现的「旧组未断开」。
   */
  private action(
    token: NearbyJobToken,
    call: (resume: (value: undefined) => void, fail: (error: unknown) => void) => void,
  ): Promise<void> {
    return resumeInto<void>(token, call);
  }

  /** L93-98 `watch()`：`while(isActive) { readGroup()?.let(onGroup); pause() }`。 */
  private async watch(token: NearbyJobToken): Promise<void> {
    while (!token.cancelled) {
      const group = await this.readGroup(token);
      if (group !== null) this.onGroup(group);
      await this.pause(token);
    }
  }

  /**
   * L99 `pause()`：`withTimeoutOrNull(pollMillis) { wake.receive() }`。
   *
   * 返回值（是否被 `refresh()` 唤醒）不影响行为，但 `withTimeoutOrNull` 必须**不抛超时**
   * —— 正常的一次轮询间隔就走这条超时路径。
   */
  private async pause(token: NearbyJobToken): Promise<void> {
    await withTimeoutOrNull(token, this.pollMillis, (inner) => this.wake.receive(inner));
  }

  /** 统一的 `scope.launch { … }` 包装：取消静默，其余异常留给调用方。 */
  private async launch(
    token: NearbyJobToken,
    body: () => Promise<void>,
    fallbackError: string,
  ): Promise<void> {
    try {
      await body();
    } catch (error) {
      if (isNearbyCancelled(error)) return;
      if (isNearbyTimeout(error)) return;
      this.onError(error instanceof Error && error.message !== '' ? error.message : tr(fallbackError));
    } finally {
      if (this.job === token) this.job = null;
    }
  }
}

/** 供测试复现「平台永不回调」的超时路径。 */
export { sleep as nearbySleep };
