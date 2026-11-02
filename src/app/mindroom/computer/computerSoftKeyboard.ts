// noVNC's Unicode-to-keysym table, the one its keyboard uses. The package exports only RFB,
// so it is imported by path, and it has no types.
/* eslint-disable import/no-relative-packages */
// @ts-expect-error -- a JavaScript module without a declaration; typed below.
import keysymTable from '../../../../node_modules/@novnc/novnc/core/input/keysymdef.js';
/* eslint-enable import/no-relative-packages */

const keysyms: { lookup(codePoint: number): number } = keysymTable;

// A phone shows its software keyboard only for a focused editable element, and noVNC's keyboard
// listens on its canvas. So the screen keeps a hidden textarea, and this turns what is typed
// into it into key presses, as noVNC's own app does on touch devices: the textarea holds a
// few placeholder characters with the caret after them, and every change is compared with the
// text before it. Each character taken away is a BackSpace, and each one added is its keysym.
// iOS fires no input event for Backspace in an empty field, hence the placeholders.

export type SoftKeyboardRfb = {
  sendKey(keysym: number, code: string | null, down?: boolean): void;
};

export type ComputerSoftKeyboardOptions = {
  isControlling: () => boolean;
};

// X11 keysyms XK_BackSpace and XK_Return.
const BACKSPACE_KEYSYM = 0xff08;
const RETURN_KEYSYM = 0xff0d;

// Short, about a word: a delete of the word before the caret (iOS turns a held Backspace into
// those) sends one BackSpace per placeholder.
export const SOFT_KEYBOARD_BUFFER = '_'.repeat(8);

const keysymFor = (character: string): number =>
  character === '\n' ? RETURN_KEYSYM : keysyms.lookup(character.codePointAt(0) ?? 0);

/** What changed from `before` to `after`, by code point, around their common start and end. */
const difference = (before: string, after: string) => {
  const from = Array.from(before);
  const to = Array.from(after);
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start += 1;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  ) {
    end += 1;
  }
  return { removed: from.length - start - end, added: to.slice(start, to.length - end) };
};

export function attachComputerSoftKeyboard(
  input: HTMLTextAreaElement,
  rfb: SoftKeyboardRfb,
  { isControlling }: ComputerSoftKeyboardOptions
): () => void {
  let last = '';
  let composing = false;
  // From a compositionend until its committed text is sent.
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  const reset = () => {
    input.value = SOFT_KEYBOARD_BUFFER;
    last = SOFT_KEYBOARD_BUFFER;
    input.setSelectionRange(SOFT_KEYBOARD_BUFFER.length, SOFT_KEYBOARD_BUFFER.length);
  };

  const cancelCommit = () => {
    const pending = commitTimer !== undefined;
    clearTimeout(commitTimer);
    commitTimer = undefined;
    return pending;
  };

  // Types what changed since the last value, as presses and releases. TigerVNC presses Shift
  // itself for an uppercase keysym.
  const typeChange = () => {
    const { removed, added } = difference(last, input.value);
    last = input.value;
    if (!isControlling()) return;
    for (let i = 0; i < removed; i += 1) rfb.sendKey(BACKSPACE_KEYSYM, null);
    added.forEach((character) => rfb.sendKey(keysymFor(character), null));
  };

  const commit = () => {
    cancelCommit();
    typeChange();
    reset();
  };

  const handleInput = (event: Event) => {
    const { inputType, isComposing } = event as InputEvent;
    // An IME's or dictation's text is sent once, when it is committed.
    if (composing || isComposing) return;
    cancelCommit();
    // In control, the clipboard bridge takes a paste, which then never reaches the field. One
    // that got here anyway is not typed out.
    if (!/^insertFrom(Paste|Drop)/.test(inputType ?? '')) typeChange();
    reset();
  };

  const handleCompositionStart = () => {
    composing = true;
    // Android keyboards compose word after word: the last word goes now, and the field is
    // left to the new composition.
    if (cancelCommit()) typeChange();
  };

  // WebKit puts the committed text in after compositionend, with an input event of its own;
  // Chromium and Firefox put it in before, and fire none after. Either way the field has it
  // once this task is over.
  const handleCompositionEnd = () => {
    composing = false;
    cancelCommit();
    commitTimer = setTimeout(commit, 0);
  };

  // With the caret at the end, after the placeholders. Focus comes before any composition, so
  // one whose compositionend never came ends here.
  const handleFocus = () => {
    composing = false;
    cancelCommit();
    reset();
  };

  reset();
  input.addEventListener('input', handleInput);
  input.addEventListener('compositionstart', handleCompositionStart);
  input.addEventListener('compositionend', handleCompositionEnd);
  input.addEventListener('focus', handleFocus);

  return () => {
    cancelCommit();
    input.removeEventListener('input', handleInput);
    input.removeEventListener('compositionstart', handleCompositionStart);
    input.removeEventListener('compositionend', handleCompositionEnd);
    input.removeEventListener('focus', handleFocus);
  };
}
