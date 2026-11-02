const MAX_EXCLUDE_PATHS = 8;
const MAX_EXCLUDE_PATH_LENGTH = 256;
const NORMALIZATION_ORIGIN = 'https://service-worker.invalid';
const RECOVERY_NAVIGATION_TIMEOUT_MS = 5_000;

export const NAVIGATION_FALLBACK_EXCLUDE_PARAM = 'navigation-fallback-exclude';
export const NON_DISRUPTIVE_UPDATE_PARAM = 'non-disruptive-update';
export const AUTHENTICATION_RECOVERY_NAVIGATION_PARAM = 'authentication-recovery-navigation';

// Browser pages the MindRoom runtime serves at its origin root. When Chat
// shares that origin, the app shell must not answer them: Chat itself opens
// the Connections portal (and MCP consent under it) there, MCP clients send
// the browser to the gateway's OAuth authorize endpoint, and agents share
// published report links. No Chat route starts with these segments.
export const RUNTIME_NAVIGATION_PATHS = ['/connections', '/mcp', '/reports'];

export const isAuthenticationRecoveryNavigation = (url: string): boolean => {
  try {
    return new URL(url).searchParams.get(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM) === '1';
  } catch {
    return false;
  }
};

export const normalizeNavigationFallbackExcludePaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const paths = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const path = candidate.trim();
    if (
      path.length === 0 ||
      path.length > MAX_EXCLUDE_PATH_LENGTH ||
      path === '/' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('?') ||
      path.includes('#') ||
      path.includes('\\')
    ) {
      continue;
    }

    const normalizedPath = new URL(path, NORMALIZATION_ORIGIN).pathname.replace(/\/+$/, '');
    if (normalizedPath.length === 0 || normalizedPath.length > MAX_EXCLUDE_PATH_LENGTH) continue;

    paths.add(normalizedPath);
    if (paths.size === MAX_EXCLUDE_PATHS) break;
  }
  return [...paths];
};

export const readNavigationFallbackExcludePaths = (scriptUrl: string): string[] => {
  try {
    const values = new URL(scriptUrl).searchParams.getAll(NAVIGATION_FALLBACK_EXCLUDE_PARAM);
    return normalizeNavigationFallbackExcludePaths(values);
  } catch {
    return [];
  }
};

export const navigationFallbackExcludePathPattern = (path: string): RegExp => {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedPath}(?:/|\\?|$)`);
};

export const fetchNavigationWithShellFallback = async (
  request: Request,
  loadCachedShell: () => Promise<Response | undefined>
): Promise<Response> => {
  if (isAuthenticationRecoveryNavigation(request.url)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RECOVERY_NAVIGATION_TIMEOUT_MS);
    try {
      // Preserve HTTP errors and opaque sign-in redirects. Only transport
      // failure may fall back to an offline shell.
      return await fetch(request, { cache: 'no-store', signal: controller.signal });
    } catch (error) {
      try {
        const cachedShell = await loadCachedShell();
        if (cachedShell?.ok) return cachedShell;
      } catch {
        // Preserve the navigation failure if the precache is unavailable.
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const cachedShell = await loadCachedShell();
    if (cachedShell?.ok) return cachedShell;
  } catch {
    // A missing precache falls through to the network navigation.
  }

  // Navigation requests use manual redirect mode. Returning fetch directly
  // preserves an opaque redirect for the browser to continue.
  return fetch(request, { cache: 'no-store' });
};
