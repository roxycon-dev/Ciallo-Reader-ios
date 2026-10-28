import { registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import { bytesToBase64 } from './capacitorHttpClient';
interface AtomicDocuments { writeAtomic(options: { path: string; data: string }): Promise<void>; }
let documents: AtomicDocuments | undefined;
export async function writeNativeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Atomic configuration file exceeds 16MiB');
  documents ??= nonThenablePlugin(registerPlugin<AtomicDocuments>('ReaderDocuments'));
  await documents.writeAtomic({ path, data: bytesToBase64(bytes) });
}
