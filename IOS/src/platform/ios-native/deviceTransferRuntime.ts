import { getPlatform } from '@platform/index';
import { getPrivacyService } from '@platform/privacyRuntime';
import { isTransferSessionId } from '@core/transfer/transferWire';
import { DeviceTransferController } from './deviceTransferController';
import { NativePortableArchivePort } from './portableArchivePort';
import { NativeTransferPort } from './transferPort';
import { exportNativeArchive } from './archiveExportRuntime';
import { importNativeArchive } from './archiveImportRuntime';
import { NativeArchiveFilePort } from './archiveFilePort';

function randomHex(bytes: number): string { return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
let controller: Promise<DeviceTransferController> | null = null;
export function getDeviceTransferController(): Promise<DeviceTransferController> {
  controller ??= (async () => {
    const platform = getPlatform(); let id = await platform.secure.get('device_transfer_id_v1');
    if (!isTransferSessionId(id)) { const raw = randomHex(16); id = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`; await platform.secure.set('device_transfer_id_v1', id); }
    const archive = new NativePortableArchivePort();
    const model = (await platform.device.info().catch(() => ({ model: 'iPhone' }))).model || 'iPhone';
    return new DeviceTransferController({
      local: { id, name: `Ciallo ${model}`.slice(0, 64) }, port: new NativeTransferPort(), files: new NativeArchiveFilePort(), randomHex,
      verifyProtected: (pin) => getPrivacyService().verify(pin),
      prepare: (selection, options) => exportNativeArchive(platform, selection, options),
      inspect: (path, hash) => archive.inspect(path, hash),
      importArchive: (inspected, mode, signal, progress) => importNativeArchive(platform, inspected, mode, signal, progress),
      discard: (stageId) => archive.discard(stageId), cancelArchive: () => archive.cancel(),
    });
  })().catch((error: unknown) => { controller = null; throw error; });
  return controller;
}
