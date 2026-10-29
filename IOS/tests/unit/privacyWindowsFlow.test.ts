/**
 * privacyWindowsFlow.test.ts — PIN 输入状态机 + 失败次数锁定的接线测试。
 *
 * 覆盖 Kotlin PrivacyWindows.kt L197-256（`LaunchedEffect(entered, currentMode)`
 * 的每个 `when(currentMode)` 分支）与 PrivacyManager.kt L73 / L79-83（失败锁定）
 * 在 `core/privacy/privacyWindows.ts` 上的落地。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/privacy/PrivacyWindows.kt
 *            novel-reader/app/src/main/java/com/example/data/PrivacyManager.kt
 */

import { describe, expect, it } from 'vitest';
import {
  PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE,
  PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP,
  PIN_ERROR_WRONG,
  PIN_SUBMIT_LENGTH,
  advancePinFlow,
  initialPinFlow,
  isPinSubmitReady,
  readPinLockout,
  resetPinFlow,
  settlePinFlow,
  verifyPinWithLockout,
  type PinFlowState,
} from '../../src/core/privacy/privacyWindows';
import {
  PIN_MAX_FAILURES,
  PIN_RETRY_AFTER_MS,
  derivePin,
  type PinStore,
} from '../../src/core/privacy/pinKdf';

/** 可控时钟 + 可注入 KDF 的 PinStore（不依赖 Date.now）。 */
function makeStore(initial: { salt: string; hash: string; kdfVersion?: 0 | 1 } = {
  salt: 'ab'.repeat(16),
  hash: '',
}): { store: PinStore; snapshot: () => { failures: number; retryAfter: number } } {
  let salt = initial.salt;
  let hash = initial.hash;
  let kdfVersion: 0 | 1 = initial.kdfVersion ?? 1;
  let failures = 0;
  let retryAfter = 0;
  const now = 1_000_000;
  const store: PinStore = {
    getSalt: () => salt,
    getHash: () => hash,
    getKdfVersion: () => kdfVersion,
    getFailures: () => failures,
    getRetryAfterMs: () => retryAfter,
    setPin: (s, h, v) => {
      salt = s;
      hash = h;
      kdfVersion = v;
    },
    // PrivacyManager.kt L79-83
    recordFailure: () => {
      failures += 1;
      if (failures >= PIN_MAX_FAILURES) retryAfter = now + PIN_RETRY_AFTER_MS;
      return failures;
    },
    clearFailures: () => {
      failures = 0;
      retryAfter = 0;
    },
    setEnabled: () => undefined,
    isEnabled: () => true,
    hasPin: () => hash !== '',
  };
  return { store, snapshot: () => ({ failures, retryAfter }) };
}

/** 已装好合法 6 位 PIN 的 store。 */
async function makeStoreWithPin(pin = '123456'): Promise<PinStore> {
  const salt = 'cd'.repeat(16);
  const hash = await derivePin(pin, salt);
  return makeStore({ salt, hash }).store;
}

/** 逐键喂入 + settle，等价于 Kotlin 的「输满 6 位 → effect 跑一次」。 */
function type(pin: string, start: PinFlowState): PinFlowState {
  let state = start;
  for (const ch of pin) {
    state = { ...state, entered: state.entered + ch, error: null };
  }
  return state;
}

/** 断言无副作用分支，并取回它携带的后继状态（`expect` 不会帮 TS 收窄联合）。 */
function pureAdvance(state: PinFlowState): PinFlowState {
  const action = advancePinFlow(state);
  if (action.type !== 'none') {
    throw new Error(`expected a pure transition, got ${action.type}`);
  }
  if (action.next === undefined) {
    throw new Error('expected the pure transition to carry a next state');
  }
  return action.next;
}

/** 断言无副作用且无后继状态（Kotlin L213 的 `return@LaunchedEffect`）。 */
function expectNoAdvance(state: PinFlowState): void {
  const action = advancePinFlow(state);
  if (action.type !== 'none') {
    throw new Error(`expected no advance, got ${action.type}`);
  }
  expect(action.next).toBeUndefined();
}

describe('privacyWindowsFlow — Kotlin L213 submit gate', () => {
  it('does nothing below 6 digits', () => {
    for (let len = 0; len < PIN_SUBMIT_LENGTH; len += 1) {
      const state: PinFlowState = { ...initialPinFlow('VERIFY'), entered: '1'.repeat(len) };
      expectNoAdvance(state);
    }
  });

  it('fires at exactly 6 digits', () => {
    const state: PinFlowState = { ...initialPinFlow('VERIFY'), entered: '123456' };
    expect(advancePinFlow(state).type).toBe('verify');
  });

  it('exposes the same gate through isPinSubmitReady', () => {
    expect(isPinSubmitReady('12345')).toBe(false);
    expect(isPinSubmitReady('123456')).toBe(true);
  });

  it('only checks length, not digits (Kotlin has no isValidPin here)', () => {
    const state: PinFlowState = { ...initialPinFlow('VERIFY'), entered: 'abcdef' };
    expect(advancePinFlow(state).type).toBe('verify');
  });
});

describe('privacyWindowsFlow — Kotlin L215-219 SETUP', () => {
  it('stores the first entry and moves to CONFIRM', () => {
    const state = type('123456', initialPinFlow('SETUP'));
    expect(pureAdvance(state)).toEqual({
      entered: '',
      error: null,
      firstSetup: '123456',
      currentMode: 'CONFIRM',
      changeFlow: false,
    });
  });

  it('never submits on the first entry (no onPinSet call)', () => {
    const state = type('123456', initialPinFlow('SETUP'));
    expect(advancePinFlow(state).type).not.toBe('set');
    // 且确实推进到了 CONFIRM，而不是停在 SETUP
    expect(pureAdvance(state).currentMode).toBe('CONFIRM');
  });
});

describe('privacyWindowsFlow — Kotlin L220-235 CONFIRM', () => {
  it('submits when both entries match (Kotlin L221)', () => {
    const state = type('123456', {
      ...initialPinFlow('CONFIRM'),
      firstSetup: '123456',
    });
    const action = advancePinFlow(state);
    expect(action.type).toBe('set');
    if (action.type !== 'set') throw new Error('unreachable');
    expect(action.pin).toBe('123456');
    // Kotlin L221 不做 reset
    expect(action.next).toBe(state);
  });

  it('falls back to SETUP on mismatch and clears firstSetup (Kotlin L226-233)', () => {
    const state = type('654321', {
      ...initialPinFlow('CONFIRM'),
      firstSetup: '123456',
    });
    expect(pureAdvance(state)).toEqual({
      entered: '',
      error: PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP,
      firstSetup: null,
      currentMode: 'SETUP',
      changeFlow: false,
    });
  });

  it('falls back to CHANGE_NEW (not SETUP) inside the change-password flow', () => {
    // Kotlin L202-204：changeFlow 标记「当前 CONFIRM 属于修改密码流程」
    const state = type('654321', {
      ...initialPinFlow('CONFIRM'),
      firstSetup: '123456',
      changeFlow: true,
    });
    expect(pureAdvance(state)).toEqual({
      entered: '',
      error: PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE,
      firstSetup: null,
      currentMode: 'CHANGE_NEW',
      changeFlow: false,
    });
  });
});

describe('privacyWindowsFlow — Kotlin L236-238 VERIFY', () => {
  it('asks for verification, dismisses on success, resets with an error on failure', () => {
    const state = type('123456', initialPinFlow('VERIFY'));
    const action = advancePinFlow(state);
    expect(action.type).toBe('verify');
    if (action.type !== 'verify') throw new Error('unreachable');
    expect(action.pin).toBe('123456');
    expect(action.dismissOnSuccess).toBe(true);
    // Kotlin L237 成功分支不 reset
    expect(action.nextOnSuccess).toBe(state);
    // Kotlin L237 失败分支 reset("密码错误，请重试")
    expect(action.nextOnFailure).toEqual({
      entered: '',
      error: PIN_ERROR_WRONG,
      firstSetup: null,
      currentMode: 'VERIFY',
      changeFlow: false,
    });
  });
});

describe('privacyWindowsFlow — Kotlin L239-244 CHANGE_OLD', () => {
  it('advances to CHANGE_NEW on success without dismissing', () => {
    const state = type('123456', initialPinFlow('CHANGE_OLD'));
    const action = advancePinFlow(state);
    expect(action.type).toBe('verify');
    if (action.type !== 'verify') throw new Error('unreachable');
    expect(action.dismissOnSuccess).toBe(false);
    expect(action.nextOnSuccess).toEqual({
      entered: '',
      error: null,
      firstSetup: null,
      currentMode: 'CHANGE_NEW',
      changeFlow: false,
    });
    expect(action.nextOnFailure).toEqual({
      entered: '',
      error: PIN_ERROR_WRONG,
      firstSetup: null,
      currentMode: 'CHANGE_OLD',
      changeFlow: false,
    });
  });
});

describe('privacyWindowsFlow — Kotlin L245-254 CHANGE_NEW', () => {
  it('requires a second confirmation entry (2026-09-21 修复)', () => {
    const state = type('123456', initialPinFlow('CHANGE_NEW'));
    // 绝不直接 set —— 否则手滑输错 6 位会永久锁死隐私分类
    expect(advancePinFlow(state).type).not.toBe('set');
    expect(pureAdvance(state)).toEqual({
      entered: '',
      error: null,
      firstSetup: '123456',
      currentMode: 'CONFIRM',
      changeFlow: true,
    });
  });

  it('completes the full change-password happy path', () => {
    // CHANGE_OLD → CHANGE_NEW → CONFIRM → set
    const old = type('111111', initialPinFlow('CHANGE_OLD'));
    const step1 = advancePinFlow(old);
    expect(step1.type).toBe('verify');
    if (step1.type !== 'verify') throw new Error('unreachable');
    const newPinState = step1.nextOnSuccess;

    const typedNew = type('222222', newPinState);
    const confirming = pureAdvance(typedNew);
    expect(confirming.currentMode).toBe('CONFIRM');

    const typedConfirm = type('222222', confirming);
    const step3 = advancePinFlow(typedConfirm);
    expect(step3.type).toBe('set');
    if (step3.type !== 'set') throw new Error('unreachable');
    expect(step3.pin).toBe('222222');
  });
});

describe('privacyWindowsFlow — reset + settle helpers', () => {
  it('resetPinFlow clears the entry and sets the message', () => {
    const state = type('123456', initialPinFlow('SETUP'));
    expect(resetPinFlow(state)).toEqual({ ...state, entered: '', error: null });
    expect(resetPinFlow(state, 'boom')).toEqual({ ...state, entered: '', error: 'boom' });
  });

  it('initialPinFlow seeds currentMode only', () => {
    expect(initialPinFlow('CHANGE_NEW')).toEqual({
      entered: '',
      error: null,
      firstSetup: null,
      currentMode: 'CHANGE_NEW',
      changeFlow: false,
    });
  });

  it('settlePinFlow chains pure transitions (SETUP → CONFIRM in one pass)', () => {
    const settled = settlePinFlow(type('123456', initialPinFlow('SETUP')));
    expect(settled.currentMode).toBe('CONFIRM');
    expect(settled.firstSetup).toBe('123456');
    expect(settled.entered).toBe('');
  });

  it('settlePinFlow stops at the first side-effecting action', () => {
    const verifying = settlePinFlow(type('123456', initialPinFlow('VERIFY')));
    // VERIFY 不改变状态（结果要等 onPinVerified）
    expect(verifying.entered).toBe('123456');
    expect(verifying.currentMode).toBe('VERIFY');
  });

  it('settlePinFlow is idempotent', () => {
    const once = settlePinFlow(type('123456', initialPinFlow('SETUP')));
    expect(settlePinFlow(once)).toBe(once);
  });

  it('settlePinFlow terminates on a pathological state', () => {
    // entered 为空 → 立即返回原对象
    const empty = initialPinFlow('SETUP');
    expect(settlePinFlow(empty)).toBe(empty);
  });
});

describe('privacyWindowsFlow — PIN attempt lockout wiring (PrivacyManager.kt L73/L79-83)', () => {
  it('reports a clean state before any attempt', async () => {
    const store = await makeStoreWithPin();
    const lockout = readPinLockout(store, 1_000_000);
    expect(lockout.failures).toBe(0);
    expect(lockout.locked).toBe(false);
    expect(lockout.remainingMs).toBe(0);
    expect(lockout.maxFailures).toBe(5);
    expect(lockout.cooldownMs).toBe(30_000);
  });

  it('accepts the correct PIN and clears the counters', async () => {
    const store = await makeStoreWithPin();
    const result = await verifyPinWithLockout('123456', { store, now: () => 1_000_000 });
    expect(result.ok).toBe(true);
    expect(result.shortCircuited).toBe(false);
    expect(result.lockout.failures).toBe(0);
  });

  it('counts a wrong PIN and locks out on the 5th failure', async () => {
    const salt = 'cd'.repeat(16);
    const hash = await derivePin('123456', salt);
    const now = 1_000_000;
    const { store, snapshot } = makeStore({ salt, hash });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await verifyPinWithLockout('000000', { store, now: () => now });
      expect(result.ok).toBe(false);
      expect(result.shortCircuited).toBe(false);
      expect(result.lockout.failures).toBe(attempt);
      expect(result.lockout.locked).toBe(false);
      expect(snapshot().retryAfter).toBe(0);
    }

    const fifth = await verifyPinWithLockout('000000', { store, now: () => now });
    expect(fifth.ok).toBe(false);
    expect(fifth.lockout.failures).toBe(5);
    expect(fifth.lockout.locked).toBe(true);
    expect(fifth.lockout.remainingMs).toBe(PIN_RETRY_AFTER_MS);
    expect(snapshot().retryAfter).toBe(now + PIN_RETRY_AFTER_MS);
  });

  it('short-circuits while locked, even for the CORRECT pin', async () => {
    const salt = 'cd'.repeat(16);
    const hash = await derivePin('123456', salt);
    const now = 1_000_000;
    const { store } = makeStore({ salt, hash });
    for (let i = 0; i < PIN_MAX_FAILURES; i += 1) {
      await verifyPinWithLockout('000000', { store, now: () => now });
    }
    // 锁定期内：正确的 PIN 也直接返回 false（PrivacyManager L73）
    const during = await verifyPinWithLockout('123456', { store, now: () => now + 1 });
    expect(during.ok).toBe(false);
    expect(during.shortCircuited).toBe(true);
    // 且失败计数不再增长（L73 早于 L79 的计数）
    expect(during.lockout.failures).toBe(PIN_MAX_FAILURES);
  });

  it('unlocks once the 30s cooldown has elapsed', async () => {
    const salt = 'cd'.repeat(16);
    const hash = await derivePin('123456', salt);
    const now = 1_000_000;
    const { store } = makeStore({ salt, hash });
    for (let i = 0; i < PIN_MAX_FAILURES; i += 1) {
      await verifyPinWithLockout('000000', { store, now: () => now });
    }
    const justBefore = await verifyPinWithLockout('123456', {
      store,
      now: () => now + PIN_RETRY_AFTER_MS - 1,
    });
    expect(justBefore.shortCircuited).toBe(true);

    const after = await verifyPinWithLockout('123456', {
      store,
      now: () => now + PIN_RETRY_AFTER_MS,
    });
    expect(after.ok).toBe(true);
    expect(after.shortCircuited).toBe(false);
    expect(after.lockout.locked).toBe(false);
  });

  it('never counts a malformed PIN (PrivacyManager L72 early return)', async () => {
    const store = await makeStoreWithPin();
    const result = await verifyPinWithLockout('12345', { store, now: () => 1_000_000 });
    expect(result.ok).toBe(false);
    expect(result.lockout.failures).toBe(0);
  });
});
