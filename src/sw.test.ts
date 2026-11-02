import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('service worker app shell caching', () => {
  it('precaches the SPA shell for installed PWA cold starts', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');
    const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

    expect(swSource).toContain("from 'workbox-precaching'");
    expect(swSource).toContain('const precacheManifest = self.__WB_MANIFEST');
    expect(swSource).toContain('new PrecacheController()');
    expect(swSource).toContain('precacheController.addToCacheList(precacheManifest)');
    expect(swSource).toContain('new PrecacheRoute(precacheController)');
    expect(swSource).toContain("precacheController.matchPrecache('index.html')");
    expect(swSource).toContain('new NavigationRoute');
    expect(swSource).toContain('denylist: navigationFallbackDenylist');
    // Navigation is registered only when index.html is precached. Its lookup
    // must stay cache-only so a miss falls through to the original navigation.
    expect(swSource).toContain("=== 'index.html'");
    expect(swSource).toContain('if (precachesAppShell)');
    expect(viteConfigSource).toContain("injectionPoint: 'self.__WB_MANIFEST'");
    expect(viteConfigSource).toContain('maximumFileSizeToCacheInBytes');
    expect(viteConfigSource).toContain("'public/element-call/**'");
    expect(viteConfigSource).toContain("'runtime-config.js'");
    expect(viteConfigSource).toContain("'version.json'");
  });

  it('registers navigation before the precache route and never navigates active clients', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    const navigationRoute = swSource.indexOf('new NavigationRoute');
    const precacheRoute = swSource.indexOf('new PrecacheRoute(precacheController)');

    expect(navigationRoute).toBeGreaterThan(-1);
    expect(precacheRoute).toBeGreaterThan(navigationRoute);
    expect(swSource).toContain('void self.registration.unregister().catch');
    expect(swSource).toContain('if (!self.registration.active) await self.skipWaiting()');
    expect(swSource).not.toContain('UPDATE_MARKER_CACHE');
    expect(swSource).not.toContain('client.navigate(client.url)');
  });

  it('does not use the SPA fallback for same-origin backend routes', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    expect(swSource).toContain('/^\\/api(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_matrix(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_synapse(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?\\.well-known(?:\\/|$)/');
    expect(swSource).toContain('readNavigationFallbackExcludePaths(self.location.href)');
    expect(swSource).toContain('navigationFallbackExcludePathPattern');
    expect(swSource).toContain(
      '...RUNTIME_NAVIGATION_PATHS.map(navigationFallbackExcludePathPattern)'
    );
  });

  it('does not use the SPA fallback for path-based Matrix homeserver routes', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_matrix(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?_synapse(?:\\/|$)/');
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?\\.well-known(?:\\/|$)/');
  });

  it('does not use the SPA fallback for static documents like the Element Call widget', () => {
    const swSource = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');

    // The call widget iframe navigates to /public/element-call/index.html
    // (with widget query params, so the precache route never matches it).
    // Answering that navigation with the app shell loads Cinny inside its
    // own call iframe and leaves joins stuck on "Joining" forever.
    // Workbox matches denylist entries against pathname + search, so "?"
    // must be a boundary as well ("#" fragments never reach the SW).
    expect(swSource).toContain('/^\\/(?:[^/]+\\/)?public(?:\\/|\\?|$)/');

    const denylistEntry = /^\/(?:[^/]+\/)?public(?:\/|\?|$)/;
    expect(denylistEntry.test('/public/element-call/index.html')).toBe(true);
    expect(denylistEntry.test('/mindroom/public/element-call/index.html')).toBe(true);
    expect(denylistEntry.test('/public?foo=bar')).toBe(true);
    expect(denylistEntry.test('/publicfoo')).toBe(false);
    expect(denylistEntry.test('/home/some-room')).toBe(false);
    expect(denylistEntry.test('/')).toBe(false);
  });
});
