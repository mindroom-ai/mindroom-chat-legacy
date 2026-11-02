import React from 'react';
import { createRoot } from 'react-dom/client';
import { configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '../../src/index.css';
import { lightTheme } from '../../src/colors.css';
import {
  ComputerScreen,
  type RfbClient,
  type RfbFactory,
} from '../../src/app/mindroom/computer/ComputerScreen';
import type { PasteResult } from '../../src/app/mindroom/computer/computerClipboard';

type RfbCall = ['paste', string] | ['key', number, string | null, boolean | undefined];

export type ComputerClipboardFixture = {
  // The bridge's calls into the RFB, in order.
  calls: RfbCall[];
  // The keys noVNC's grabbed keyboard sent itself.
  noVncKeys: string[];
  pastes: PasteResult[];
  sendRemoteClipboard: (text: string) => void;
};

declare global {
  interface Window {
    __rfb: ComputerClipboardFixture;
  }
}

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') === 'control' ? 'control' : 'view';
document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;

const fixture: ComputerClipboardFixture = {
  calls: [],
  noVncKeys: [],
  pastes: [],
  sendRemoteClipboard: () => undefined,
};
window.__rfb = fixture;

// Stands in for noVNC's RFB without a server: the same canvas inside the target, the same
// mouse and keyboard handling on it, and the calls recorded instead of sent.
// It does not emulate noVNC's mouse capture (native setCapture, or the capture proxy noVNC
// uses without it), so the middle-click case passes here for a slightly different reason than
// in the app. In Firefox the press and release both land on the canvas here, while in the app
// native setCapture keeps the release there. In Chromium the app fires no paste at all, as the
// capture proxy cancels the mouseup, so only this page sends one.
class FixtureRfb extends EventTarget implements RfbClient {
  scaleViewport = false;

  focusOnClick = true;

  private readonly canvas = document.createElement('canvas');

  private grabbed = false;

  // noVNC's _keyDownList: only a key it saw go down is sent up.
  private readonly pressed = new Set<string>();

  constructor(target: HTMLElement) {
    super();
    const screen = document.createElement('div');
    Object.assign(screen.style, { display: 'flex', width: '100%', height: '100%' });
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.canvas.tabIndex = -1;
    Object.assign(this.canvas.style, { margin: 'auto', outline: 'none', background: '#4a6378' });
    screen.append(this.canvas);
    target.append(screen);

    this.canvas.addEventListener('mousedown', (event) => {
      if (this.focusOnClick) this.focus({ preventScroll: true });
      event.stopPropagation();
      event.preventDefault();
    });
    this.canvas.addEventListener('keydown', (event) => {
      if (!this.grabbed) return;
      event.stopPropagation();
      event.preventDefault();
      this.pressed.add(event.code);
      fixture.noVncKeys.push(`down ${event.code}`);
    });
    this.canvas.addEventListener('keyup', (event) => {
      if (!this.grabbed) return;
      event.stopPropagation();
      event.preventDefault();
      if (this.pressed.delete(event.code)) fixture.noVncKeys.push(`up ${event.code}`);
    });
    fixture.sendRemoteClipboard = (text) =>
      this.dispatchEvent(new CustomEvent('clipboard', { detail: { text } }));
  }

  get viewOnly() {
    return !this.grabbed;
  }

  set viewOnly(viewOnly: boolean) {
    this.grabbed = !viewOnly;
  }

  focus(options?: FocusOptions) {
    this.canvas.focus(options);
  }

  disconnect() {
    this.grabbed = false;
  }

  clipboardPasteFrom(text: string) {
    fixture.calls.push(['paste', text]);
  }

  sendKey(keysym: number, code: string | null, down?: boolean) {
    fixture.calls.push(['key', keysym, code, down]);
  }
}

const createRfb: RfbFactory = (target) => new FixtureRfb(target);

createRoot(document.getElementById('root')!).render(
  <main style={{ display: 'grid', gap: 12, padding: 24, width: 480 }}>
    <button type="button">Before</button>
    <div style={{ height: 240, background: '#111' }}>
      <ComputerScreen
        createRfb={createRfb}
        mode={mode}
        onConnected={() => undefined}
        onDisconnected={() => undefined}
        onPaste={(result) => fixture.pastes.push(result)}
        protocols={['binary', 'mindroom-ticket.fixture']}
        url="wss://computer.invalid/stream"
      />
    </div>
    <button type="button">After</button>
    <textarea aria-label="Local text" />
  </main>
);
