declare module '@novnc/novnc' {
  export type RFBOptions = {
    wsProtocols?: string[];
  };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);

    scaleViewport: boolean;

    viewOnly: boolean;

    focusOnClick: boolean;

    disconnect(): void;

    focus(options?: FocusOptions): void;

    clipboardPasteFrom(text: string): void;

    sendKey(keysym: number, code: string | null, down?: boolean): void;
  }
}
