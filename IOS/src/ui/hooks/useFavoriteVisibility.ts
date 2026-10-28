import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPrivacyService } from '@platform/privacyRuntime';
import { getPlatform } from '@platform/index';
import { SettingsRepository } from '@core/settings/settingsRepository';

/** Protected favorites stay private until both preference loading and PIN authorization finish. */
export function useFavoriteVisibility(): boolean {
  const service = getPrivacyService(), privacy = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const [protectedFavorites, setProtectedFavorites] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void new SettingsRepository(getPlatform().db).getBoolean('favorites_protected', false).then((value) => { if (!cancelled) setProtectedFavorites(value); }).catch(() => { /* Keep favorites locked if their protection preference cannot be read. */ });
    return () => { cancelled = true; };
  }, []);
  return privacy.loaded && (!privacy.enabled || protectedFavorites === false || privacy.favoritesUnlocked);
}
