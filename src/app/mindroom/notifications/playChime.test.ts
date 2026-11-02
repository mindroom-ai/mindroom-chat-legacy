import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playChime } from './playChime';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  destination = {};

  source = { buffer: undefined, connect: vi.fn(), onended: undefined, start: vi.fn() } as {
    buffer: unknown;
    connect: ReturnType<typeof vi.fn>;
    onended: (() => void) | undefined;
    start: ReturnType<typeof vi.fn>;
  };

  close = vi.fn(() => Promise.resolve());

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  decodeAudioData = vi.fn(() => Promise.resolve({ duration: 0.5 }));

  createBufferSource = () => this.source;
}

const SRC = '/sound/notification.ogg';

describe('playChime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays the sound through Web Audio and closes the context when it ends', async () => {
    const played = playChime(SRC);
    await vi.advanceTimersByTimeAsync(0);
    const [context] = FakeAudioContext.instances;
    expect(context.source.start).toHaveBeenCalledOnce();

    expect(fetch).toHaveBeenCalledWith(SRC, { signal: expect.any(AbortSignal) });
    expect(context.source.buffer).toEqual({ duration: 0.5 });
    expect(context.source.connect).toHaveBeenCalledWith(context.destination);
    expect(context.close).not.toHaveBeenCalled();

    context.source.onended?.();
    await played;

    expect(context.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes a context the autoplay policy never lets play', async () => {
    const played = playChime(SRC);
    await vi.advanceTimersByTimeAsync(0);
    const [context] = FakeAudioContext.instances;
    expect(context.source.start).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2499);
    expect(context.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await played;

    expect(context.close).toHaveBeenCalledOnce();
  });

  it('chimes once for a second call while the sound is still playing', async () => {
    const played = playChime(SRC);
    await playChime(SRC);
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeAudioContext.instances).toHaveLength(1);

    FakeAudioContext.instances[0].source.onended?.();
    await played;
    const next = playChime(SRC);
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeAudioContext.instances).toHaveLength(2);
    FakeAudioContext.instances[1].source.onended?.();
    await next;
  });

  it('closes the context when the sound does not decode', async () => {
    const decodeError = new Error('EncodingError');
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        decodeAudioData = vi.fn(() => Promise.reject(decodeError));
      }
    );

    await expect(playChime(SRC)).rejects.toBe(decodeError);

    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
    expect(FakeAudioContext.instances[0].source.start).not.toHaveBeenCalled();

    await expect(playChime(SRC)).rejects.toBe(decodeError);
    expect(FakeAudioContext.instances).toHaveLength(2);
  });
});
