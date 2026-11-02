import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyFiles } from '../../../vite.config';
import {
  getServiceWorkerNavigationFallbackExcludePaths,
  isServiceWorkerEnabled,
} from './runtimeConfig';

const repoRoot = path.resolve(__dirname, '../../..');

describe('isServiceWorkerEnabled', () => {
  it('defaults to false when not configured', () => {
    const originalValue = (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown })
      .__ENABLE_SERVICE_WORKER__;

    try {
      delete (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__;
      expect(isServiceWorkerEnabled()).toBe(false);
    } finally {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ =
        originalValue;
    }
  });

  it('accepts boolean or string values', () => {
    const originalValue = (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown })
      .__ENABLE_SERVICE_WORKER__;

    try {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = true;
      expect(isServiceWorkerEnabled()).toBe(true);

      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = 'true';
      expect(isServiceWorkerEnabled()).toBe(true);

      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = 'false';
      expect(isServiceWorkerEnabled()).toBe(false);
    } finally {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ =
        originalValue;
    }
  });
});

describe('getServiceWorkerNavigationFallbackExcludePaths', () => {
  it('returns normalized deployment-provided path prefixes', () => {
    const runtime = globalThis as {
      __SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__?: unknown;
    };
    const originalValue = runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__;

    try {
      runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ = [
        '/other-app/',
        '/other-app',
        'relative',
      ];
      expect(getServiceWorkerNavigationFallbackExcludePaths()).toEqual(['/other-app']);
    } finally {
      runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ = originalValue;
    }
  });
});

describe('MindRoom runtime client config defaults', () => {
  it('keeps MindRoom defaults in a fork-owned config copied to the runtime config path', () => {
    const mindroomConfigPath = path.join(repoRoot, 'config.mindroom.json');
    expect(fs.existsSync(mindroomConfigPath)).toBe(true);

    const mindroomConfig = JSON.parse(fs.readFileSync(mindroomConfigPath, 'utf8'));

    const defaultHomeserverIndex = mindroomConfig.defaultHomeserver ?? 0;
    expect(mindroomConfig.homeserverList?.[defaultHomeserverIndex]).toBe('mindroom.chat');
    expect(mindroomConfig.allowCustomHomeservers).toBe(true);
    expect(mindroomConfig.sidebar?.showMindRoom).toBe(true);
    expect(mindroomConfig.auth).toMatchObject({
      allowRegistration: true,
      requireAppleProvider: true,
    });
    expect(mindroomConfig.welcome?.title).toBe('Welcome to MindRoom Chat');
    expect(mindroomConfig.welcome?.sourceUrl).toBe('https://github.com/mindroom-ai/mindroom-chat');
    expect(mindroomConfig.splash?.loadingMessages).toContain('Loading MindRoom Chat');
    expect(mindroomConfig.mindroom?.thinkingPlaceholderMessages).toContain('Thinking');
    expect(mindroomConfig.messageRendering?.additionalAllowedUriSchemes).toEqual([
      'obsidian',
      'readdlespark',
    ]);
    expect(mindroomConfig.push?.ios?.appId).toBe('chat.mindroom.app');
    expect(mindroomConfig.push?.ios?.format).toBe('full');

    expect(copyFiles.targets).toContainEqual(
      expect.objectContaining({
        src: 'config.mindroom.json',
        dest: '',
        rename: 'config.json',
      })
    );
  });
});
