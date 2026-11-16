import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VeneraResultSuccess } from '../../src/core/source/veneraTypes';

interface MockHandle {
  send: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

const createdWorkers: MockHandle[] = [];
const mockCreateVeneraWorker = vi.fn();

vi.mock('../../src/core/source/veneraWorker', () => ({
  createVeneraWorker: (...args: unknown[]) => mockCreateVeneraWorker(...args),
}));

function successResponse(operation = 'search'): VeneraResultSuccess {
  return {
    type: 'result',
    id: 1,
    ok: true,
    operation: operation as VeneraResultSuccess['operation'],
    data: { comics: [], maxPage: 0 },
  };
}

function makeHandle(sendImpl?: MockHandle['send']): MockHandle {
  const handle: MockHandle = {
    send: sendImpl ?? vi.fn().mockResolvedValue(successResponse()),
    terminate: vi.fn(),
  };
  createdWorkers.push(handle);
  return handle;
}

async function loadBridge() {
  return await import('../../src/core/source/veneraBridge');
}

describe('veneraBridge', () => {
  beforeEach(() => {
    createdWorkers.length = 0;
    mockCreateVeneraWorker.mockReset();
    mockCreateVeneraWorker.mockImplementation(() => makeHandle());
  });

  afterEach(async () => {
    const { terminateVeneraBridge } = await loadBridge();
    terminateVeneraBridge();
  });

  it('creates one worker per sourceKey and reuses it', async () => {
    const { evaluateComicSource, activeVeneraBridgeKeys } = await loadBridge();

    const r1 = await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: 'script-A' },
    );
    expect(r1.ok).toBe(true);
    expect(mockCreateVeneraWorker).toHaveBeenCalledTimes(1);

    const r2 = await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'b' },
      { sourceKey: 'src1', script: 'script-A' },
    );
    expect(r2.ok).toBe(true);
    expect(mockCreateVeneraWorker).toHaveBeenCalledTimes(1);
    expect(activeVeneraBridgeKeys()).toContain('src1');
  });

  it('terminates previous worker when script changes for same sourceKey', async () => {
    const { evaluateComicSource } = await loadBridge();

    mockCreateVeneraWorker
      .mockImplementationOnce(() => makeHandle())
      .mockImplementationOnce(() => makeHandle());

    await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: 'script-A' },
    );
    const h0 = createdWorkers[0] as MockHandle;

    await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: 'script-B' },
    );
    const h1 = createdWorkers[1] as MockHandle;

    expect(mockCreateVeneraWorker).toHaveBeenCalledTimes(2);
    expect(h0.terminate).toHaveBeenCalledTimes(1);
    expect(h1.terminate).not.toHaveBeenCalled();
  });

  it('creates separate workers for different sourceKeys', async () => {
    const { evaluateComicSource } = await loadBridge();

    await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: 'A' },
    );
    await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'b' },
      { sourceKey: 'src2', script: 'B' },
    );

    expect(mockCreateVeneraWorker).toHaveBeenCalledTimes(2);
    expect(createdWorkers).toHaveLength(2);
  });

  it('propagates error results from worker', async () => {
    const { evaluateComicSource } = await loadBridge();

    mockCreateVeneraWorker.mockImplementation(() =>
      makeHandle(
        vi.fn().mockResolvedValue({
          type: 'result',
          id: 1,
          ok: false,
          operation: 'loadInfo',
          error: 'not found',
        }),
      ),
    );

    const r = await evaluateComicSource(
      'loadInfo',
      { operation: 'loadInfo', bookId: '99' },
      { sourceKey: 'src1', script: 'A' },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not found');
  });

  it('catches thrown errors from worker send', async () => {
    const { evaluateComicSource } = await loadBridge();

    mockCreateVeneraWorker.mockImplementation(() =>
      makeHandle(vi.fn().mockRejectedValue(new Error('timeout after 45000ms'))),
    );

    const r = await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: 'A' },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('timeout');
  });

  it('rejects empty sourceKey or script without creating worker', async () => {
    const { evaluateComicSource } = await loadBridge();

    const r1 = await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: '', script: 'A' },
    );
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain('sourceKey');

    const r2 = await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: '' },
    );
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('script');

    expect(mockCreateVeneraWorker).not.toHaveBeenCalled();
  });

  it('terminateVeneraBridge terminates specific source', async () => {
    const { evaluateComicSource, terminateVeneraBridge, activeVeneraBridgeKeys } =
      await loadBridge();

    await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'a' },
      { sourceKey: 'src1', script: 'A' },
    );
    await evaluateComicSource(
      'search',
      { operation: 'search', keyword: 'b' },
      { sourceKey: 'src2', script: 'B' },
    );
    const h0 = createdWorkers[0] as MockHandle;
    const h1 = createdWorkers[1] as MockHandle;

    terminateVeneraBridge('src1');
    expect(h0.terminate).toHaveBeenCalledTimes(1);
    expect(h1.terminate).not.toHaveBeenCalled();
    expect(activeVeneraBridgeKeys()).toEqual(['src2']);

    terminateVeneraBridge();
    expect(h1.terminate).toHaveBeenCalledTimes(1);
    expect(activeVeneraBridgeKeys()).toEqual([]);
  });

  it('terminates all workers on idle timeout', async () => {
    vi.useFakeTimers();
    try {
      const { evaluateComicSource, activeVeneraBridgeKeys } = await loadBridge();

      await evaluateComicSource(
        'search',
        { operation: 'search', keyword: 'a' },
        { sourceKey: 'src1', script: 'A' },
      );
      expect(activeVeneraBridgeKeys()).toContain('src1');
      const h = createdWorkers[0] as MockHandle;

      await vi.advanceTimersByTimeAsync(60_001);
      expect(h.terminate).toHaveBeenCalled();
      expect(activeVeneraBridgeKeys()).not.toContain('src1');
    } finally {
      vi.useRealTimers();
    }
  });
});
