import { createClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMindroomSidecarBlob } from './sidecarDownload';

const mx = createClient({
  baseUrl: 'https://matrix.example.org',
  accessToken: 'test-token',
  userId: '@alice:matrix.example.org',
});
afterEach(() => vi.unstubAllGlobals());
describe('sidecar download boundary', () => {
  it('rejects Matrix HTTP error JSON instead of accepting it as complete arguments', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ errcode: 'M_FORBIDDEN' }), { status: 403 })
        )
    );
    await expect(
      downloadMindroomSidecarBlob(mx, { mxcUri: 'mxc://example.org/args' })
    ).rejects.toThrow('403');
  });
});
