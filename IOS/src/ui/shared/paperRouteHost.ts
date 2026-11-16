import { getGlassQualitySnapshot } from '@ui/components/glassAppearanceRuntime';
import { createPaperPageTransitionController, type PaperPageTransitionController } from './paperPageTransition';

interface MountedPaper {
  route: string;
  controller: PaperPageTransitionController;
  closing: boolean;
}

let mounted: MountedPaper | null = null;
const presented = new Set<string>();

/** Plain detail-title taps on Android have a virtual origin and use the light surface spring. */
export function mountLibraryPaperRoute(route: string, surface: HTMLElement): () => void {
  const seen = presented.has(route);
  const controller = createPaperPageTransitionController(surface, {
    mode: 'surface', initialProgress: seen ? 1 : 0,
    ...(getGlassQualitySnapshot() === 'MINIMAL' ? { reducedMotion: true } : {}),
  });
  const entry: MountedPaper = { route, controller, closing: false };
  mounted = entry;
  if (!seen) void controller.open().then((result) => {
    if (result === 'finished' && mounted === entry) presented.add(route);
  });
  return () => {
    if (mounted === entry) mounted = null;
    controller.dispose();
  };
}

export function closeLibraryPaperRoute(route: string, commit: () => void): boolean {
  const entry = mounted;
  if (entry?.route !== route) return false;
  if (entry.closing) return true;
  entry.closing = true;
  const finish = (shouldCommit: boolean) => {
    if (mounted !== entry) return;
    entry.closing = false;
    if (shouldCommit) commit();
  };
  void entry.controller.close().then((result) => finish(result === 'finished'), () => finish(true));
  return true;
}

export function pruneLibraryPaperRoutes(routes: ReadonlySet<string>): void {
  for (const route of presented) if (!routes.has(route)) presented.delete(route);
}
