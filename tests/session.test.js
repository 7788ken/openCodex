import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionId, getSessionPaths } from '../src/lib/session.js';

test('createSessionId prefixes command name', () => {
  const id = createSessionId('doctor');
  assert.match(id, /^doctor-/);
});

test('getSessionPaths returns session file layout', () => {
  const paths = getSessionPaths('demo-id');
  assert.equal(paths.sessionFile.endsWith('/demo-id/session.json'), true);
  assert.equal(paths.lastMessageFile.endsWith('/demo-id/last-message.txt'), true);
});
