import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/auto-mindroom-release.yml', 'utf8'));
const steps = workflow.jobs.macos_app.steps as {
  name: string;
  run?: string;
  if?: string;
  with?: { ref: string };
}[];
const sourceSha = 'a'.repeat(40);
const fixtures: string[] = [];
afterEach(() =>
  fixtures.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
);

// Run the actual workflow shell with GitHub responses replaced at the network boundary.
const runStep = (name: string, overrides: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'mindroom-macos-workflow-'));
  fixtures.push(root);
  mkdirSync(join(root, 'bin'));
  writeFileSync(
    join(root, 'bin/gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n');
if (args.includes('targetCommitish')) console.log(process.env.TEST_RELEASE_SHA);
else if (args.includes('assets')) console.log(process.env.TEST_PUBLISHED ? 1 : 0);
else if (args[0] === 'api' && args[1].includes('/commits/')) console.log(process.env.TEST_TAG_SHA);
else if (args.includes('tagName')) console.log(process.env.TEST_LATEST_TAG);
`,
    { mode: 0o755 }
  );
  const output = join(root, 'output');
  writeFileSync(output, '');
  const result = spawnSync(
    process.platform === 'darwin' ? '/bin/bash' : 'bash',
    ['-e', '-c', steps.find((step) => step.name === name)!.run!],
    {
      encoding: 'utf8',
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'mindroom-ai/mindroom-chat',
        GITHUB_OUTPUT: output,
        RELEASE_TAG: 'v4.12.6-mindroom.523',
        TEST_RELEASE_SHA: sourceSha,
        TEST_TAG_SHA: sourceSha,
        TEST_LATEST_TAG: 'v4.12.6-mindroom.523',
        TEST_LOG: join(root, 'commands'),
        ...overrides,
      },
    }
  );
  return {
    ...result,
    output: readFileSync(output, 'utf8'),
    commands: readFileSync(join(root, 'commands'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]),
  };
};

describe('Mac release recovery', () => {
  it('pins checkout to the release commit after checking the tag still matches', () => {
    const result = runStep('Resolve existing release and version');
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain(`source_sha=${sourceSha}`);
    expect(steps.find((step) => step.name === 'Checkout release source')?.with?.ref).toBe(
      // Literal GitHub expression, evaluated by Actions rather than JavaScript.
      // eslint-disable-next-line no-template-curly-in-string
      '${{ steps.version.outputs.source_sha }}'
    );
  });

  it('rejects a moved tag before signing', () => {
    const result = runStep('Resolve existing release and version', {
      TEST_TAG_SHA: 'b'.repeat(40),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match');
    expect(result.output).not.toContain('source_sha=');
  });

  it('requires an immutable release target', () => {
    const result = runStep('Resolve existing release and version', { TEST_RELEASE_SHA: 'dev' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('immutable commit SHA');
    expect(result.output).not.toContain('source_sha=');
  });

  it('refuses to rebuild a release that already has its DMG', () => {
    const result = runStep('Resolve existing release and version', { TEST_PUBLISHED: '1' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already has MindRoom-Chat.dmg');
    expect(result.output).not.toContain('source_sha=');
  });

  it('dispatches the tap update for the current release', () => {
    expect(runStep('Check latest release for tap update').output).toContain('is_latest=true');
    const result = runStep('Dispatch tap update');
    expect(result.status, result.stderr).toBe(0);
    expect(
      result.commands.some((args) => args[1] === 'repos/mindroom-ai/homebrew-tap/dispatches')
    ).toBe(true);
  });

  it('does not downgrade the tap when retrying an older release', () => {
    const result = runStep('Check latest release for tap update', {
      TEST_LATEST_TAG: 'v4.12.6-mindroom.524',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain('is_latest=false');
    ['Mint Homebrew tap token', 'Dispatch tap update'].forEach((name) =>
      expect(steps.find((step) => step.name === name)?.if).toBe(
        // eslint-disable-next-line no-template-curly-in-string
        "${{ steps.tap_release.outputs.is_latest == 'true' }}"
      )
    );
  });
});

describe('Mac release upload', () => {
  it('uploads without --clobber, so a published DMG is never replaced', () => {
    expect(steps.find((step) => step.name === 'Upload DMG to release')?.run).not.toContain(
      '--clobber'
    );
  });
});
