import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildAuthenticationRecoveryAssets } from './authentication-recovery-assets.mjs';

// Requires Docker and nginx:alpine. No application build or external login fixture needed.
test('native recovery assets, probe, runtime URL serialization, pairing routes and notices', async (t) => {
  const assets = await buildAuthenticationRecoveryAssets();
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/authentication-recovery-nginx-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(assets))
    writeFileSync(resolve(directory, name), source);
  const probe = '/authentication-recovery-probe?quoted="yes"&slash=\\value';
  // A ConfigMap volume: notices.json -> ..data/notices.json, and the kubelet swaps ..data.
  const notices = resolve(directory, 'notices');
  const publishNotices = (version, body) => {
    mkdirSync(resolve(notices, version), { recursive: true });
    writeFileSync(resolve(notices, version, 'notices.json'), body);
    symlinkSync(version, resolve(notices, '..data_tmp'));
    renameSync(resolve(notices, '..data_tmp'), resolve(notices, '..data'));
  };
  publishNotices('..v1', '[{"id":"v1","text":"First","level":"info"}]');
  symlinkSync('..data/notices.json', resolve(notices, 'notices.json'));
  const container = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '-p',
      '127.0.0.1::80',
      '-v',
      `${resolve('docker-nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`,
      '-v',
      `${resolve(
        directory,
        'authentication-recovery.js'
      )}:/usr/share/nginx/html/authentication-recovery.js:ro`,
      '-v',
      `${resolve(directory, 'runtime-config.js')}:/opt/mindroom/runtime-config.js:ro`,
      '-v',
      `${notices}:/opt/mindroom/notices:ro`,
      '-v',
      `${resolve('index.html')}:/usr/share/nginx/html/index.html:ro`,
      '-v',
      `${resolve('public/.well-known')}:/usr/share/nginx/html/.well-known:ro`,
      '-v',
      `${resolve(
        'docker-entrypoint.d/99-runtime-config.sh'
      )}:/docker-entrypoint.d/99-runtime-config.sh:ro`,
      '-e',
      'APP_BASE_PATH=/chat',
      '-e',
      'APP_ENABLE_SERVICE_WORKER=false',
      '-e',
      `APP_AUTHENTICATION_RECOVERY_PROBE_URL=${probe}`,
      '-e',
      'APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL=/?reconnect=1#thread',
      'nginx:alpine',
    ],
    { encoding: 'utf8' }
  ).trim();
  try {
    const binding = execFileSync('docker', ['port', container, '80/tcp'], {
      encoding: 'utf8',
    }).trim();
    const origin = `http://${binding}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fetch(origin);
        break;
      } catch (error) {
        if (attempt === 30) throw error;
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    const association = await fetch(`${origin}/.well-known/apple-app-site-association`, {
      redirect: 'manual',
    });
    assert.equal(association.status, 200);
    assert.equal(association.headers.get('content-type'), 'application/json');
    assert.deepEqual((await association.json()).applinks.details, [
      {
        appIDs: ['DNA6966LGZ.chat.mindroom.app'],
        components: [{ '/': '/connect', comment: 'Local MindRoom pairing' }, { '/': '/connect/' }],
      },
    ]);
    for (const prefix of ['', '/chat']) {
      const response = await fetch(`${origin}${prefix}/authentication-recovery-probe`);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const bootstrap = await fetch(`${origin}${prefix}/authentication-recovery.js`);
      assert.equal(bootstrap.status, 200);
      assert.match(bootstrap.headers.get('content-type'), /javascript/);
      assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
      assert.match(await bootstrap.text(), /__AUTHENTICATION_RECOVERY__/);
      const runtime = await fetch(`${origin}${prefix}/runtime-config.js`);
      assert.equal(runtime.headers.get('cache-control'), 'no-store');
      const runtimeSource = await runtime.text();
      const scripts = [];
      const window = {};
      runInNewContext(runtimeSource, {
        window,
        URL,
        Promise,
        document: {
          currentScript: { src: `${origin}${prefix}/runtime-config.js` },
          createElement: () => ({}),
          head: { appendChild: (script) => scripts.push(script) },
        },
      });
      assert.equal(window.__APP_BASE_PATH__, '/chat');
      assert.equal(window.__ENABLE_SERVICE_WORKER__, false);
      assert.equal(window.__AUTHENTICATION_RECOVERY_CONFIG__.probeUrl, probe);
      assert.equal(window.__AUTHENTICATION_RECOVERY_CONFIG__.navigationUrl, '/?reconnect=1#thread');
      assert.equal(scripts[0].src, `${origin}${prefix}/authentication-recovery.js`);
      const nested = await fetch(`${origin}${prefix}/authentication-recovery-probe/child`);
      assert.notEqual(nested.status, 204);
      const connect = await fetch(`${origin}${prefix}/connect`);
      assert.equal(connect.status, 200);
      assert.equal(connect.headers.get('content-security-policy'), "frame-ancestors 'none'");
      assert.equal(connect.headers.get('x-frame-options'), 'DENY');
      const connectTrailing = await fetch(`${origin}${prefix}/connect/`);
      assert.equal(connectTrailing.status, 200);
      assert.equal(
        connectTrailing.headers.get('content-security-policy'),
        "frame-ancestors 'none'"
      );
      assert.equal(connectTrailing.headers.get('x-frame-options'), 'DENY');
      const noticeFile = await fetch(`${origin}${prefix}/notices.json`);
      assert.equal(noticeFile.status, 200);
      assert.equal(noticeFile.headers.get('content-type'), 'application/json');
      assert.equal(noticeFile.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await noticeFile.json(), [{ id: 'v1', text: 'First', level: 'info' }]);
    }
    publishNotices('..v2', '[]');
    assert.deepEqual(await (await fetch(`${origin}/notices.json`)).json(), []);
    rmSync(resolve(notices, 'notices.json'));
    assert.equal((await fetch(`${origin}/notices.json`)).status, 404);
    execFileSync('docker', [
      'exec',
      '-e',
      'APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL=',
      container,
      'sh',
      '/docker-entrypoint.d/99-runtime-config.sh',
    ]);
    const defaultRuntime = await (await fetch(`${origin}/runtime-config.js`)).text();
    const defaultWindow = {};
    runInNewContext(defaultRuntime, {
      window: defaultWindow,
      URL,
      Promise,
      document: {
        currentScript: { src: `${origin}/runtime-config.js` },
        createElement: () => ({}),
        head: { appendChild: () => {} },
      },
    });
    assert.equal(defaultWindow.__AUTHENTICATION_RECOVERY_CONFIG__.probeUrl, probe);
    assert.equal(defaultWindow.__AUTHENTICATION_RECOVERY_CONFIG__.navigationUrl, '');
  } finally {
    execFileSync('docker', ['stop', container], { stdio: 'ignore' });
  }
});
