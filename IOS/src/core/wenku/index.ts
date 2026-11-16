/**
 * `src/core/wenku` 公共入口。
 *
 * Kotlin → TS 行号映射（模块级；逐函数映射写在各文件头）
 * ─────────────────────────────────────────────────────
 * `types.ts`        ShelfVolumePose / ShelfVolumeArt / ShelfPalette / VisibleSlot / 绘制计划类型
 * `tokens.ts`       WenkuTokens.kt L31-220、ArchiveShelf.kt L751-756/L1086、ShelfVolumeRender.kt
 *                   L104-113/L544-549、ShelfCoverArt.kt L118-122、WenkuCoverFlight.kt L81-92、
 *                   WenkuVolumeFlight.kt L247-250、WenkuReflow.kt L77-96、
 *                   PreferencesManager.kt L104-110/L126-130
 * `shelfMetrics.ts` ArchiveShelf.kt L252-408 / L484-577 / L751-883 / L889-964 / L1067-1138 /
 *                   L1240-1337 / L1347-1376
 * `volumeRender.ts` ShelfVolumeRender.kt L37-176 / L182-533 / L585-635、ArchiveShelf.kt L971-1020 /
 *                   L1097-1102 / L1188-1238
 * `coverArt.ts`     ShelfCoverArt.kt L43-261、ShelfVolumeRender.kt L314-317 / L552-568、
 *                   ArchiveShelf.kt L1030-1056 / L1342-1345、WenkuFlightBridge.kt L94-135
 * `motion.ts`       WenkuTokens.kt L121-220 / L316-319、ArchiveShelf.kt L756-762 / L889-890 /
 *                   L918 / L563、WenkuReflow.kt L96
 * `reflow.ts`       WenkuReflow.kt L77-96 / L146-151 / L239-312 / L327-404 / L485-648
 * `flight.ts`       WenkuCoverFlight.kt L81-840、WenkuFlightBridge.kt L26-198、WenkuVolumeFlight.kt L41-250
 *
 * 边界：本目录是纯 TypeScript（无 React / DOM / Capacitor / Canvas）。所有需要像素或文本度量的
 * 位置都留了注入点：`TextMeasure`、`MeasureTextWidth`、`VolumeTextMetrics`、`EdgeColorSamplePlan`，
 * 以及只描述参数的 `RasterCoverPlan` / `VolumeDrawPlan` / `CoverFlightFramePlan`。
 *
 * 未移植的 Kotlin 行为（逐文件的具体行号见各文件头「未移植」段）：
 * - `ArchiveShelf.kt` L175-597 的组合、副作用与手势运行时（Animatable / pointerInput / SideEffect）
 * - `ShelfVolumeRender.kt` L182-541 的 Canvas 调用本身（几何已全部落到 `planVolumeDraw`）
 * - `WenkuCoverFlight.kt` L440-617 的 @Composable 生命周期与 `drawBitmapMesh` 调用
 * - `WenkuReflow.kt` L112-313 的可变控制器状态机（本层只保留纯投影）
 * - `WenkuMotion.kt` L88-601 的 Modifier / CompositionLocal（纯 UI）
 */

export * from './types';
export * from './tokens';
export * from './motion';
export * from './shelfMetrics';
export * from './volumeRender';
export * from './coverArt';
export * from './reflow';
export * from './flight';
