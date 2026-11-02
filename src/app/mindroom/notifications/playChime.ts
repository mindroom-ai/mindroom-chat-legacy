const playingSources = new Set<string>();

// Plays a short notification sound through Web Audio rather than an <audio> element. On iOS,
// WebKit gives any page that has played an audible <audio> element the playback audio-session
// category, which stops music in other apps; a page playing only Web Audio gets the ambient
// category, which mixes with it (MediaSessionManagerCocoa::updateSessionState in WebKit).
export const playChime = async (src: string): Promise<void> => {
  // Like play() on an element that is already playing, a chime that is still sounding absorbs a
  // second one, so one sync with messages in several rooms chimes once.
  if (typeof AudioContext === 'undefined' || playingSources.has(src)) return;
  playingSources.add(src);
  let context: AudioContext | undefined;
  try {
    // Bounded, so a stalled request cannot hold the guard above and mute later chimes.
    const data = await (await fetch(src, { signal: AbortSignal.timeout(10000) })).arrayBuffer();
    const audioContext = new AudioContext();
    context = audioContext;
    const buffer = await audioContext.decodeAudioData(data);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    await new Promise<void>((resolve) => {
      // A context the autoplay policy keeps suspended never plays, so never ends. Close it anyway,
      // so it cannot play a stale chime later, once the browser lets it start.
      const timeout = setTimeout(resolve, buffer.duration * 1000 + 2000);
      source.onended = () => {
        clearTimeout(timeout);
        resolve();
      };
      source.start();
    });
  } finally {
    playingSources.delete(src);
    context?.close().catch(() => undefined);
  }
};
