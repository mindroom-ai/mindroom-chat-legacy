import { spawnSync } from 'node:child_process';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { MindroomThinkingPlaceholder } from './MindroomThinkingPlaceholder';
import thinkingMark from './thinking-mark.svg?raw';
import {
  DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES,
  resolveMindroomThinkingPlaceholderMessages,
} from './thinkingPlaceholder';

vi.mock('./MindroomThinkingPlaceholder.css', () => ({
  Aura: 'Aura',
  Core: 'Core',
  Indicator: 'Indicator',
  Mark: 'Mark',
  Placeholder: 'Placeholder',
  Rotor: 'Rotor',
  Text: 'Text',
  TextBase: 'TextBase',
  TextSweep: 'TextSweep',
  TextCounter: 'TextCounter',
  TextHighlight: 'TextHighlight',
}));

const renderPlaceholder = (messages?: string[], startedAt?: number) =>
  create(
    React.createElement(
      ClientConfigProvider,
      {
        value: {
          mindroom: {
            thinkingPlaceholderMessages: messages,
          },
        },
      },
      React.createElement(MindroomThinkingPlaceholder, { startedAt })
    )
  );

/** The label in the base text and in the shimmer's highlight copy. */
const labelTexts = (renderer: ReturnType<typeof renderPlaceholder> | undefined) =>
  ['TextBase', 'TextHighlight'].map((className) =>
    renderer?.root.findByProps({ className }).children.join('')
  );

describe('resolveMindroomThinkingPlaceholderMessages', () => {
  it('uses non-empty configured messages', () => {
    expect(
      resolveMindroomThinkingPlaceholderMessages([' Configured ', '', 'Also configured'])
    ).toEqual(['Configured', 'Also configured']);
  });

  it('falls back to built-in messages when config has no usable messages', () => {
    expect(resolveMindroomThinkingPlaceholderMessages(undefined)).toBe(
      DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES
    );
    expect(resolveMindroomThinkingPlaceholderMessages(['', '   ', 42])).toBe(
      DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES
    );
  });
});

describe('MindroomThinkingPlaceholder', () => {
  it('keeps the artwork in decorative image layers outside the host document', () => {
    const renderer = renderPlaceholder(['Working']);

    const status = renderer.root.findByProps({ role: 'status' });
    const indicator = status.findByProps({ className: 'Indicator' });

    expect(status.props['aria-label']).toBe('AI is responding');
    expect(indicator.props['aria-hidden']).toBe('true');
    const artwork = indicator.findAllByType('img');
    expect(artwork).toHaveLength(2);
    artwork.forEach((image) => {
      expect(image.props.alt).toBe('');
      expect(image.props.draggable).toBe(false);
    });
    expect(status.findAllByType('svg')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Working');

    renderer.unmount();
  });

  it('renders configured placeholder messages and rotates through them', () => {
    vi.useFakeTimers();

    let renderer: ReturnType<typeof renderPlaceholder> | undefined;
    act(() => {
      renderer = renderPlaceholder(['Configured one', 'Configured two']);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('Configured one');
    expect(JSON.stringify(renderer?.toJSON())).not.toContain('Making progress');

    act(() => {
      vi.advanceTimersByTime(3599);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('Configured one');

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('Configured two');

    renderer?.unmount();
    vi.useRealTimers();
  });

  it('counts the seconds since the reply arrived in tenths', () => {
    vi.useFakeTimers({ now: 10_000 });

    let renderer: ReturnType<typeof renderPlaceholder> | undefined;
    act(() => {
      renderer = renderPlaceholder(['Working'], 10_000 - 1_290);
    });

    expect(renderer?.root.findByProps({ className: 'Text' }).props['aria-hidden']).toBe('true');
    expect(labelTexts(renderer)).toEqual(['Working (1.2s)', 'Working (1.2s)']);

    act(() => {
      vi.advanceTimersByTime(9);
    });
    expect(labelTexts(renderer)).toEqual(['Working (1.2s)', 'Working (1.2s)']);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(labelTexts(renderer)).toEqual(['Working (1.3s)', 'Working (1.3s)']);

    act(() => {
      vi.advanceTimersByTime(8_700);
    });
    expect(labelTexts(renderer)).toEqual(['Working (10.0s)', 'Working (10.0s)']);

    act(() => {
      renderer?.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('starts at zero when the reply timestamp is ahead of the local clock', () => {
    vi.useFakeTimers({ now: 10_000 });

    let renderer: ReturnType<typeof renderPlaceholder> | undefined;
    act(() => {
      renderer = renderPlaceholder(['Working'], 12_000);
    });
    expect(labelTexts(renderer)).toEqual(['Working (0.0s)', 'Working (0.0s)']);

    act(() => {
      vi.advanceTimersByTime(2_099);
    });
    expect(labelTexts(renderer)).toEqual(['Working (0.0s)', 'Working (0.0s)']);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(labelTexts(renderer)).toEqual(['Working (0.1s)', 'Working (0.1s)']);

    act(() => {
      renderer?.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('waits for a timestamp far ahead in short timers', () => {
    vi.useFakeTimers({ now: 10_000 });

    let renderer: ReturnType<typeof renderPlaceholder> | undefined;
    act(() => {
      // Past the 24.8-day timer limit, where a longer delay fires at once.
      renderer = renderPlaceholder(['Working'], 10_000 + 30 * 24 * 60 * 60 * 1000);
    });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
    setTimeoutSpy.mockRestore();
    // About one wait per tenth, each under two tenths, not a delay past the limit.
    expect(delays.length).toBeGreaterThanOrEqual(5);
    delays.forEach((delay) => {
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThan(200);
    });
    expect(labelTexts(renderer)).toEqual(['Working (0.0s)', 'Working (0.0s)']);

    act(() => {
      renderer?.unmount();
    });
    vi.useRealTimers();
  });

  it('shows no counter without a reply timestamp', () => {
    const renderer = renderPlaceholder(['Working']);

    expect(labelTexts(renderer)).toEqual(['Working', 'Working']);

    renderer.unmount();
  });

  it('renders the built-in messages when config is empty', () => {
    const renderer = renderPlaceholder([]);

    expect(JSON.stringify(renderer.toJSON())).toContain(
      DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES[0]
    );

    renderer.unmount();
  });
});

describe('thinking mark artwork', () => {
  it('opens the frame behind the turning core', () => {
    // Copy MindRoom's assets/logo/logo-mark-movable-cube.svg; its logo-mark.svg keeps a solid frame that shows a navy slab behind the flip.
    const frame = thinkingMark.match(/<path id="structural-frame"[^>]*>/)?.[0] ?? '';
    expect(frame).toContain('fill-rule="evenodd"');
    expect(frame.match(/ Z/g)).toHaveLength(2);
  });

  it('keeps the generated image layers in sync with the canonical artwork', () => {
    const result = spawnSync(
      'python3',
      ['-I', 'scripts/generate-thinking-mark-images.py', '--check'],
      { encoding: 'utf8' }
    );
    expect(result.status, result.stderr || String(result.error)).toBe(0);
  });
});
