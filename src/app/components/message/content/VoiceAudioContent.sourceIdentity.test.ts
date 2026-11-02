import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceAudioContent } from './VoiceAudioContent';

const mocks = vi.hoisted(() => ({
  downloadedMediaUrls: [] as string[],
  downloadMedia: vi.fn(async (mediaUrl: string) => {
    mocks.downloadedMediaUrls.push(mediaUrl);
    return new Blob([mediaUrl], { type: 'audio/ogg' });
  }),
  playing: false,
  setPlaying: vi.fn(),
}));

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('span', props),
  IconButton: React.forwardRef<
    HTMLButtonElement,
    { children?: React.ReactNode; onClick?: () => void }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  ),
  Icons: {
    Pause: 'pause',
    Play: 'play',
    VerticalDots: 'vertical-dots',
  },
  Menu: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? React.createElement('div', { 'data-popout': 'true' }, content) : null,
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
}));

vi.mock('./VoiceAudioContent.css', () => ({
  Audio: 'Audio',
  Title: 'Title',
  Controls: 'Controls',
  Error: 'Error',
  Capsule: 'Capsule',
  MoreCell: 'MoreCell',
  MoreMenu: 'MoreMenu',
  MoreMenuAction: 'MoreMenuAction',
  MoreMenuMeta: 'MoreMenuMeta',
  MoreMenuMetaLabel: 'MoreMenuMetaLabel',
  MoreMenuMetaValue: 'MoreMenuMetaValue',
  PlayCell: 'PlayCell',
  PlayButton: 'PlayButton',
  PlayIcon: 'PlayIcon',
  RateCell: 'RateCell',
  Root: 'Root',
  Time: 'Time',
  WaveformCell: 'WaveformCell',
}));

vi.mock('../../voice/VoicePlaybackRateButton', () => ({
  VoicePlaybackRateButton: () => React.createElement('button', { 'aria-label': 'Playback speed' }),
}));

vi.mock('../../voice/VoiceVolumeButton', () => ({
  VoiceVolumeButton: () => React.createElement('button', { 'aria-label': 'Voice volume' }),
}));

vi.mock('../../voice/VoiceWaveform', () => ({
  VoiceWaveform: ({
    label,
    onSeekProgress,
  }: {
    label: string;
    onSeekProgress: (progress: number) => void;
  }) =>
    React.createElement('button', {
      'aria-label': label,
      onClick: () => onSeekProgress(0.25),
    }),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../hooks/media', () => ({
  useMediaLoading: () => ({ loading: false }),
  useMediaPlay: () => ({ playing: mocks.playing, setPlaying: mocks.setPlaying }),
  useMediaPlayTimeCallback: () => undefined,
}));

vi.mock('../../../hooks/useThrottle', () => ({
  useThrottle: (callback: unknown) => callback,
}));

vi.mock('../FileHeader', () => ({
  FileDownloadButton: () => React.createElement('button', { 'aria-label': 'Download audio' }),
}));

vi.mock('../../../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: (_mx: unknown, source: { mxcUri: string }) =>
    mocks.downloadMedia(`https://media.example/${source.mxcUri}`),
}));

const renderVoiceAudioContent = (url: string) =>
  React.createElement(
    Provider,
    { store: createStore() },
    React.createElement(VoiceAudioContent, {
      mimeType: 'audio/ogg',
      url,
      info: {
        mimetype: 'audio/ogg',
        duration: 10000,
      },
      waveform: [0, 512, 1024],
    })
  );

const flushAsyncSource = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

describe('VoiceAudioContent media identity', () => {
  let renderer: ReactTestRenderer;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.downloadedMediaUrls = [];
    mocks.downloadMedia.mockReset();
    mocks.downloadMedia.mockImplementation(async (mediaUrl: string) => {
      mocks.downloadedMediaUrls.push(mediaUrl);
      return new Blob([mediaUrl], { type: 'audio/ogg' });
    });
    mocks.playing = false;
    mocks.setPlaying.mockReset();
    createObjectURL = vi.fn(() => `blob:${mocks.downloadedMediaUrls.at(-1)}`);
    revokeObjectURL = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined as unknown as ReactTestRenderer;
    vi.unstubAllGlobals();
  });

  it('loads the new voice blob after a mounted player changes media identity', async () => {
    await act(async () => {
      renderer = create(renderVoiceAudioContent('mxc://mindroom/voice-a'));
    });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsyncSource();
    });

    expect(mocks.downloadedMediaUrls).toEqual(['https://media.example/mxc://mindroom/voice-a']);
    expect(renderer.root.findByType('source').props.src).toBe(
      'blob:https://media.example/mxc://mindroom/voice-a'
    );

    await act(async () => {
      renderer.update(renderVoiceAudioContent('mxc://mindroom/voice-b'));
      await flushAsyncSource();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith(
      'blob:https://media.example/mxc://mindroom/voice-a'
    );

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsyncSource();
    });

    expect(mocks.downloadedMediaUrls).toEqual([
      'https://media.example/mxc://mindroom/voice-a',
      'https://media.example/mxc://mindroom/voice-b',
    ]);
    expect(mocks.setPlaying).not.toHaveBeenCalled();
    expect(renderer.root.findByType('source').props.src).toBe(
      'blob:https://media.example/mxc://mindroom/voice-b'
    );
  });

  it('loads the new voice blob for a first seek after media identity changes', async () => {
    await act(async () => {
      renderer = create(renderVoiceAudioContent('mxc://mindroom/voice-a'));
    });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsyncSource();
    });

    await act(async () => {
      renderer.update(renderVoiceAudioContent('mxc://mindroom/voice-b'));
      await flushAsyncSource();
    });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick();
      await flushAsyncSource();
    });

    expect(mocks.downloadedMediaUrls).toEqual([
      'https://media.example/mxc://mindroom/voice-a',
      'https://media.example/mxc://mindroom/voice-b',
    ]);
    expect(renderer.root.findByType('source').props.src).toBe(
      'blob:https://media.example/mxc://mindroom/voice-b'
    );
  });

  it('keeps the new media play and seek intent when a stale source load rejects', async () => {
    const audioElements: { currentTime: number; duration: number; readyState: number }[] = [];
    const voiceA = createDeferred<Blob>();
    const voiceB = createDeferred<Blob>();
    mocks.downloadMedia.mockImplementation((mediaUrl: string) => {
      mocks.downloadedMediaUrls.push(mediaUrl);
      if (mediaUrl.includes('voice-a')) return voiceA.promise;
      if (mediaUrl.includes('voice-b')) return voiceB.promise;
      return Promise.resolve(new Blob([mediaUrl], { type: 'audio/ogg' }));
    });

    await act(async () => {
      renderer = create(renderVoiceAudioContent('mxc://mindroom/voice-a'), {
        createNodeMock: (element) => {
          if (element.type !== 'audio') return null;
          const audio = { currentTime: 0, duration: 10, readyState: 0 };
          audioElements.push(audio);
          return audio;
        },
      });
    });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    await act(async () => {
      renderer.update(renderVoiceAudioContent('mxc://mindroom/voice-b'));
    });

    expect(renderer.root.findByType('audio').props.autoPlay).toBe(false);

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick();
    });

    await act(async () => {
      voiceA.reject(new Error('stale voice source replaced'));
      await flushAsyncSource();
    });

    await act(async () => {
      voiceB.resolve(new Blob(['voice-b'], { type: 'audio/ogg' }));
      await flushAsyncSource();
    });

    expect(renderer.root.findByType('audio').props.autoPlay).toBe(true);
    const currentAudio = audioElements[audioElements.length - 1];
    expect(currentAudio.currentTime).toBe(0);
    currentAudio.readyState = 1;
    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });
    expect(currentAudio.currentTime).toBe(2.5);
    expect(audioElements.slice(0, -1).every((audio) => audio.currentTime === 0)).toBe(true);
    expect(renderer.root.findByType('source').props.src).toBe(
      'blob:https://media.example/mxc://mindroom/voice-b'
    );
  });
});
