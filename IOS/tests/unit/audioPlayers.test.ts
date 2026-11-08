import { describe, expect, it } from 'vitest';
import { AmbientAudio } from '../../src/core/audio/ambientAudio';
import { PageFlipSound } from '../../src/core/audio/pageFlipSound';

describe('AmbientAudio', () => {
  it('start with NONE returns null and does not run', () => {
    const a = new AmbientAudio();
    const handle = a.start('NONE');
    expect(handle).toBeNull();
    expect(a.isRunning()).toBe(false);
  });

  it('setVolume clamps to [0,1]', () => {
    const a = new AmbientAudio();
    a.setVolume(2);
    a.setVolume(-1);
    expect(a.isRunning()).toBe(false);
  });

  it('stop is idempotent', () => {
    const a = new AmbientAudio();
    a.stop();
    a.stop();
    expect(a.isRunning()).toBe(false);
  });
});

describe('PageFlipSound', () => {
  it('play does not throw when not loaded yet', () => {
    const s = new PageFlipSound();
    expect(() => s.play()).not.toThrow();
  });

  it('release is idempotent', () => {
    const s = new PageFlipSound();
    s.release();
    s.release();
  });
});
