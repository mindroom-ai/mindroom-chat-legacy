import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Browser page translation crashes React renders, so the shell opts out of it.
// index.html is edited often for the theme bootstrap; keep both markers pinned.
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('index.html translation opt-out', () => {
  it('sets translate="no" on the root element', () => {
    expect(indexHtml).toMatch(/<html\b[^>]*\btranslate="no"/);
  });

  it('has the Google notranslate meta tag', () => {
    expect(indexHtml).toMatch(
      /<meta\b(?=[^>]*\bname="google")(?=[^>]*\bcontent="notranslate")[^>]*>/
    );
  });
});

// Chromium fetches the web app manifest without cookies unless crossorigin="use-credentials" is set.
// Behind a reverse proxy that authenticates by cookie, the manifest request would get the sign-in redirect.
describe('index.html web app manifest', () => {
  it('fetches the manifest with credentials', () => {
    expect(indexHtml).toMatch(
      /<link\b(?=[^>]*\brel="manifest")(?=[^>]*\bcrossorigin="use-credentials")[^>]*>/
    );
  });
});
