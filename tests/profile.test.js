import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { listCodexProfiles, resolveCodexProfile } from '../src/lib/profile.js';
import { buildRunArgs } from '../src/commands/run.js';

test('resolveCodexProfile returns safe read-only args', () => {
  const profile = resolveCodexProfile('safe', 'run');
  assert.equal(profile.name, 'safe');
  assert.deepEqual(profile.args, ['-a', 'never', '-s', 'read-only', '-c', 'model_reasoning_effort="medium"']);
});

test('resolveCodexProfile returns balanced run args', () => {
  const profile = resolveCodexProfile('balanced', 'run');
  assert.equal(profile.name, 'balanced');
  assert.deepEqual(profile.args, ['-a', 'never', '-s', 'workspace-write', '-c', 'model_reasoning_effort="medium"']);
});

test('resolveCodexProfile returns full-access args', () => {
  const profile = resolveCodexProfile('full-access', 'run');
  assert.equal(profile.name, 'full-access');
  assert.deepEqual(profile.args, ['-a', 'never', '-s', 'danger-full-access', '-c', 'model_reasoning_effort="medium"']);
});

test('listCodexProfiles includes full-access', () => {
  assert.deepEqual(listCodexProfiles(), ['safe', 'balanced', 'full-access']);
});

test('resolveCodexProfile uses project default profile when no flag is passed', async () => {
  const cwd = await createConfigDir({ default_profile: 'safe' });
  const profile = resolveCodexProfile(undefined, 'run', cwd);

  assert.equal(profile.name, 'safe');
  assert.deepEqual(profile.args, ['-a', 'never', '-s', 'read-only', '-c', 'model_reasoning_effort="medium"']);
});

test('resolveCodexProfile prefers command profile over project default', async () => {
  const cwd = await createConfigDir({
    default_profile: 'safe',
    commands: {
      run: { profile: 'balanced' }
    }
  });

  const runProfile = resolveCodexProfile(undefined, 'run', cwd);
  const reviewProfile = resolveCodexProfile(undefined, 'review', cwd);

  assert.equal(runProfile.name, 'balanced');
  assert.equal(reviewProfile.name, 'safe');
});

test('explicit profile flag overrides project config', async () => {
  const cwd = await createConfigDir({ default_profile: 'safe' });
  const profile = resolveCodexProfile('balanced', 'run', cwd);

  assert.equal(profile.name, 'balanced');
});

test('buildRunArgs honors project profile config when profile is omitted', async () => {
  const cwd = await createConfigDir({ default_profile: 'safe' });
  const args = buildRunArgs('inspect repo', { cwd }, {
    schemaPath: '/tmp/schema.json',
    lastMessagePath: '/tmp/last-message.txt'
  });

  assert.deepEqual(args.slice(0, 6), ['-a', 'never', '-s', 'read-only', '-c', 'model_reasoning_effort="medium"']);
});

test('resolveCodexProfile inherits config from parent directories', async () => {
  const cwd = await createConfigDir({ default_profile: 'safe' });
  const nestedCwd = path.join(cwd, 'packages', 'cli');
  await fs.mkdir(nestedCwd, { recursive: true });

  const profile = resolveCodexProfile(undefined, 'run', nestedCwd);

  assert.equal(profile.name, 'safe');
});

async function createConfigDir(config) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-profile-'));
  await writeFile(path.join(cwd, 'opencodex.config.json'), JSON.stringify(config, null, 2));
  return cwd;
}
