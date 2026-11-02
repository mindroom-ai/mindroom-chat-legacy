// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachComputerClipboard } from './computerClipboard';
import { SOFT_KEYBOARD_BUFFER, attachComputerSoftKeyboard } from './computerSoftKeyboard';

const BACKSPACE = 0xff08;
const RETURN = 0xff0d;
const CONTROL_L = 0xffe3;
const V = 0x76;

describe('attachComputerSoftKeyboard', () => {
  let input: HTMLTextAreaElement;
  let controlling: boolean;
  const sendKey = vi.fn();
  let detach: () => void;

  beforeEach(() => {
    controlling = true;
    sendKey.mockReset();
    input = document.createElement('textarea');
    document.body.append(input);
    detach = attachComputerSoftKeyboard(input, { sendKey }, { isControlling: () => controlling });
  });

  afterEach(() => {
    detach();
    input.remove();
    vi.useRealTimers();
  });

  const caretAtEnd = () => {
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  };

  // What a browser does for a keystroke: the field changes, then an input event fires.
  const change = (
    value: string,
    init: { inputType?: string; isComposing?: boolean; data?: string | null } = {}
  ) => {
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
  };

  // A character typed at the caret, which a reset left after the placeholders.
  const type = (text: string) =>
    change(input.value + text, { inputType: 'insertText', data: text });

  const keysyms = () => sendKey.mock.calls.map(([keysym]) => keysym);

  it('starts with the placeholders and the caret after them', () => {
    expect(SOFT_KEYBOARD_BUFFER.length).toBeGreaterThan(1);
    expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
    caretAtEnd();
  });

  it('types each character as its keysym, pressed and released', () => {
    type('a');
    type('A');
    type('é');
    type(' ');
    type('😀');

    // TigerVNC presses Shift itself for an uppercase keysym; only the keysym is sent.
    expect(sendKey.mock.calls).toEqual([
      [0x61, null],
      [0x41, null],
      [0xe9, null],
      [0x20, null],
      [0x0101f600, null],
    ]);
  });

  it('sends a BackSpace for each character taken off the placeholders', () => {
    change(SOFT_KEYBOARD_BUFFER.slice(0, -1), { inputType: 'deleteContentBackward' });
    expect(sendKey.mock.calls).toEqual([[BACKSPACE, null]]);

    // A word deleted at once takes all of them.
    change('', { inputType: 'deleteWordBackward' });
    expect(keysyms()).toEqual(Array(1 + SOFT_KEYBOARD_BUFFER.length).fill(BACKSPACE));
  });

  it('sends Return for a new line', () => {
    change(`${input.value}\n`, { inputType: 'insertLineBreak' });
    expect(sendKey.mock.calls).toEqual([[RETURN, null]]);
  });

  it('resets the placeholders after every change, so Backspace always has one to take', () => {
    type('a');
    expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
    caretAtEnd();

    for (let press = 0; press < 3 * SOFT_KEYBOARD_BUFFER.length; press += 1) {
      change(input.value.slice(0, -1), { inputType: 'deleteContentBackward' });
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
    }
    expect(keysyms()).toEqual([0x61, ...Array(3 * SOFT_KEYBOARD_BUFFER.length).fill(BACKSPACE)]);
    caretAtEnd();

    // Typed after a long run of them, a character is still just itself.
    sendKey.mockClear();
    type('b');
    expect(keysyms()).toEqual([0x62]);
  });

  it('types only what changed when the caret is among the placeholders', () => {
    // iOS moves the caret when the space bar is held and dragged.
    input.setSelectionRange(2, 2);
    change(`${SOFT_KEYBOARD_BUFFER.slice(0, 2)}x${SOFT_KEYBOARD_BUFFER.slice(2)}`, {
      inputType: 'insertText',
      data: 'x',
    });
    expect(keysyms()).toEqual([0x78]);
  });

  it('puts the caret back at the end when the field is focused', () => {
    input.setSelectionRange(0, 0);
    input.focus();
    caretAtEnd();
  });

  describe('composition', () => {
    beforeEach(() => vi.useFakeTimers());

    const compose = (type: 'compositionstart' | 'compositionend', data = '') =>
      input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
    const composing = (value: string) =>
      change(`${SOFT_KEYBOARD_BUFFER}${value}`, {
        inputType: 'insertCompositionText',
        isComposing: true,
      });

    it('sends the committed text once, as Chromium and Firefox order the events', () => {
      compose('compositionstart');
      composing('k');
      composing('ka');
      composing('カ');
      // Committed, but only sent once the task is over, as WebKit is still to put it in.
      compose('compositionend', 'カ');
      expect(sendKey).not.toHaveBeenCalled();
      expect(input.value).toBe(`${SOFT_KEYBOARD_BUFFER}カ`);

      vi.runAllTimers();
      expect(keysyms()).toEqual([0x04b6]);
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
      caretAtEnd();
      type('a');
      expect(keysyms()).toEqual([0x04b6, 0x61]);
    });

    it('sends the committed text once, as WebKit orders the events', () => {
      compose('compositionstart');
      composing('ni');
      // The field still holds the composed text, which a candidate then replaces.
      compose('compositionend', 'ニ');
      change(`${SOFT_KEYBOARD_BUFFER}ニ`, { inputType: 'insertFromComposition' });
      expect(keysyms()).toEqual([0x04c6]);
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);

      vi.runAllTimers();
      expect(keysyms()).toEqual([0x04c6]);
    });

    it('waits through a composition that has no isComposing on its input events', () => {
      compose('compositionstart');
      change(`${SOFT_KEYBOARD_BUFFER}h`, { inputType: 'insertText' });
      change(`${SOFT_KEYBOARD_BUFFER}hi`, { inputType: 'insertText' });
      compose('compositionend', 'hi');
      expect(sendKey).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(keysyms()).toEqual([0x68, 0x69]);
    });

    it('sends nothing for a cancelled composition', () => {
      compose('compositionstart');
      composing('k');
      change(SOFT_KEYBOARD_BUFFER, { inputType: 'deleteCompositionText', isComposing: true });
      compose('compositionend');
      vi.runAllTimers();
      expect(sendKey).not.toHaveBeenCalled();
    });

    it('sends a word at once when the next composition starts, and leaves the field to it', () => {
      compose('compositionstart');
      composing('hello');
      compose('compositionend', 'hello');
      compose('compositionstart');
      expect(keysyms()).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      composing('hello w');
      vi.runAllTimers();
      expect(input.value).toBe(`${SOFT_KEYBOARD_BUFFER}hello w`);
      compose('compositionend', ' w');
      vi.runAllTimers();
      expect(keysyms()).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77]);
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
    });

    it('ends a composition whose compositionend never came on the next focus', () => {
      input.focus();
      compose('compositionstart');
      composing('k');
      input.blur();
      input.focus();
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
      type('a');
      expect(keysyms()).toEqual([0x61]);
    });

    it('sends nothing committed after control ends', () => {
      compose('compositionstart');
      composing('a');
      compose('compositionend', 'a');
      controlling = false;
      vi.runAllTimers();
      expect(sendKey).not.toHaveBeenCalled();
    });
  });

  it('sends nothing while watching, and still resets', () => {
    controlling = false;
    type('a');
    change(input.value.slice(0, -1), { inputType: 'deleteContentBackward' });
    change(`${input.value}\n`, { inputType: 'insertLineBreak' });
    expect(sendKey).not.toHaveBeenCalled();
    expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);

    // Control again: what came before is not sent late.
    controlling = true;
    type('b');
    expect(keysyms()).toEqual([0x62]);
  });

  it('does not type out a paste that reached the field', () => {
    change(`${input.value}pasted`, { inputType: 'insertFromPaste' });
    change(`${input.value}dropped`, { inputType: 'insertFromDrop' });
    expect(sendKey).not.toHaveBeenCalled();
    expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
  });

  it('pastes through the clipboard bridge, which keeps the paste out of the field', () => {
    const target = document.createElement('div');
    document.body.append(target);
    target.append(input);
    const clipboardPasteFrom = vi.fn();
    const detachClipboard = attachComputerClipboard(
      target,
      {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        clipboardPasteFrom,
        sendKey,
      },
      { isControlling: () => true, apple: false, readOnShortcut: false, clipboard: undefined }
    );
    try {
      input.focus();
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text/plain' ? 'hello' : '') },
      });
      input.dispatchEvent(event);

      // Prevented, so the browser never puts the text in the field to be typed out.
      expect(event.defaultPrevented).toBe(true);
      expect(clipboardPasteFrom).toHaveBeenCalledWith('hello');
      expect(sendKey.mock.calls).toEqual([
        [CONTROL_L, 'ControlLeft', true],
        [V, 'KeyV', true],
        [V, 'KeyV', false],
        [CONTROL_L, 'ControlLeft', false],
      ]);
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
    } finally {
      detachClipboard();
      target.remove();
    }
  });

  it('stops on detach', () => {
    detach();
    type('a');
    expect(sendKey).not.toHaveBeenCalled();
    detach = () => undefined;
  });
});
