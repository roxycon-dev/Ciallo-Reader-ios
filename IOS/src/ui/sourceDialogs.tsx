import { useState, useSyncExternalStore } from 'react';
import type { BookSource } from '@core/source/bookSource';
import { SourceResult } from '@core/source/sourceResult';
import { ZLibraryLoginDialog } from '@ui/components/source/ZLibraryLoginDialog';

interface InputRequest { id: number; title: string; image: string | null; finish(value: string): void }
let sequence = 0;
const requests: InputRequest[] = [];
const listeners = new Set<() => void>();
let loginSource: BookSource | null = null;
export function showSourceLogin(source: BookSource): void { loginSource = source; changed(); }
function changed(): void { for (const listener of listeners) listener(); }

export function showSourceInput(title: string, image: string | null, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException('书源操作已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = requests.indexOf(request); if (index < 0) return;
      requests.splice(index, 1); signal?.removeEventListener('abort', abort); reject(new DOMException('书源操作已取消', 'AbortError')); changed();
    };
    const request: InputRequest = { id: ++sequence, title, image, finish(value) {
      const index = requests.indexOf(request);
      if (index < 0) return;
      requests.splice(index, 1); signal?.removeEventListener('abort', abort); resolve(value); changed();
    } };
    requests.push(request); signal?.addEventListener('abort', abort, { once: true }); changed();
  });
}

function ActiveInput({ request }: { request: InputRequest }) {
  const [value, setValue] = useState('');
  const image = request.image === null ? null : request.image.startsWith('data:image/')
    ? request.image : `data:image/png;base64,${request.image}`;
  return <div className="source-mgmt-modal-backdrop">
    <form className="source-mgmt-modal" role="dialog" aria-modal="true" aria-label={request.title}
      onSubmit={(event) => { event.preventDefault(); request.finish(value); }}>
      <h3 className="source-mgmt-modal-title">{request.title}</h3>
      {image === null ? null : <img src={image} alt="验证码" style={{ maxWidth: '100%', maxHeight: 180 }} />}
      <input className="source-mgmt-modal-textarea" value={value} aria-label="输入内容"
        onChange={(event) => setValue(event.target.value)} />
      <div className="source-mgmt-modal-actions">
        <button type="button" className="source-mgmt-modal-btn" onClick={() => request.finish('')}>取消</button>
        <button type="submit" className="source-mgmt-modal-btn source-mgmt-modal-btn--primary">确定</button>
      </div>
    </form>
  </div>;
}

export function SourceDialogs() {
  const request = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => requests[0] ?? null);
  const login = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => loginSource);
  const dismiss = (): void => { loginSource = null; changed(); };
  return <>
    {login === null ? null : <ZLibraryLoginDialog key={login.id} source={{ id: login.id, name: login.name,
      login: async (credential) => SourceResult.map(await login.login(credential), () => null),
      getRegistrationUrl: () => login.getRegistrationUrl() }} onDismiss={dismiss} onSuccess={dismiss} />}
    {request === null ? null : <ActiveInput key={request.id} request={request} />}
  </>;
}
