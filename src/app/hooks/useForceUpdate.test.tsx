import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { useForceUpdate } from './useForceUpdate';

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('useForceUpdate', () => {
  it('keeps one update function across renders and counts each update', () => {
    const seen: ReturnType<typeof useForceUpdate>[] = [];
    function Probe() {
      seen.push(useForceUpdate());
      return null;
    }
    act(() => {
      renderer = create(<Probe />);
    });
    act(() => seen[0][1]());
    act(() => seen[1][1]());

    expect(seen.map(([version]) => version)).toEqual([0, 1, 2]);
    // Callers list the function in effect and memo dependencies, so a new one each render
    // would subscribe their listeners again on every render.
    expect(new Set(seen.map(([, update]) => update)).size).toBe(1);
  });

  it('has no JavaScript file shadowing a TypeScript module', () => {
    // Vite and Vitest resolve `.js` before `.ts`, while TypeScript type-checks the `.ts` file.
    const stem = (path: string) => path.replace(/\.[jt]sx?$/, '');
    const typescript = new Set(
      Object.keys(import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx'])).map(stem)
    );
    const shadowing = Object.keys(import.meta.glob(['/src/**/*.js', '/src/**/*.jsx'])).filter(
      (path) => typescript.has(stem(path))
    );
    expect(shadowing).toEqual([]);
  });
});
