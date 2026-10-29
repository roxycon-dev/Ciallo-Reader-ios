/**
 * GodEditorPage.tsx — 「神回编辑窗」宿主（route = godEditor）。
 *
 * 这是 Android `GodMomentSheet.kt` 调用方（阅读器 / 详情页）的等价物：只负责
 * 「取用 request / existing → 喂给 GodMomentSheet → 保存落库 → 相册选择 → Toast」，
 * 所有 UI 渲染交给逐行移植版 `GodMomentSheet`（src/ui/components/god/GodMomentSheet.tsx，
 * 1057 行，文件头 33 条行号映射）。
 *
 * 权威来源：Android `GodMomentSheet.kt` 的调用点 + `ComicReadingLogic` /
 * `god_moments`。索引对照见本文件底部「逐段对照表」。
 *
 * 路由约定（App.tsx 不改）：本页只通过 `setGodEditTarget(id)` + `setRoute('godEditor')`
 * 进入（见 GodRankingPage/StatisticsPage/ComicChaptersPage），即**永远是编辑既有神回**。
 * 阅读器内「新建」入口由另一代理在 ComicReaderPage / App.tsx 装配，不在此页职责内。
 *
 * 宿主职责边界（对照 Kotlin 调用方）：
 *   - request / existing 取用与解码         → 本文件（godBindingOpenEdit + parseCoverSource）
 *   - 保存落库（godMomentRepository）        → saveGodMoment（@core/god/godMoments）
 *   - 裁剪结果回写（cropParams）            → onSave 把 CropParams 序列化进实体
 *   - 相册选择                              → onPickAlbum（见下）
 *   - Toast                                 → showToast（@ui/toast）
 *
 * 平台能力接线（2026-10-11，E18 收口 —— 相册选图）：
 *   - **相册选择**：`getPlatform().documents.pickFile({ accept: 'image/*' })`。
 *     `DocumentPort.pickFile` 的 JSDoc 点名的 Android 调用点就是
 *     `god/GodMomentSheet.kt:326` 的 `ActivityResultContracts.PickVisualMedia()`；
 *     web/WKWebView 由 `<input type="file" accept="image/*">` 承载（capabilities.ts
 *     的 `pickFiles`，WKWebView 原生支持文件选择，不需要新 Capacitor 插件）。
 *     取消（空数组 / cancel 事件）→ `onPicked(null)` → 面板 Toast「未选择图片」
 *     （Kotlin L330）；打开失败（reject）→ Toast「无法打开相册」（Kotlin L492）。
 *   - **位图裁剪 / 合成**：`platform/web/webGodCoverComposer.ts` 的
 *     `applyCropWeb`（Kotlin `applyCrop` L262-281 + `loadUri` 解码预算 L122-125）
 *     与 `composeGodCoverWeb`（Kotlin `compose` L291-344）。
 *     预览 450×600（LaunchedEffect L311-323：换源 / 确认裁剪后重合成），
 *     成品 900×1200（doSave L349-364 的 `composeAndSave`）。
 *   - **成品形态**：PNG data URL 落进 `coverPath`（E18 已登记的 Web 等价物：
 *     无 `filesDir/god_covers` 路径，存档只消费 URL）；相册原图的 data URL
 *     随 `CoverSource.Album(uri)` 写进 `coverSource` 列，重进编辑页可直接解。
 *   - **仍未接线（维持原状，见原登记）**：页缩略图路径的位图解码
 *     （`GodCoverImageDecoder.decodePage`，E35/E45）—— 页来源不可重合成，
 *     保存保留既有合成本（Kotlin L355 `?: existing?.coverPath` 同一出口）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GodMomentSheet, GOD_TOAST_OPEN_FAILED } from '@ui/components/god/GodMomentSheet';
import { showToast } from '@ui/toast';
import { useAppStore } from '@ui/state/appStore';
import { getPlatform } from '@platform/index';
import {
  applyCropWeb,
  blobToDataUrl,
  composeGodCoverWeb,
} from '@platform/web/webGodCoverComposer';
import { openAppDatabase } from '@core/db/openDatabase';
import { GodMomentRepository } from '@core/god/godMomentRepository';
import {
  GOD_PREVIEW_HEIGHT,
  GOD_PREVIEW_WIDTH,
} from '@core/god/godCoverEngine';
import {
  attachGodMomentRepository,
  getGodMoment,
  hydrateGodMomentsFromDb,
  saveGodMoment,
  takeGodEditTarget,
} from '@core/god/godMoments';
import { createGodMomentRequest, godBindingOpenEdit } from '@core/god/godReaderBinding';
import {
  DEFAULT_CROP_PARAMS,
  cropParamsToTag,
  parseCoverSource,
  type CropParams,
  type GodMoment,
} from '@core/god/godTypes';

/**
 * `GodMomentSheetProps.onSave` 回调负载（与 GodMomentSheet.tsx L686-693 对齐）。
 * 宿主据此构造实体并落库。
 */
interface GodEditorSaveInput {
  crop: CropParams;
  coverSourceTag: string;
  rating: number;
  title: string;
  titleIsCustom: boolean;
  note: string;
}

/** data URL → Blob（WKWebView 的 `fetch` 支持 `data:`；失败返回 null，不让调用悬空）。 */
async function fetchBlobFromUrl(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    return await response.blob();
  } catch {
    return null;
  }
}

export function GodEditorPage() {
  const setRoute = useAppStore((s) => s.setRoute);

  // 取用编辑目标（request 的 existing 来源）。takeGodEditTarget 一次性消费全局哨兵，
  // 必须在惰性初始化里调用一次（Android `binding.openEdit(existing, …)` 的 existing）。
  const [initialMoment] = useState<GodMoment | null>(() => {
    const targetId = takeGodEditTarget();
    if (targetId === null) return null;
    return getGodMoment(targetId) ?? null;
  });
  const existing = initialMoment;
  const editing = existing !== null;

  // Kotlin `GodReaderBinding.openEdit(existing, pages, parseSource)`（GodReaderBinding.kt L36-47）：
  // 由现有神回反推 GodMomentRequest。编辑窗没有阅读器页列表，pages 传空 ——
  // 与 Android「详情页编辑时没有页列表 → 退化为以已合成封面为底图」（GodMomentSheet.kt L288-289）一致。
  const request = useMemo(
    () =>
      existing !== null
        ? godBindingOpenEdit(existing, [], parseCoverSource)
        : createGodMomentRequest({ bookId: '', chapterId: '', bookTitle: '' }),
    [existing],
  );

  // 预览 URL（Kotlin `LaunchedEffect(coverSource, …)`（GodMomentSheet.kt L290-308）的
  // 输出归宿主 state）。初值：相册来源直接用其 uri（data URL 自包含，即原图），
  // 其余用已落库的合成本；相册选图 / 确认裁剪后由 `recomposePreview` 重合成覆盖。
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
    if (existing === null) return null;
    const source = parseCoverSource(existing.coverSource);
    if (source.kind === 'album' && source.uri !== '') return source.uri;
    return existing.coverPath;
  });
  // Kotlin L279 `loadingCover`：解码 / 合成进行中的门（封面未就绪禁用保存）。
  const [loadingCover, setLoadingCover] = useState(false);

  // 本次会话从相册选中的原图（Kotlin `sourceBitmap` 在宿主侧的持有物：
  // uri = data URL（写进 coverSource tag），blob = 喂给裁剪/合成的像素）。
  const [pickedSource, setPickedSource] = useState<{ uri: string; blob: Blob } | null>(null);
  // 预览重合成序号：连续两次换源 / 裁剪确认的竞态守卫（旧结果不得覆盖新请求）。
  const composeSeqRef = useRef(0);

  // 编辑窗无页列表 → 缩略图行空（GodCoverSection L772 `pages.isNotEmpty()` 不渲染）。
  const thumbUrls = useMemo(() => new Map<string, string>(), []);
  const thumbFailed = useMemo(() => new Set<string>(), []);

  // Kotlin L311-323：`preview = compose(applyCrop(src, crop), PREVIEW_W, PREVIEW_H)`。
  // 合成失败（返回 null）→ previewUrl 置 null → 面板显示「封面不可用」且保存被门住
  // （与 Kotlin `sourceBitmap == null → doSave return` / preview null 同一语义）。
  const recomposePreview = useCallback(async (source: Blob, crop: CropParams): Promise<void> => {
    const seq = composeSeqRef.current + 1;
    composeSeqRef.current = seq;
    setLoadingCover(true); // Kotlin L291：`loadingCover = true`
    try {
      const cropped = await applyCropWeb(source, crop);
      const composed =
        cropped !== null
          ? await composeGodCoverWeb(cropped, {
              outWidth: GOD_PREVIEW_WIDTH,
              outHeight: GOD_PREVIEW_HEIGHT,
            })
          : null;
      if (composeSeqRef.current === seq) setPreviewUrl(composed);
    } catch {
      if (composeSeqRef.current === seq) setPreviewUrl(null);
    } finally {
      if (composeSeqRef.current === seq) setLoadingCover(false);
    }
  }, []);

  /**
   * Kotlin `sourceBitmap`（LaunchedEffect L290-308 的解码产物）的宿主侧解析：
   *   ① 本会话刚从相册选的原图（tag 必须对得上 —— 换成页来源后旧 blob 作废）；
   *   ② 既有神回的 album 来源（data URL 自包含，= Kotlin `loadUri` 同一原图）；
   *   ③ 页缩略图（comicPage）没有位图解码端口（E35/E45）→ null（不可重合成）。
   */
  const resolveSourceBlob = useCallback(
    async (coverSourceTag: string): Promise<Blob | null> => {
      const source = parseCoverSource(coverSourceTag);
      if (source.kind === 'album' && pickedSource !== null && pickedSource.uri === source.uri) {
        return pickedSource.blob;
      }
      if (source.kind === 'album' && source.uri.startsWith('data:')) {
        return fetchBlobFromUrl(source.uri);
      }
      return null;
    },
    [pickedSource],
  );

  // 保存成功后回排行榜；取消 / 关闭同样回排行榜（Kotlin onDismiss / onSaved 语义）。
  const goBack = useCallback(() => {
    setRoute('godRanking');
  }, [setRoute]);

  // 相册选择（Kotlin L489-493 launch + L325-335 结果回调的宿主半边）。
  // 选定 → data URL 经 `onPicked(uri)` 回传（面板写回 CoverSource.Album + DEFAULT
  // crop，Kotlin L332-333），同时宿主按 DEFAULT crop 重合成 450×600 预览。
  const onPickAlbum = useCallback(
    (onPicked: (uri: string | null) => void): void => {
      let settled = false;
      const finishPicked = (uri: string | null): void => {
        if (settled) return;
        settled = true;
        onPicked(uri);
      };
      getPlatform()
        .documents.pickFile({ accept: 'image/*' })
        .then((files) => {
          // PickVisualMedia 单选；空数组 = 用户取消（Kotlin picker 回调的 uri == null）。
          const file = files[0];
          if (file === undefined) {
            finishPicked(null);
            return;
          }
          const blob = new Blob([file.bytes as unknown as BlobPart], { type: file.mime });
          void blobToDataUrl(blob).then((uri) => {
            if (uri === null) {
              // 读取失败：Android 无对应分支（loadUri 失败走「封面不可用」），
              // 按取消上报，不让回调悬空。
              finishPicked(null);
              return;
            }
            setPickedSource({ uri, blob });
            finishPicked(uri);
            // Kotlin L290-308 LaunchedEffect：换源后重解码 + 按 DEFAULT crop 重合成预览。
            void recomposePreview(blob, DEFAULT_CROP_PARAMS);
          });
        })
        .catch(() => {
          // Kotlin L492：`picker.launch` 失败 → Toast「无法打开相册」。
          showToast(GOD_TOAST_OPEN_FAILED);
        });
    },
    [recomposePreview],
  );

  // 裁剪确认（Kotlin L594 `setCrop(newCrop)` 后由 `LaunchedEffect(sourceBitmap, crop)`
  // 重合成预览）：用新 crop 重跑 applyCropWeb + composeGodCoverWeb(450×600)。
  const onCropApplied = useCallback(
    (crop: CropParams, coverSourceTag: string): void => {
      void resolveSourceBlob(coverSourceTag).then((blob) => {
        if (blob !== null) void recomposePreview(blob, crop);
      });
    },
    [resolveSourceBlob, recomposePreview],
  );

  // 裁剪屏的源图（Kotlin L588-598 传的是 `sourceBitmap` **原图**，不是合成预览）。
  // 会话内新选的图 → 原图 data URL；既有 album 来源 → 落库的原图 data URL；
  // 其余退回预览（编辑既有神回时即已合成封面，GodMomentSheet.kt L288-289 退化语义）。
  const cropSourceUrl = useMemo<string | null>(() => {
    if (pickedSource !== null) return pickedSource.uri;
    if (existing !== null) {
      const source = parseCoverSource(existing.coverSource);
      if (source.kind === 'album' && source.uri.startsWith('data:')) return source.uri;
      return existing.coverPath ?? previewUrl;
    }
    return previewUrl;
  }, [pickedSource, existing, previewUrl]);

  // 保存（Kotlin `doSave` L349-383 的宿主侧：裁剪合成 + composeAndSave + 构造实体 + 落库）。
  // sourceBitmap 可解（相册来源）→ applyCropWeb + composeGodCoverWeb(900×1200)；
  // 页来源不可解（E35/E45）→ 保留既有合成本，绝不把相册像素挂到别的来源 tag 下。
  const onSave = useCallback(
    (input: GodEditorSaveInput): Promise<void> => {
      const base = {
        bookId: request.bookId,
        chapterId: request.chapterId,
        bookTitle: request.bookTitle,
        chapterTitle: request.chapterTitle,
        chapterNumber: request.chapterNumber,
        contentType: request.contentType,
        title: input.title,
        titleIsCustom: input.titleIsCustom,
        rating: input.rating,
        note: input.note,
        coverSource: input.coverSourceTag,
        cropParams: cropParamsToTag(input.crop),
      };
      return (async () => {
        // Kotlin L351-353：`cropped = withContext(Dispatchers.Default) {
        //   sourceBitmap?.let { GodCoverEngine.applyCrop(it, crop) } }`
        const sourceBlob = await resolveSourceBlob(input.coverSourceTag);
        let composed: string | null = null;
        if (sourceBlob !== null) {
          const cropped = await applyCropWeb(sourceBlob, input.crop);
          if (cropped !== null) {
            // Kotlin L354-355：`composeAndSave(context, bookId, chapterId, cropped)`
            // —— 成品恒定 900×1200。
            composed = await composeGodCoverWeb(cropped);
          }
        }
        // Kotlin L355：`?: existing?.coverPath` —— sourceBitmap 为空 / 合成失败时
        // 保留既有合成本；末位再回落预览（doSave 的 previewUrl !== null 门保证非空，
        // 新建场景没有 existing 可回落时 450×600 预览比空封面少丢信息）。
        saveGodMoment({
          ...base,
          coverPath: composed ?? existing?.coverPath ?? previewUrl,
        });
        showToast(editing ? '已保存' : '已添加到神回排行榜');
      })();
    },
    [request, existing, previewUrl, resolveSourceBlob, editing],
  );

  // 落库前置：挂接仓库 + 水合（保留原 GodEditorPage 的持久化行为；失败则内存兜底）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const platform = getPlatform();
        await openAppDatabase({ db: platform.db });
        if (cancelled) return;
        attachGodMomentRepository(new GodMomentRepository(platform.db));
        await hydrateGodMomentsFromDb();
      } catch {
        // in-memory fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GodMomentSheet
      request={request}
      existing={existing}
      previewUrl={previewUrl}
      loadingCover={loadingCover}
      thumbUrls={thumbUrls}
      thumbFailed={thumbFailed}
      cropSourceUrl={cropSourceUrl}
      onPickAlbum={onPickAlbum}
      onCropApplied={onCropApplied}
      onSave={onSave}
      onDismiss={goBack}
      onSaved={goBack}
    />
  );
}
