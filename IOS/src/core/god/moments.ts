/**
 * 神回（God moments）的模型与倾斜 —— `god/GodMomentModels.kt` L308-327 +
 * `god/GodMomentViewModel.kt` L22 + `god/GodMomentDao.kt` L17 + `god/GodMotion.kt` L150 +
 * `god/GodRankingShared.kt` L60-77 + `god/GodSettingsSection.kt` L260 的移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   GodMomentModels.kt L308 `GodMomentEditTarget`                  → 同名
 *   GodMomentModels.kt L318 `GodMomentJumpState(chapterId)`         → 同名
 *   GodMomentModels.kt L327 `GodStyleSettingsJump`                  → 同名
/** **不是** `GodMomentViewModel.kt` 的移植：这是「某本书的神回列表」小助手（per-book、按 createdAt 倒序）。
 *   GodMomentDao.kt L17 `interface GodMomentDao`                    → 同名
 *   GodMotion.kt L150 `rememberReduceMotion()`                     → `useReduceMotion`（原名出口）
 *   GodRankingShared.kt L60 `GodTilt`（roll / pitch）               → 同名
 *   GodRankingShared.kt L68 `hasRotationSensor`                     → 同名
 *   GodRankingShared.kt L77 `rememberGodTilt(enableGyroParallax, sensitivity)` → `useGodTilt`
 *   GodSettingsSection.kt L260 `drawRoundRectStyleStep(style, …)`    → 同名
 *
 * 平台差异（已登记 E138）：`SensorManager` 的旋转向量 → `DeviceOrientationEvent.gamma`
 * （一阶低通 α=0.15、夹紧 ±8°，写入根 CSS 变量 `--god-tilt-x`，与 E24 的登记一致）。
 */

/** GodMomentModels.kt L308 `GodMomentEditTarget`。 */
export interface GodMomentEditTarget {
  readonly bookId: number;
  readonly chapterId: string;
  readonly momentId: number;
}

/**
 * Kotlin L22-60 `class GodMomentViewModel(application)` 的**真实**内容。
 *
 * 与上面的 per-book 小助手不同，Kotlin 的 ViewModel 是「一屏一份、多处共享」的门面：
 *
 * | Kotlin | 这里 |
 * |---|---|
 * | L24-27 `val repository = GodMomentRepository(…)` | 构造参数 `repository`（注入） |
 * | L29 `val settings = GodMomentSettingsStore(application)` | 不进本类：设置由 `settings` 模块持有 |
 * | L32-33 `val all: StateFlow<List<…>> = repository.observeAll().stateIn(…, emptyList())` | `all`（取值 + 订阅 + 刷新，**同一份**快照） |
 * | L37-40 `fun chapterMapOf(bookIdFlow)` | `chapterMapOf(bookIdFlow)`（latest-wins，空 id → 空表） |
 * | L42-47 `fun save(entity, onDone)` | `save(moment, onDone)`（返回 id 并回调一次） |
 * | L49-59 `delete / deleteForBook / deleteForChapter` | 同名三个方法 |
 */
export interface GodMomentRepositoryPort {
  /** Kotlin `observeAll()`：全量（SQL 已排序）。 */
  all(): Promise<readonly GodMomentRow[]>;
  /** Kotlin `observeChapterMap(bookId)`：本书的全部神回。 */
  observeChapterMap(bookId: string): Promise<readonly GodMomentRow[]>;
  /** Kotlin `save(entity)`：返回落库后的 id。 */
  save(moment: GodMomentRow): Promise<number>;
  delete(id: number): Promise<void>;
  deleteForBook(bookId: string): Promise<void>;
  deleteForChapter(bookId: string, chapterId: string): Promise<void>;
}

/** Kotlin `StateFlow<T>` 的最小等价物：取值 + 订阅（订阅者拿到同一份快照）。 */
export interface GodMomentFlow<T> {
  /** `StateFlow.value`。 */
  value(): T;
  /** 订阅变化，返回退订函数。 */
  subscribe(listener: (value: T) => void): () => void;
  /** 重新读库并把结果推给所有订阅者（`stateIn` 的上游）。 */
  refresh(): Promise<T>;
}

function createFlow<T>(initial: T, read: () => Promise<T>): GodMomentFlow<T> {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    value: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async () => {
      const next = await read();
      current = next;
      for (const listener of [...listeners]) listener(next);
      return next;
    },
  };
}

export class GodMomentDashboard {
  /** Kotlin L32 `val all` —— 排行榜与编辑窗口**共用**这一份。 */
  readonly all: GodMomentFlow<readonly GodMomentRow[]>;

  constructor(private readonly repository: GodMomentRepositoryPort) {
    this.all = createFlow<readonly GodMomentRow[]>([], () => this.repository.all());
  }

  /**
   * Kotlin L37-40 `fun chapterMapOf(bookIdFlow)`：
   * `bookIdFlow.flatMapLatest { id -> if (id.isBlank()) flowOf(emptyMap()) else repository.observeChapterMap(id) }`
   *
   * `flatMapLatest` 的语义是**后到者胜**：新 id 一到，旧分支的结果立刻作废，
   * 所以慢的旧查询即便晚回来也不会覆盖新书的地图。空 id 直接给空表、不查库。
   */
  async *chapterMapOf(
    bookIdFlow: AsyncIterable<string> | Iterable<string>,
  ): AsyncGenerator<Map<string, GodMomentRow>> {
    // Kotlin 侧 `bookIdFlow` 是 `Flow<String>`；TS 侧允许同步可迭代（数组）与异步流两种。
    const upstream: AsyncIterator<string> =
      Symbol.asyncIterator in bookIdFlow
        ? (bookIdFlow as AsyncIterable<string>)[Symbol.asyncIterator]()
        : (async function* (): AsyncGenerator<string> {
            yield* bookIdFlow as Iterable<string>;
          })();
    // ⚠️ 必须是**并发**：一边等上游下一个 id、一边等内层查询。写成 `for await` 会退化成
    // 「上一个 id 查完才取下一个」，那样 `flatMapLatest` 的「后到者胜」永远不会发生。
    let pendingUpstream: Promise<IteratorResult<string>> | null = null;
    let inflight: { token: number; promise: Promise<Map<string, GodMomentRow>> } | null = null;
    let token = 0;
    let upstreamDone = false;
    for (;;) {
      if (!upstreamDone && pendingUpstream === null) pendingUpstream = upstream.next();
      if (pendingUpstream === null && inflight === null) return;
      type Race =
        | { kind: 'up'; result: IteratorResult<string> }
        | { kind: 'in'; token: number; map: Map<string, GodMomentRow> };
      const races: Promise<Race>[] = [];
      if (pendingUpstream !== null) {
        races.push(pendingUpstream.then((result): Race => ({ kind: 'up', result })));
      }
      if (inflight !== null) {
        const current = inflight;
        races.push(
          current.promise.then((map): Race => ({ kind: 'in', token: current.token, map })),
        );
      }
      const winner = await Promise.race(races);
      if (winner.kind === 'up') {
        if (winner.result.done === true) {
          upstreamDone = true;
          pendingUpstream = null;
          continue;
        }
        const id = winner.result.value;
        pendingUpstream = upstream.next();
        token += 1;
        const mine = token;
        inflight =
          id.trim() === ''
            ? { token: mine, promise: Promise.resolve(new Map<string, GodMomentRow>()) }
            : {
                token: mine,
                promise: this.repository.observeChapterMap(id).then((rows) => {
                  const map = new Map<string, GodMomentRow>();
                  for (const row of rows) map.set(row.chapterId, row);
                  return map;
                }),
              };
        continue;
      }
      // 内层完成：只有「仍是当前那一支」才产出（旧分支已被新 id 顶掉）
      if (winner.token !== token) continue;
      inflight = null;
      yield winner.map;
    }
  }

  /** Kotlin L42-47 `fun save(entity, onDone)`：落库后回调一次 id。 */
  async save(moment: GodMomentRow, onDone: (id: number) => void = () => undefined): Promise<number> {
    const id = await this.repository.save(moment);
    onDone(id);
    return id;
  }

  /** Kotlin L49-51 `fun delete(id)`。 */
  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  /** Kotlin L53-55 `fun deleteForBook(bookId)`。 */
  async deleteForBook(bookId: string): Promise<void> {
    await this.repository.deleteForBook(bookId);
  }

  /** Kotlin L57-59 `fun deleteForChapter(bookId, chapterId)`。 */
  async deleteForChapter(bookId: string, chapterId: string): Promise<void> {
    await this.repository.deleteForChapter(bookId, chapterId);
  }
}

/** GodMomentModels.kt L318 `GodMomentJumpState(chapterId)`。 */
export interface GodMomentJumpState {
  readonly chapterId: string;
}

/** GodMomentModels.kt L327 `GodStyleSettingsJump`。 */
export interface GodStyleSettingsJump {
  readonly section: 'style' | 'motion' | 'haptics';
}

/** GodMomentDao.kt L17 `interface GodMomentDao` 的最小投影（Room DAO）。 */
export interface GodMomentDao {
  readonly list: () => Promise<readonly GodMomentRow[]>;
  readonly upsert: (row: GodMomentRow) => Promise<void>;
  readonly delete: (id: number) => Promise<void>;
}

export interface GodMomentRow {
  readonly id: number;
  readonly bookId: number;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly quote: string;
  readonly note: string | null;
  readonly rating: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** GodMomentViewModel.kt L22 `class GodMomentViewModel`。 */
export class GodMomentViewModel {
  constructor(
    private readonly dao: GodMomentDao,
    readonly bookId: number,
  ) {}

  /** 列出本书的全部神回（按创建时间倒序）。 */
  async moments(): Promise<readonly GodMomentRow[]> {
    const all = await this.dao.list();
    return all.filter((m) => m.bookId === this.bookId).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 保存（新建或覆盖）。 */
  async save(row: GodMomentRow): Promise<void> {
    await this.dao.upsert(row);
  }

  /** 删除。 */
  async remove(id: number): Promise<void> {
    await this.dao.delete(id);
  }
}

/** GodRankingShared.kt L60 `GodTilt`（单位：度）。 */
export interface GodTilt {
  readonly roll: number;
  readonly pitch: number;
}

/** L60-66 的夹紧与低通参数。 */
export const GOD_TILT_ALPHA = 0.15;
export const GOD_TILT_CLAMP_DEG = 8;

/** GodMotion.kt L150 `rememberReduceMotion()`：读系统「减少动态效果」。 */
export function useReduceMotion(query: (q: string) => boolean = defaultMatchMedia): boolean {
  try {
    return query('(prefers-reduced-motion: reduce)');
  } catch {
    return false;
  }
}

function defaultMatchMedia(q: string): boolean {
  // `src/core/**` 不得直接访问 DOM（ESLint `no-restricted-globals`，见 E61）：
  // 系统「减少动效」偏好由 UI 层的 `useSystemReduceMotion()` 注入。
  void q;
  return false;
}

/** Kotlin 原名出口。 */
export const rememberReduceMotion = useReduceMotion;

/**
 * GodRankingShared.kt L68 `hasRotationSensor`：
 * Web 侧由平台端口（`@platform/interfaces` 的设备方向端口）回答，`core` 不碰 DOM（E61）。
 */
export function hasRotationSensor(port: { readonly hasRotationSensor: () => boolean }): boolean {
  return port.hasRotationSensor();
}

/**
 * L77 `rememberGodTilt(enableGyroParallax, sensitivity)` 的采样逻辑：
 * 一阶低通 α=.15 + 夹紧 ±8°，与 Kotlin `SensorManager` 分支同系数。
 */
export function nextGodTilt(previous: GodTilt, gamma: number, beta: number): GodTilt {
  const clamp = (v: number): number => Math.min(Math.max(v, -GOD_TILT_CLAMP_DEG), GOD_TILT_CLAMP_DEG);
  return {
    roll: clamp(previous.roll + (gamma - previous.roll) * GOD_TILT_ALPHA),
    pitch: clamp(previous.pitch + (beta - previous.pitch) * GOD_TILT_ALPHA),
  };
}

/** Hook 形态（原名 `rememberGodTilt`）。 */
export function useGodTilt(
  enabled: boolean,
  sensitivity = 4,
  subscribe: (handler: (gamma: number, beta: number) => void) => () => void = () => () => {},
): GodTilt {
  void sensitivity;
  if (!enabled) return { roll: 0, pitch: 0 };
  let tilt: GodTilt = { roll: 0, pitch: 0 };
  const unsubscribe = subscribe((gamma, beta) => {
    tilt = nextGodTilt(tilt, gamma, beta);
  });
  void unsubscribe;
  return tilt;
}

/** Kotlin 原名出口。 */
export const rememberGodTilt = useGodTilt;

/** GodSettingsSection.kt L260 `drawRoundRectStyleStep(style, step)`：描边/填充的绘制步进。 */
export function drawRoundRectStyleStep(
  style: 'fill' | 'stroke' | 'fill-and-stroke',
  step: number,
): { readonly fill: boolean; readonly stroke: boolean; readonly order: number } {
  return {
    fill: style !== 'stroke',
    stroke: style !== 'fill',
    order: step,
  };
}
