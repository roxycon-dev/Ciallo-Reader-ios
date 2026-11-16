import { Network } from '@capacitor/network';
import type { DownloadConnectivity } from '@core/download/downloadManager';

export const iosDownloadConnectivity: DownloadConnectivity = {
  async connected() {
    try { return (await Network.getStatus()).connected; }
    catch { return true; }
  },
  async subscribe(listener) {
    const handle = await Network.addListener('networkStatusChange', ({ connected }) => listener(connected));
    return () => { void handle.remove(); };
  },
};
