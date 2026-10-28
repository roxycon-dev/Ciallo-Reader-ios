import type { DocumentPort } from '@platform/interfaces';
import { base64ToBytes, bytesToBase64 } from './capacitorHttpClient';

interface ReaderDocumentsPlugin {
  pickFile(options: { accept: string; multiple: boolean }): Promise<{
    files: Array<{ name: string; mime: string; data: string }>;
  }>;
  saveFile(options: { fileName: string; mime: string; data: string }): Promise<void>;
}

export function createNativeDocumentPort(): DocumentPort {
  let plugin: Promise<ReaderDocumentsPlugin> | null = null;
  const getPlugin = (): Promise<ReaderDocumentsPlugin> => {
    plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
      registerPlugin<ReaderDocumentsPlugin>('ReaderDocuments'),
    );
    return plugin;
  };
  return {
    async pickFile(options) {
      const { files } = await (
        await getPlugin()
      ).pickFile({
        accept: options.accept ?? '*/*',
        multiple: options.multiple ?? false,
      });
      return files.map(({ name, mime, data }) => ({ name, mime, bytes: base64ToBytes(data) }));
    },
    async saveFile({ fileName, mime, bytes }) {
      await (await getPlugin()).saveFile({ fileName, mime, data: bytesToBase64(bytes) });
    },
  };
}
