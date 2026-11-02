import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasm } from '@rollup/plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import inject from '@rollup/plugin-inject';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import buildConfig from './build.config';
import { authenticationRecoveryAssets } from './scripts/authentication-recovery-assets.mjs';
import { iosClientConfig } from './scripts/ios-client-config.mjs';
import { e2eClientConfig } from './scripts/e2e-client-config.mjs';
import { readReleaseVersion, resolveBuildVersion } from './scripts/build-version.mjs';
import { injectElementCallTransparentBackground } from './scripts/element-call-background.mjs';

const getBuildVersion = () => {
  let localCommit;
  try {
    localCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(),
      encoding: 'utf8',
    }).trim();
  } catch {
    // Manual uploads may not include a Git checkout; DEPLOY_ID remains usable.
  }

  return resolveBuildVersion(process.env, localCommit) ?? 'unknown';
};

const buildVersion = getBuildVersion();

// The first browser versions with native top-level await, which noVNC and pdfjs use.
// The app already needs Safari 15.4 for structuredClone and Array.prototype.at.
const browserTarget = ['chrome89', 'edge89', 'firefox89', 'safari15'];
const releaseVersion = readReleaseVersion(process.env, path.resolve());

function appVersionManifest() {
  return {
    name: 'mindroom-app-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: buildVersion })}\n`,
      });
    },
  };
}

export const copyFiles = {
  targets: [
    {
      src: 'public/.well-known/apple-app-site-association',
      dest: '.well-known',
    },
    {
      src: 'node_modules/@element-hq/element-call-embedded/dist/index.html',
      dest: 'public/element-call',
      transform: injectElementCallTransparentBackground,
    },
    {
      src: [
        'node_modules/@element-hq/element-call-embedded/dist/*',
        '!node_modules/@element-hq/element-call-embedded/dist/index.html',
      ],
      dest: 'public/element-call',
    },
    {
      src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      dest: '',
      rename: 'pdf.worker.min.js',
    },
    {
      src: 'netlify.toml',
      dest: '',
    },
    {
      src: 'config.mindroom.json',
      dest: '',
      rename: 'config.json',
      transform:
        process.env.MINDROOM_BUILD_TARGET === 'ios'
          ? (source) =>
              iosClientConfig(
                source,
                JSON.parse(fs.readFileSync('config.mindroom.ios.json', 'utf8')),
                process.env.MINDROOM_IOS_COMPUTER_API_URL
              )
          : undefined,
    },
    {
      src: 'public/manifest.json',
      dest: '',
    },
    {
      // No notices by default; the Docker image serves an operator's file instead (README).
      src: 'public/notices.json',
      dest: '',
    },
    {
      src: 'public/res/android',
      dest: 'public/',
    },
    {
      // Locale files live in src/app/locales (the single source of truth,
      // bundle-importable); this copy keeps them fetchable at runtime under
      // public/locales/{{lng}}.json for i18next-http-backend.
      src: 'src/app/locales',
      dest: 'public/',
    },
  ],
};

function serverMatrixSdkCryptoWasm(wasmFilePath) {
  return {
    name: 'vite-plugin-serve-matrix-sdk-crypto-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split('?')[0];
        if (requestPath === wasmFilePath) {
          const resolvedPath = path.join(
            path.resolve(),
            '/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm'
          );

          if (fs.existsSync(resolvedPath)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'no-cache');

            const fileStream = fs.createReadStream(resolvedPath);
            fileStream.pipe(res);
          } else {
            res.writeHead(404);
            res.end('File not found');
          }
        } else {
          next();
        }
      });
    },
  };
}

const staleServiceWorkerCleanupScript = `
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ('caches' in self) {
      const cacheNames = await self.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => self.caches.delete(cacheName)));
    }

    await self.registration.unregister();

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`;

function serverStaleServiceWorkerCleanup(serviceWorkerPath) {
  return {
    name: 'vite-plugin-serve-stale-service-worker-cleanup',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split('?')[0];
        if (requestPath === serviceWorkerPath) {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(staleServiceWorkerCleanupScript);
        } else {
          next();
        }
      });
    },
  };
}

const appBasePath =
  buildConfig.base === '/' || buildConfig.base === './' || buildConfig.base === '.'
    ? ''
    : buildConfig.base.replace(/\/+$/g, '');
const matrixCryptoWasmPath =
  appBasePath && appBasePath !== '.'
    ? `${appBasePath}/node_modules/.vite/deps/pkg/matrix_sdk_crypto_wasm_bg.wasm`
    : '/node_modules/.vite/deps/pkg/matrix_sdk_crypto_wasm_bg.wasm';
const defaultAllowedHosts = [
  'chat.lab.mindroom.chat',
  'chat.mindroom.chat',
  'cinny-dev.lab.nijho.lt',
  'localhost',
  '127.0.0.1',
];
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? defaultAllowedHosts.join(','))
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  appType: 'spa',
  publicDir: false,
  base: buildConfig.base,
  server: {
    port: 8080,
    host: true,
    allowedHosts,
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
  plugins: [
    // Registered first so its config.json takes precedence over the static copy.
    e2eClientConfig(process.env.MINDROOM_E2E_PROVISIONING_URL),
    appVersionManifest(),
    authenticationRecoveryAssets(),
    serverStaleServiceWorkerCleanup(`${appBasePath}/sw.js`),
    serverMatrixSdkCryptoWasm(matrixCryptoWasmPath),
    viteStaticCopy(copyFiles),
    vanillaExtractPlugin(),
    wasm(),
    react(),
    VitePWA({
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,wasm,css,html}', 'assets/thinking-mark-*.svg'],
        globIgnores: [
          'public/element-call/**',
          'runtime-config.js',
          'authentication-recovery.js',
          'version.json',
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  define: {
    __MINDROOM_BUILD_VERSION__: JSON.stringify(buildVersion),
    __MINDROOM_RELEASE_VERSION__: JSON.stringify(releaseVersion),
  },
  optimizeDeps: {
    // The dependency scan misses imports from the dev service worker and from
    // vanilla-extract's transformed styles. Discovering them on first use
    // re-optimizes dependencies and reloads every open page.
    include: ['workbox-precaching', 'workbox-routing', '@vanilla-extract/recipes/createRuntimeFn'],
    esbuildOptions: {
      target: browserTarget,
      define: {
        global: 'globalThis',
      },
      plugins: [
        // Enable esbuild polyfill plugins
        NodeGlobalsPolyfillPlugin({
          process: false,
          buffer: true,
        }),
      ],
    },
  },
  build: {
    target: browserTarget,
    outDir: 'dist',
    sourcemap: true,
    copyPublicDir: false,
    rollupOptions: {
      plugins: [inject({ Buffer: ['buffer', 'Buffer'] })],
    },
  },
});
