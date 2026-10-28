import { useSyncExternalStore, type ReactNode } from 'react';
import { getPrivacyService } from '@platform/privacyRuntime';
import { useAppStore } from '@ui/state/appStore';
import { PrivacyPinOverlay } from './PrivacyWindows';

/** Unmount the protected reader on background lock, including its TTS and timers. */
export function ReaderPrivacyGate({ children }: { children: ReactNode }) {
  const service = getPrivacyService();
  const privacy = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const bookId = useAppStore((state) => state.currentBookId);
  const books = useAppStore((state) => state.books);
  const categories = useAppStore((state) => state.categories);
  const book = books.find((item) => item.id === bookId);
  const category = categories.find((item) => item.name === book?.category);
  if (!privacy.loaded) return <main className="startup-status" role="status">正在检查隐私保护…</main>;
  if (privacy.enabled && category?.isProtected && !privacy.unlockedCategoryIds.includes(category.id)) return <PrivacyPinOverlay
    mode="VERIFY" onPinSet={() => {}} onPinVerified={(pin) => service.unlockCategory(category.id, pin)}
    onDismiss={() => { if (!service.getSnapshot().unlockedCategoryIds.includes(category.id)) useAppStore.getState().setRoute('main'); }} />;
  return children;
}
