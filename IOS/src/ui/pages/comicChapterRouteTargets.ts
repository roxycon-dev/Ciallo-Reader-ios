import type { ComicDetailTarget } from '@core/comic/comicChapters';
import type { RouteKey } from '@ui/state/appStore';

const targetsByRoute = new Map<RouteKey, ComicDetailTarget>();

export function rememberComicChapterRouteTarget(route: RouteKey, target: ComicDetailTarget): void {
  targetsByRoute.set(route, target);
}

export function comicChapterRouteTarget(route: RouteKey): ComicDetailTarget | null {
  return targetsByRoute.get(route) ?? null;
}

export function pruneComicChapterRouteTargets(retainedRoutes: ReadonlySet<RouteKey>): void {
  for (const route of targetsByRoute.keys()) {
    if (!retainedRoutes.has(route)) targetsByRoute.delete(route);
  }
}
