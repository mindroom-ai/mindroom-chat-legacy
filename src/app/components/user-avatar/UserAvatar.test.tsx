// @vitest-environment jsdom
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserAvatar } from './UserAvatar';

describe('UserAvatar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderAvatar = (src: string) =>
    act(() => root.render(<UserAvatar userId="@user:test" src={src} renderFallback={() => 'U'} />));

  it('loads a new src after the previous one failed', () => {
    // Media URLs switch from legacy to authenticated once the service worker takes control.
    renderAvatar('https://hs.test/_matrix/media/v3/thumbnail/hs.test/a');
    act(() => container.querySelector('img')?.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();

    renderAvatar('https://hs.test/_matrix/client/v1/media/thumbnail/hs.test/a');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://hs.test/_matrix/client/v1/media/thumbnail/hs.test/a'
    );

    // A URL that failed before is tried again once it comes back.
    renderAvatar('https://hs.test/_matrix/media/v3/thumbnail/hs.test/a');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://hs.test/_matrix/media/v3/thumbnail/hs.test/a'
    );
  });
});
