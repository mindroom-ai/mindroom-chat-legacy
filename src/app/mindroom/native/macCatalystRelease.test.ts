import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];
afterEach(() =>
  fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);

// Only the external macOS tools are replaced; the real build script runs in an isolated checkout.
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'mindroom-macos-test-'));
  fixtures.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(resolve('scripts/build-macos-app.sh'), join(root, 'scripts/build-macos-app.sh'));
  writeFileSync(join(root, 'profile.provisionprofile'), 'fixture profile');
  const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const record = { command, args, hasNotarySecrets: Boolean(process.env.APPLE_ID || process.env.APPLE_APP_SPECIFIC_PASSWORD) };
if (command === 'hdiutil') {
  const stage = args[args.indexOf('-srcfolder') + 1];
  record.appExists = fs.existsSync(path.join(stage, 'MindRoom Chat.app', 'Contents', 'Info.plist'));
  record.applications = fs.readlinkSync(path.join(stage, 'Applications'));
}
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(record) + '\\n');
if (process.env.TEST_FAIL === command + ':' + args[0]) process.exit(9);
if (command === 'security') console.log('fixture decoded profile');
if (command === 'plutil') console.log('11111111-2222-3333-4444-555555555555');
if (command === 'xcodebuild' && args.includes('-exportArchive')) {
  const app = path.join(args[args.indexOf('-exportPath') + 1], 'MindRoom.chat.app', 'Contents');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'Info.plist'), 'fixture app');
}
if (command === 'ditto' && args.length === 2) fs.cpSync(args[0], args[1], { recursive: true });
if (command === 'hdiutil') fs.writeFileSync(args[args.length - 1], 'fixture dmg');
`;
  [
    'npm',
    'npx',
    'xcodebuild',
    'security',
    'plutil',
    'ditto',
    'xcrun',
    'hdiutil',
    'codesign',
  ].forEach((command) => writeFileSync(join(root, 'bin', command), stub, { mode: 0o755 }));
  const env = {
    ...process.env,
    HOME: join(root, 'home'),
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    TEST_LOG: join(root, 'commands.jsonl'),
    CODESIGN_IDENTITY: 'Developer ID Application: Fixture (DNA6966LGZ)',
    APPLE_ID: 'fixture@example.invalid',
    APPLE_APP_SPECIFIC_PASSWORD: 'fixture-password',
    APPLE_TEAM_ID: 'DNA6966LGZ',
    MACOS_PROVISIONING_PROFILE_PATH: join(root, 'profile.provisionprofile'),
    MARKETING_VERSION: '4.12.6',
    CURRENT_PROJECT_VERSION: '523',
  };
  return {
    root,
    run: (args: string[], overrides: Record<string, string> = {}) => {
      const result = spawnSync(
        process.platform === 'darwin' ? '/bin/bash' : 'bash',
        [join(root, 'scripts/build-macos-app.sh'), ...args],
        {
          env: { ...env, ...overrides },
          encoding: 'utf8',
        }
      );
      let commands: {
        command: string;
        args: string[];
        appExists?: boolean;
        applications?: string;
        hasNotarySecrets?: boolean;
      }[] = [];
      try {
        commands = readFileSync(env.TEST_LOG, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
      } catch {
        // A rejected invocation must not start any external build commands.
      }
      return { ...result, commands };
    },
  };
};

describe('Mac release build script', () => {
  it('keeps unsigned archives unsigned and forwards both release version fields', () => {
    const { run } = fixture();
    const result = run([]);
    expect(result.status, result.stderr).toBe(0);
    const archive = result.commands.find(({ command }) => command === 'xcodebuild');
    expect(archive?.args).toEqual(
      expect.arrayContaining([
        'archive',
        'CODE_SIGNING_ALLOWED=NO',
        'MARKETING_VERSION=4.12.6',
        'CURRENT_PROJECT_VERSION=523',
      ])
    );
    expect(
      result.commands.some(({ command }) => command === 'security' || command === 'xcrun')
    ).toBe(false);
  });

  it('archives unsigned when release version overrides are absent', () => {
    const result = fixture().run([], { MARKETING_VERSION: '', CURRENT_PROJECT_VERSION: '' });
    expect(result.status, result.stderr).toBe(0);
    const archive = result.commands.find(({ command }) => command === 'xcodebuild');
    expect(archive?.args).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(archive?.args.some((arg) => arg.startsWith('MARKETING_VERSION='))).toBe(false);
  });

  it('rejects missing signing credentials before building', () => {
    const result = fixture().run(['--sign'], { APPLE_APP_SPECIFIC_PASSWORD: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(result.commands).toEqual([]);
  });

  it('exports Developer ID, notarizes and staples the app before packing and notarizing the DMG', () => {
    const { root, run } = fixture();
    const result = run(['--sign']);
    expect(result.status, result.stderr).toBe(0);
    const archive = result.commands.find(
      ({ command, args }) => command === 'xcodebuild' && args[0] === 'archive'
    );
    expect(archive?.args).toEqual(
      expect.arrayContaining([
        'CODE_SIGN_STYLE=Manual',
        'CODE_SIGN_IDENTITY=Developer ID Application: Fixture (DNA6966LGZ)',
        'MINDROOM_MACOS_PROVISIONING_PROFILE_SPECIFIER=MindRoom Chat Developer ID',
      ])
    );
    expect(archive?.args).not.toContain('CODE_SIGNING_ALLOWED=NO');
    expect(
      result.commands.filter(({ command }) => ['npm', 'npx', 'xcodebuild'].includes(command))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'xcodebuild', hasNotarySecrets: false }),
      ])
    );
    expect(
      result.commands
        .filter(({ command }) => ['npm', 'npx', 'xcodebuild'].includes(command))
        .every(({ hasNotarySecrets }) => !hasNotarySecrets)
    ).toBe(true);
    const lifecycle = result.commands.filter(({ command }) =>
      ['xcrun', 'hdiutil', 'codesign'].includes(command)
    );
    expect(lifecycle.map(({ command, args }) => [command, ...args.slice(0, 2)])).toEqual([
      ['xcrun', 'notarytool', 'submit'],
      ['xcrun', 'stapler', 'staple'],
      ['hdiutil', 'create', '-volname'],
      ['codesign', '--sign', 'Developer ID Application: Fixture (DNA6966LGZ)'],
      ['xcrun', 'notarytool', 'submit'],
      ['xcrun', 'stapler', 'staple'],
    ]);
    expect(lifecycle[2]).toMatchObject({ appExists: true, applications: '/Applications' });
    expect(lifecycle[0].args[2]).toMatch(/\.zip$/);
    expect(lifecycle[4].args[2]).toMatch(/MindRoom-Chat\.dmg$/);
    expect(readFileSync(join(root, 'build/macos/MindRoom-Chat.dmg'), 'utf8')).toBe('fixture dmg');
  });

  it('does not produce a DMG if app notarization fails', () => {
    const result = fixture().run(['--sign'], { TEST_FAIL: 'xcrun:notarytool' });
    expect(result.status).toBe(9);
    expect(result.commands.some(({ command }) => command === 'hdiutil')).toBe(false);
  });
});
