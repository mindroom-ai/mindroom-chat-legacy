// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachComputerClipboard,
  isApplePlatform,
  MAX_PASTE_BYTES,
  type ClipboardRfb,
  type ComputerClipboardOptions,
} from './computerClipboard';

const V_KEYSYM = 0x76;
const SHIFT_V_KEYSYM = 0x56;
const CONTROL_L_KEYSYM = 0xffe3;
const SHIFT_L_KEYSYM = 0xffe1;

type RfbCall = ['paste', string] | ['key', number, string | null, boolean | undefined];

const createRfb = () => {
  const calls: RfbCall[] = [];
  let listener: EventListener | undefined;
  return {
    calls,
    addEventListener: vi.fn((_name: 'clipboard', next: EventListener) => {
      listener = next;
    }),
    removeEventListener: vi.fn((_name: 'clipboard', next: EventListener) => {
      if (listener === next) listener = undefined;
    }),
    clipboardPasteFrom: vi.fn((text: string) => {
      calls.push(['paste', text]);
    }),
    sendKey: vi.fn((keysym: number, code: string | null, down?: boolean) => {
      calls.push(['key', keysym, code, down]);
    }),
    emitClipboard: (text: string) => listener?.(new CustomEvent('clipboard', { detail: { text } })),
  } satisfies ClipboardRfb & Record<string, unknown>;
};

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

const blobText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const settled = (promise: Promise<unknown>) => {
  const state = { value: 'pending' as 'pending' | 'resolved' | 'rejected' };
  promise.then(
    () => {
      state.value = 'resolved';
    },
    () => {
      state.value = 'rejected';
    }
  );
  return state;
};

const nextTask = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('attachComputerClipboard', () => {
  let target: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let rfb: ReturnType<typeof createRfb>;
  let clipboard: {
    readText: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeText: ReturnType<typeof vi.fn>;
  };
  let onPaste: ReturnType<typeof vi.fn>;
  let canvasKeys: ReturnType<typeof vi.fn>;
  let controlling: boolean;
  let detach: (() => void) | undefined;

  const attach = (options: Partial<ComputerClipboardOptions> = {}) => {
    detach = attachComputerClipboard(target, rfb, {
      isControlling: () => controlling,
      apple: false,
      readOnShortcut: false,
      clipboard,
      onPaste,
      ...options,
    });
  };

  const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit, on: Element = canvas) => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    on.dispatchEvent(event);
    return event;
  };

  const paste = (text: string, on: Element = canvas) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    on.dispatchEvent(event);
    return event;
  };

  const writtenItem = (index = 0) => {
    const [items] = clipboard.write.mock.calls[index] as [FakeClipboardItem[]];
    return items[0].items['text/plain'];
  };

  beforeEach(() => {
    target = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    target.append(canvas);
    document.body.append(target);
    canvas.focus();
    canvasKeys = vi.fn();
    canvas.addEventListener('keydown', canvasKeys);
    canvas.addEventListener('keyup', canvasKeys);
    controlling = true;
    rfb = createRfb();
    clipboard = {
      readText: vi.fn(() => Promise.resolve('')),
      write: vi.fn(() => Promise.resolve()),
      writeText: vi.fn(() => Promise.resolve()),
    };
    onPaste = vi.fn();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    target.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const pressLeftCtrl = () =>
    key('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });

  const chord = (keysym = V_KEYSYM): RfbCall[] => [
    ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
    ['key', keysym, 'KeyV', true],
    ['key', keysym, 'KeyV', false],
    ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
  ];

  it('pastes the local text, then presses v under the held modifier', () => {
    attach();

    pressLeftCtrl();
    const shortcut = key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    expect(shortcut.defaultPrevented).toBe(false);
    expect(canvasKeys.mock.calls.map(([event]) => event)).not.toContain(shortcut);

    const event = paste('hello');
    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
    expect(event.defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenCalledWith('sent');
  });

  it('presses a held left Ctrl again before v, without releasing it', () => {
    // noVNC on Windows holds a left-Ctrl press back up to 100 ms to detect AltGr.
    attach();

    pressLeftCtrl();
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('hello');

    expect(rfb.calls.slice(1)).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
    expect(rfb.calls).not.toContainEqual(['key', CONTROL_L_KEYSYM, 'ControlLeft', false]);
  });

  it('sends the whole chord under a right Ctrl', () => {
    // It releases only its own Control_L, so noVNC's Control_R stays down.
    attach();

    key('keydown', { key: 'Control', code: 'ControlRight', ctrlKey: true, location: 2 });
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('hello');

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it('sends the whole chord for a Ctrl pressed outside the screen', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('hello');

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it('sends the whole chord for a Ctrl pressed while the wrapper has focus', () => {
    // noVNC listens only on its canvas, so it never sees this press.
    target.tabIndex = 0;
    target.focus();
    attach();

    key('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true }, target);
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true }, target);
    paste('hello', target);

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it('sends the whole chord for a Ctrl pressed while watching', () => {
    controlling = false;
    attach();

    pressLeftCtrl();
    controlling = true;
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('hello');

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it('sends the whole chord once blur or focus out drops the held Ctrl', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    attach();

    pressLeftCtrl();
    window.dispatchEvent(new Event('blur'));
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('hello');
    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);

    rfb.calls.length = 0;
    pressLeftCtrl();
    canvas.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('world');
    expect(rfb.calls).toEqual([['paste', 'world'], ...chord()]);
    outside.remove();
  });

  it('sends V for a shifted paste', () => {
    attach();

    pressLeftCtrl();
    key('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
    paste('hello');

    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', SHIFT_V_KEYSYM, 'KeyV', true],
      ['key', SHIFT_V_KEYSYM, 'KeyV', false],
    ]);
  });

  it('sends v for a menu paste once blur drops a held Shift', () => {
    // The Shift keyup lands outside the window, and a menu paste has no keydown.
    attach();

    key('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    window.dispatchEvent(new Event('blur'));
    paste('hello');

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it('sends the whole Ctrl+V chord for a paste without the shortcut', () => {
    attach();

    paste('hello');

    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
    ]);
  });

  it('sends the chord again once the modifier is up', () => {
    attach();

    pressLeftCtrl();
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    key('keyup', { key: 'Control', code: 'ControlLeft' });
    paste('hello');

    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
    ]);
  });

  it('still presses v for a paste without text', () => {
    attach();

    pressLeftCtrl();
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('');

    expect(rfb.calls).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
    expect(onPaste).toHaveBeenCalledWith('sent');
  });

  it('takes a paste aimed outside the screen while the screen has focus', () => {
    const bodyPaste = vi.fn();
    document.body.addEventListener('paste', bodyPaste);
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    const event = paste('hello', document.body);

    expect(rfb.calls[0]).toEqual(['paste', 'hello']);
    expect(event.defaultPrevented).toBe(true);
    expect(bodyPaste).not.toHaveBeenCalled();
    document.body.removeEventListener('paste', bodyPaste);
  });

  it('ignores a paste while focus is outside the screen', () => {
    const input = document.createElement('input');
    document.body.append(input);
    attach();

    input.focus();
    const event = paste('hello', input);

    expect(rfb.calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    input.remove();
  });

  const auxClick = (button: number, on: Element = canvas) =>
    on.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }));

  it('sends nothing for the paste of a middle click on the screen', () => {
    // Linux's primary-selection paste: noVNC sent the click, so the remote pastes its own.
    const canvasPaste = vi.fn();
    canvas.addEventListener('paste', canvasPaste);
    attach();

    auxClick(1);
    const event = paste('only highlighted');

    expect(rfb.calls).toEqual([]);
    expect(onPaste).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(canvasPaste).not.toHaveBeenCalled();

    // The mark is used up by that paste.
    paste('hello');
    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it('pastes again once the middle click is a task old, or a key went down since', async () => {
    attach();

    auxClick(1);
    await nextTask();
    paste('hello');
    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);

    rfb.calls.length = 0;
    auxClick(1);
    key('keydown', { key: 'a', code: 'KeyA' });
    paste('world');
    expect(rfb.calls).toEqual([['paste', 'world'], ...chord()]);
  });

  it('takes the paste after another button or a middle click outside the screen', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    attach();

    auxClick(2);
    paste('hello');
    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);

    rfb.calls.length = 0;
    auxClick(1, outside);
    paste('world');
    expect(rfb.calls).toEqual([['paste', 'world'], ...chord()]);
    outside.remove();
  });

  it('refuses a paste over 512 KiB', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('a'.repeat(MAX_PASTE_BYTES));
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenLastCalledWith('sent');

    rfb.clipboardPasteFrom.mockClear();
    rfb.sendKey.mockClear();
    // 524,290 UTF-8 bytes in 262,145 characters.
    const event = paste('é'.repeat(262_145));

    expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
    expect(rfb.sendKey).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenLastCalledWith('too-large');
  });

  it('leaves Alt+V and composing keydowns to noVNC', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, altKey: true });
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, isComposing: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(rfb.calls).toEqual([]);
  });

  it("takes a non-Latin layout's Ctrl+V by its code", () => {
    attach();

    const shortcut = key('keydown', { key: 'м', code: 'KeyV', ctrlKey: true });
    expect(shortcut.defaultPrevented).toBe(false);
    expect(canvasKeys).not.toHaveBeenCalled();
    paste('hello');

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
  });

  it("copies and cuts with a non-Latin layout's Ctrl+C and X by their code", () => {
    attach();

    key('keydown', { key: 'с', code: 'KeyC', ctrlKey: true });
    expect(clipboard.write).toHaveBeenCalledTimes(1);
    key('keydown', { key: 'ч', code: 'KeyX', ctrlKey: true });
    expect(clipboard.write).toHaveBeenCalledTimes(2);
    expect(canvasKeys).toHaveBeenCalledTimes(2);
  });

  it('leaves a symbol or dead key on a letter key to noVNC, such as BÉPO Ctrl+.', () => {
    attach();

    key('keydown', { key: '.', code: 'KeyV', ctrlKey: true });
    key('keydown', { key: 'Dead', code: 'KeyC', ctrlKey: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it('matches a Latin layout by key, not by position', () => {
    // Dvorak: v sits on the Period key, and k and j on the V and C keys.
    attach();

    key('keydown', { key: 'v', code: 'Period', ctrlKey: true });
    expect(canvasKeys).not.toHaveBeenCalled();
    const k = key('keydown', { key: 'k', code: 'KeyV', ctrlKey: true });
    const j = key('keydown', { key: 'j', code: 'KeyC', ctrlKey: true });

    expect(canvasKeys.mock.calls.map(([event]) => event)).toEqual([k, j]);
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it('does nothing while watching', () => {
    controlling = false;
    attach({ apple: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true });
    const event = paste('hello');

    expect(canvasKeys).toHaveBeenCalledTimes(3);
    expect(rfb.calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it('copies the next remote clipboard text for a copy gesture', async () => {
    attach();

    const event = key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(canvasKeys).toHaveBeenCalledWith(event);
    expect(clipboard.write).toHaveBeenCalledTimes(1);

    rfb.emitClipboard('from remote');
    const blob = await writtenItem();

    expect(blob.type).toBe('text/plain');
    await expect(blobText(blob)).resolves.toBe('from remote');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('cuts the same way as copy', async () => {
    attach();

    const event = key('keydown', { key: 'x', code: 'KeyX', ctrlKey: true });
    expect(canvasKeys).toHaveBeenCalledWith(event);
    expect(clipboard.write).toHaveBeenCalledTimes(1);

    rfb.emitClipboard('cut text');
    await expect(writtenItem().then(blobText)).resolves.toBe('cut text');
  });

  it('rejects a copy that gets no reply within 2 s', async () => {
    vi.useFakeTimers();
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    const state = settled(writtenItem());

    await vi.advanceTimersByTimeAsync(1_999);
    expect(state.value).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(state.value).toBe('rejected');
  });

  it('replaces a pending copy with a newer one', async () => {
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');

    await expect(writtenItem(0)).rejects.toBeInstanceOf(Error);
    await expect(writtenItem(1).then(blobText)).resolves.toBe('from remote');
  });

  it('rejects a pending copy whose reply comes after control ended', async () => {
    // noVNC drops clipboard events only once the screen's effect has set viewOnly.
    vi.useFakeTimers();
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    const state = settled(writtenItem());
    controlling = false;
    rfb.emitClipboard('from remote');

    // Rejected by the reply itself, not by the 2 s reply timeout.
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value).toBe('rejected');
    // Nothing was synced, so the same text is still pushed.
    controlling = true;
    paste('from remote');
    expect(rfb.calls).toEqual([['paste', 'from remote'], ...chord()]);
  });

  it('ignores a remote clipboard push without a copy gesture', async () => {
    attach();

    rfb.emitClipboard('pushed by the server');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(clipboard.write).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('falls back to writeText without ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(clipboard.write).not.toHaveBeenCalled();
    rfb.emitClipboard('from remote');
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('from remote'));
  });

  it('swallows a failed clipboard write', async () => {
    clipboard.write.mockImplementation(() => Promise.reject(new Error('denied')));
    clipboard.writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');
    vi.stubGlobal('ClipboardItem', undefined);
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');

    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
  });

  const copyFromRemote = async (text: string) => {
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard(text);
    await nextTask();
  };

  it('sends only the keys to paste what a computer copy wrote, and pushes new text', async () => {
    attach();

    await copyFromRemote('from remote');
    rfb.calls.length = 0;
    const event = paste('from remote');
    expect(rfb.calls).toEqual(chord());
    expect(event.defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenLastCalledWith('sent');

    rfb.calls.length = 0;
    paste('new local text');
    expect(rfb.calls).toEqual([['paste', 'new local text'], ...chord()]);
  });

  it('sends only the keys after a computer copy written with writeText', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    attach();

    await copyFromRemote('from remote');
    expect(clipboard.writeText).toHaveBeenCalledWith('from remote');
    rfb.calls.length = 0;
    paste('from remote');

    expect(rfb.calls).toEqual(chord());
  });

  it('pushes the text of a copy whose local write failed', async () => {
    clipboard.write.mockImplementation(() => Promise.reject(new Error('denied')));
    clipboard.writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    attach();

    await copyFromRemote('from remote');
    rfb.calls.length = 0;
    paste('from remote');
    expect(rfb.calls).toEqual([['paste', 'from remote'], ...chord()]);

    vi.stubGlobal('ClipboardItem', undefined);
    await copyFromRemote('cut text');
    expect(clipboard.writeText).toHaveBeenCalledWith('cut text');
    rfb.calls.length = 0;
    paste('cut text');
    expect(rfb.calls).toEqual([['paste', 'cut text'], ...chord()]);
  });

  it('pushes the copied text when a paste raced the copy to the computer', async () => {
    let finishWrite = () => {};
    clipboard.write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        })
    );
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');
    await nextTask();
    // The older local text reaches the computer while the copy is still being written.
    paste('older local text');
    finishWrite();
    await nextTask();
    rfb.calls.length = 0;
    paste('from remote');

    expect(rfb.calls).toEqual([['paste', 'from remote'], ...chord()]);
  });

  it('pushes the same local text once', () => {
    attach();

    paste('one');
    paste('one');
    paste('two');
    paste('one');

    expect(rfb.calls).toEqual([
      ['paste', 'one'],
      ...chord(),
      ...chord(),
      ['paste', 'two'],
      ...chord(),
      ['paste', 'one'],
      ...chord(),
    ]);
  });

  it('sends only the keys for text over 512 KiB that a computer copy wrote', async () => {
    // Nothing is pushed, so nothing can reach the proxy's limit.
    const large = 'é'.repeat(262_145);
    attach();

    await copyFromRemote(large);
    rfb.calls.length = 0;
    paste(large);

    expect(rfb.calls).toEqual(chord());
    expect(onPaste).toHaveBeenLastCalledWith('sent');
  });

  it('maps Cmd to Ctrl on Apple, once per press', () => {
    attach({ apple: true });

    const press = key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    expect(rfb.calls).toEqual([['key', CONTROL_L_KEYSYM, 'ControlLeft', true]]);
    expect(press.defaultPrevented).toBe(true);
    expect(canvasKeys).not.toHaveBeenCalled();

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true, repeat: true });
    expect(rfb.calls).toHaveLength(1);

    const shortcut = key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    expect(shortcut.defaultPrevented).toBe(false);
    expect(canvasKeys).not.toHaveBeenCalled();
    paste('hello');
    expect(rfb.calls.slice(1)).toEqual([
      ['paste', 'hello'],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);

    const release = key('keyup', { key: 'Meta', code: 'MetaLeft' });
    expect(release.defaultPrevented).toBe(true);
    expect(rfb.calls.at(-1)).toEqual(['key', CONTROL_L_KEYSYM, 'ControlLeft', false]);
    expect(canvasKeys).not.toHaveBeenCalled();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    expect(canvasKeys).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the software keyboard textarea', true],
    ['the screen element', false],
  ])('maps no Cmd and starts no copy for keys on %s', async (_where, textarea) => {
    // noVNC hears only its canvas, so the letter typed with Cmd would never follow.
    let on: HTMLElement = target;
    if (textarea) {
      on = document.createElement('textarea');
      target.append(on);
    } else {
      target.tabIndex = 0;
    }
    on.focus();
    clipboard.readText.mockResolvedValueOnce('hello');
    attach({ apple: true, readOnShortcut: true });

    const cmd = key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }, on);
    key('keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true }, on);
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true }, on);
    key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true }, on);
    expect(cmd.defaultPrevented).toBe(false);
    expect(rfb.calls).toEqual([]);
    expect(clipboard.write).not.toHaveBeenCalled();

    // A paste from there still reaches the computer, with the whole chord.
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true }, on);
    await vi.waitFor(() => expect(onPaste).toHaveBeenCalledWith('sent'));
    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord()]);
    key('keyup', { key: 'Meta', code: 'MetaLeft' }, on);
    expect(rfb.calls).toHaveLength(5);
  });

  const releases = (keysym: number) =>
    rfb.sendKey.mock.calls.filter(([sent, , down]) => sent === keysym && down === false).length;

  const pressCmdShift = () => {
    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true });
  };

  it('releases a mapped Ctrl on window blur and on detach', () => {
    attach({ apple: true });

    pressCmdShift();
    window.dispatchEvent(new Event('blur'));
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);
    window.dispatchEvent(new Event('blur'));
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);

    pressCmdShift();
    detach?.();
    detach = undefined;
    expect(releases(CONTROL_L_KEYSYM)).toBe(2);
    expect(releases(SHIFT_L_KEYSYM)).toBe(2);
  });

  it('keeps Shift held under Cmd on Apple, so Cmd+Shift+Z is Ctrl+Shift+Z', () => {
    attach({ apple: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    const shift = key('keydown', {
      key: 'Shift',
      code: 'ShiftLeft',
      metaKey: true,
      shiftKey: true,
    });
    key('keydown', {
      key: 'Shift',
      code: 'ShiftLeft',
      metaKey: true,
      shiftKey: true,
      repeat: true,
    });
    const z = key('keydown', { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true });

    expect(shift.defaultPrevented).toBe(true);
    expect(rfb.calls).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', SHIFT_L_KEYSYM, 'ShiftLeft', true],
    ]);
    expect(canvasKeys.mock.calls).toEqual([[z]]);
    expect(z.defaultPrevented).toBe(false);

    const release = key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });
    expect(release.defaultPrevented).toBe(true);
    expect(rfb.calls.at(-1)).toEqual(['key', SHIFT_L_KEYSYM, 'ShiftLeft', false]);
    expect(canvasKeys).toHaveBeenCalledTimes(1);
  });

  it('releases a mapped Shift with Cmd, once', () => {
    attach({ apple: true });

    pressCmdShift();
    key('keyup', { key: 'Meta', code: 'MetaLeft', shiftKey: true });
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);

    const shiftUp = key('keyup', { key: 'Shift', code: 'ShiftLeft' });
    expect(shiftUp.defaultPrevented).toBe(false);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);
  });

  it('leaves Shift pressed before Cmd to noVNC', () => {
    attach({ apple: true });

    key('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true, shiftKey: true });
    key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(rfb.calls).toEqual([['key', CONTROL_L_KEYSYM, 'ControlLeft', true]]);
  });

  it('releases the mapped keys when focus leaves the screen', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const focusOut = (relatedTarget: EventTarget | null) =>
      canvas.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
    attach({ apple: true });

    pressCmdShift();
    focusOut(target);
    expect(releases(CONTROL_L_KEYSYM)).toBe(0);

    focusOut(outside);
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);

    pressCmdShift();
    focusOut(null);
    expect(releases(CONTROL_L_KEYSYM)).toBe(2);
    expect(releases(SHIFT_L_KEYSYM)).toBe(2);
    outside.remove();
  });

  it('leaves Meta and Shift alone off Apple', () => {
    attach();

    const press = key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true, shiftKey: true });
    key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });
    key('keyup', { key: 'Meta', code: 'MetaLeft' });

    expect(press.defaultPrevented).toBe(false);
    expect(canvasKeys).toHaveBeenCalledTimes(5);
    expect(rfb.calls).toEqual([]);
  });

  it('reads the local clipboard on the shortcut where the engine fires no paste', async () => {
    clipboard.readText.mockResolvedValueOnce('hello');
    attach({ apple: true, readOnShortcut: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    const shortcut = key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(canvasKeys).not.toHaveBeenCalled();
    expect(clipboard.readText).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(onPaste).toHaveBeenCalledWith('sent'));
    expect(rfb.calls).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['paste', 'hello'],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
  });

  it('sends the chord when Cmd is up before the read resolves', async () => {
    let resolveRead: (text: string) => void = () => undefined;
    clipboard.readText.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
    );
    attach({ apple: true, readOnShortcut: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    key('keyup', { key: 'Meta', code: 'MetaLeft' });
    rfb.calls.length = 0;
    resolveRead('hello');

    await vi.waitFor(() => expect(onPaste).toHaveBeenCalledWith('sent'));
    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
    ]);
  });

  it('sends nothing when the clipboard read is refused', async () => {
    clipboard.readText.mockRejectedValueOnce(new Error('denied'));
    attach({ readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(rfb.calls).toEqual([]);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it.each([
    [
      'watching starts',
      () => {
        controlling = false;
      },
    ],
    [
      'the screen closes',
      () => {
        detach?.();
        detach = undefined;
      },
    ],
  ])('sends nothing when %s before the read resolves', async (_when, interrupt) => {
    let resolveRead: (text: string) => void = () => undefined;
    clipboard.readText.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
    );
    attach({ readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    expect(clipboard.readText).toHaveBeenCalledTimes(1);
    interrupt();
    resolveRead('hello');
    await nextTask();

    expect(rfb.calls).toEqual([]);
    expect(onPaste).not.toHaveBeenCalled();
  });

  const deferRead = () => {
    let resolveRead: (text: string) => void = () => undefined;
    clipboard.readText.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
    );
    return (text: string) => resolveRead(text);
  };

  it('sends nothing when focus leaves the screen before the read resolves', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    const resolveRead = deferRead();
    attach({ readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    input.focus();
    resolveRead('hello');
    await nextTask();

    expect(rfb.calls).toEqual([]);
    expect(onPaste).not.toHaveBeenCalled();
    input.remove();
  });

  it('pastes only the latest of two pending reads', async () => {
    const resolveFirst = deferRead();
    const resolveSecond = deferRead();
    attach({ readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    resolveSecond('second');
    await nextTask();
    resolveFirst('first');
    await nextTask();

    expect(rfb.calls).toEqual([['paste', 'second'], ...chord()]);
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it('sends V for a shifted shortcut whose Shift is up before the read resolves', async () => {
    const resolveRead = deferRead();
    attach({ readOnShortcut: true });

    key('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
    key('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    resolveRead('hello');
    await nextTask();

    expect(rfb.calls).toEqual([['paste', 'hello'], ...chord(SHIFT_V_KEYSYM)]);
  });

  it('leaves the shortcuts to noVNC without a clipboard API', () => {
    attach({ clipboard: undefined, readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(rfb.calls).toEqual([]);
  });

  it('detaches every listener', async () => {
    vi.useFakeTimers();
    const listeners = [target, document, window].map((node) => ({
      added: vi.spyOn(node, 'addEventListener'),
      removed: vi.spyOn(node, 'removeEventListener'),
    }));
    attach({ apple: true });
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true });
    const pending = writtenItem();
    const state = settled(pending);
    const [, clipboardListener] = rfb.addEventListener.mock.calls[0];

    detach?.();
    detach = undefined;
    // Rejected by the detach itself, not by the 2 s reply timeout.
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value).toBe('rejected');
    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(rfb.removeEventListener).toHaveBeenCalledWith('clipboard', clipboardListener);
    listeners.forEach(({ added, removed }) => {
      expect(added.mock.calls.length).toBeGreaterThan(0);
      expect(removed.mock.calls).toEqual(expect.arrayContaining(added.mock.calls));
    });

    rfb.calls.length = 0;
    clipboard.write.mockClear();
    canvasKeys.mockClear();
    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true });
    key('keyup', { key: 'Meta', code: 'MetaLeft' });
    const event = paste('hello');
    window.dispatchEvent(new Event('blur'));

    expect(canvasKeys).toHaveBeenCalledTimes(4);
    expect(rfb.calls).toEqual([]);
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('isApplePlatform', () => {
  it.each([
    ['MacIntel', true],
    ['iPad', true],
    ['iPhone', true],
    ['Linux x86_64', false],
    ['Win32', false],
  ])('%s is %s', (platform, expected) => {
    expect(isApplePlatform(platform)).toBe(expected);
  });
});
