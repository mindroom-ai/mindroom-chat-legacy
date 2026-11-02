import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';

export const targetFromEvent = (evt: Event, selector: string): Element | undefined => {
  const targets = evt.composedPath() as Element[];
  return targets.find((target) => target.matches?.(selector));
};

export const editableActiveElement = (): boolean =>
  !!document.activeElement &&
  (document.activeElement.nodeName.toLowerCase() === 'input' ||
    document.activeElement.nodeName.toLowerCase() === 'textarea' ||
    document.activeElement.getAttribute('contenteditable') === 'true' ||
    document.activeElement.getAttribute('role') === 'input' ||
    document.activeElement.getAttribute('role') === 'textarea');

export const isIntersectingScrollView = (
  scrollElement: HTMLElement,
  childElement: HTMLElement
): boolean => {
  const scrollRect = scrollElement.getBoundingClientRect();
  const childRect = childElement.getBoundingClientRect();

  if (childRect.top >= scrollRect.top && childRect.top < scrollRect.bottom) return true;
  if (childRect.bottom > scrollRect.top && childRect.bottom <= scrollRect.bottom) return true;
  if (childRect.top < scrollRect.top && childRect.bottom > scrollRect.bottom) return true;
  return false;
};

export const isInScrollView = (scrollElement: HTMLElement, childElement: HTMLElement): boolean => {
  const scrollRect = scrollElement.getBoundingClientRect();
  const childRect = childElement.getBoundingClientRect();
  return childRect.top >= scrollRect.top && childRect.bottom <= scrollRect.bottom;
};

export const canFitInScrollView = (
  scrollElement: HTMLElement,
  childElement: HTMLElement
): boolean =>
  childElement.getBoundingClientRect().height < scrollElement.getBoundingClientRect().height;

export type FilesOrFile<T extends boolean | undefined = undefined> = T extends true ? File[] : File;

export const getFilesFromFileList = (fileList: FileList): File[] => {
  const files: File[] = [];

  for (let i = 0; i < fileList.length; i += 1) {
    const file: File | undefined = fileList[i];
    if (file instanceof File) files.push(file);
  }

  return files;
};

export const selectFile = <M extends boolean | undefined = undefined>(
  accept: string,
  multiple?: M
): Promise<FilesOrFile<M> | undefined> =>
  new Promise((resolve) => {
    // iOS WKWebView (Capacitor host) silently drops the `change` event
    // when the <input> is not attached to the document. Mount it
    // off-screen so selection events fire reliably on iOS while staying
    // invisible / inert on every other platform.
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    input.style.left = '-9999px';
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;

    let settled = false;

    const cleanup = () => {
      input.removeEventListener('change', changeHandler);
      input.removeEventListener('cancel', cancelHandler);
      input.remove();
    };

    const finalize = (value: FilesOrFile<M> | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const resolveFromInput = () => {
      const fileList = input.files;
      if (!fileList || fileList.length === 0) {
        finalize((multiple ? [] : undefined) as FilesOrFile<M> | undefined);
        return;
      }

      const files = getFilesFromFileList(fileList);
      if (files.length === 0) {
        finalize((multiple ? [] : undefined) as FilesOrFile<M> | undefined);
        return;
      }
      finalize((multiple ? files : files[0]) as FilesOrFile<M>);
    };

    const changeHandler = () => {
      resolveFromInput();
    };

    // Use the native file-input cancel event rather than inferring
    // dismissal from window focus. Focus can return before a valid
    // late change event on iOS WKWebView and drop real selections.
    const cancelHandler = () => {
      finalize(undefined);
    };

    document.body.appendChild(input);
    input.addEventListener('change', changeHandler);
    input.addEventListener('cancel', cancelHandler);
    input.click();
  });

export const getDataTransferFiles = (dataTransfer: DataTransfer): File[] | undefined => {
  const fileList = dataTransfer.files;
  const files: File[] = getFilesFromFileList(fileList);
  if (files.length === 0) return undefined;
  return files;
};

export const renameFile = (file: File, name: string): File =>
  new File([file], name, { type: file.type });

export const getImageUrlBlob = async (url: string) => {
  const res = await fetch(url);
  const blob = await res.blob();
  return blob;
};

export const getImageFileUrl = (fileOrBlob: File | Blob) => URL.createObjectURL(fileOrBlob);

export const getVideoFileUrl = (fileOrBlob: File | Blob) => URL.createObjectURL(fileOrBlob);

export const pauseAllMediaElements = () => {
  if (typeof document === 'undefined') return;

  document.querySelectorAll('audio, video').forEach((element) => {
    const mediaElement = element as Element & { pause?: () => void };
    if (typeof mediaElement.pause === 'function') {
      mediaElement.pause();
    }
  });
};

export const loadImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });

export const loadVideoElement = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;

    video.onloadeddata = () => {
      resolve(video);
      video.pause();
    };
    video.onerror = (e) => {
      reject(e);
    };

    video.src = url;
    video.load();
    video.play();
  });

export const getThumbnailDimensions = (width: number, height: number): [number, number] => {
  const MAX_WIDTH = 400;
  const MAX_HEIGHT = 300;
  let targetWidth = width;
  let targetHeight = height;
  if (targetHeight > MAX_HEIGHT) {
    targetWidth = Math.floor(targetWidth * (MAX_HEIGHT / targetHeight));
    targetHeight = MAX_HEIGHT;
  }
  if (targetWidth > MAX_WIDTH) {
    targetHeight = Math.floor(targetHeight * (MAX_WIDTH / targetWidth));
    targetWidth = MAX_WIDTH;
  }
  return [targetWidth, targetHeight];
};

export const getThumbnail = (
  img: HTMLImageElement | SVGImageElement | HTMLVideoElement,
  width: number,
  height: number,
  thumbnailMimeType?: string
): Promise<Blob | undefined> =>
  new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      resolve(undefined);
      return;
    }
    // Large photos shrunk to emoji size alias badly with the default low-quality smoothing.
    context.imageSmoothingQuality = 'high';
    context.drawImage(img, 0, 0, width, height);

    canvas.toBlob((thumbnail) => {
      resolve(thumbnail ?? undefined);
    }, thumbnailMimeType ?? 'image/jpeg');
  });

export type ScrollInfo = {
  offsetTop: number;
  top: number;
  height: number;
  viewHeight: number;
  scrollable: boolean;
};
export const getScrollInfo = (target: HTMLElement): ScrollInfo => ({
  offsetTop: Math.round(target.offsetTop),
  top: Math.round(target.scrollTop),
  height: Math.round(target.scrollHeight),
  viewHeight: Math.round(target.offsetHeight),
  scrollable: target.scrollHeight > target.offsetHeight,
});

export const scrollToBottom = (scrollEl: HTMLElement, behavior?: 'auto' | 'instant' | 'smooth') => {
  scrollEl.scrollTo({
    top: Math.round(scrollEl.scrollHeight - scrollEl.offsetHeight),
    behavior,
  });
};

const copyWithExecCommand = (text: string): boolean => {
  if (typeof document === 'undefined' || !document.body) return false;

  const copyInput = document.createElement('input');
  copyInput.dataset.clipboardFallback = 'true';
  copyInput.readOnly = true;
  copyInput.setAttribute('aria-hidden', 'true');
  copyInput.style.position = 'fixed';
  copyInput.style.left = '-9999px';
  copyInput.style.opacity = '0';
  copyInput.value = text;
  document.body.append(copyInput);

  copyInput.select();
  copyInput.setSelectionRange(0, text.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    copyInput.remove();
  }
};

/**
 * The browser Clipboard API, for reads and writes that must start inside the user's gesture
 * (the computer screen's copy and paste). Undefined outside a secure context.
 */
export const getBrowserClipboard = (): Clipboard | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.clipboard;

export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Clipboard')) {
    try {
      await Clipboard.write({ string: text });
      return true;
    } catch {
      // Fall through to browser APIs if native clipboard unexpectedly fails.
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Safari/WKWebView can expose Clipboard API while rejecting writes.
    }
  }

  return copyWithExecCommand(text);
};

export const setFavicon = (url: string): void => {
  const favicon = document.querySelector('#favicon');
  if (!favicon) return;
  favicon.setAttribute('href', url);
};

export const tryDecodeURIComponent = (encodedURIComponent: string): string => {
  try {
    return decodeURIComponent(encodedURIComponent);
  } catch {
    return encodedURIComponent;
  }
};

export const syntaxErrorPosition = (error: SyntaxError): number | undefined => {
  const match = error.message.match(/position\s(\d+)\s/);
  if (!match) return undefined;

  const posStr = match[1];
  const position = parseInt(posStr, 10);
  if (Number.isNaN(position)) return undefined;
  return position;
};

export const notificationPermission = (permission: NotificationPermission) => {
  if ('Notification' in window) {
    return window.Notification.permission === permission;
  }
  try {
    // https://stackoverflow.com/questions/29774836/failed-to-construct-notification-illegal-constructor
    // https://issues.chromium.org/issues/40415865
    // eslint-disable-next-line no-new
    new Notification('');
  } catch {
    return false;
  }
  return true;
};

export const getMouseEventCords = (event: MouseEvent) => ({
  x: event.clientX,
  y: event.clientY,
  width: 0,
  height: 0,
});
