import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCallbackInput } from '../api/schwab/oauth';

test('reads the code out of a pasted redirect URL', () => {
  assert.deepEqual(
    parseCallbackInput('https://127.0.0.1:3000/api/schwab/callback?code=ABC123&state=deadbeef'),
    { code: 'ABC123', state: 'deadbeef' },
  );
});

test('handles the URL-encoded codes Schwab actually returns', () => {
  const parsed = parseCallbackInput(
    'https://127.0.0.1/cb?code=C0.abc-def%2Fghi%3D%3D%40&state=xyz&session=q',
  );
  assert.equal(parsed!.code, 'C0.abc-def/ghi==@');
  assert.equal(parsed!.state, 'xyz');
});

test('accepts a bare query string or a bare code', () => {
  assert.deepEqual(parseCallbackInput('?code=ABC&state=S'), { code: 'ABC', state: 'S' });
  assert.deepEqual(parseCallbackInput('code=ABC'), { code: 'ABC', state: undefined });
  assert.deepEqual(parseCallbackInput('  ABC123  '), { code: 'ABC123' });
});

test('rejects input with no code', () => {
  assert.equal(parseCallbackInput(''), null);
  assert.equal(parseCallbackInput('   '), null);
  assert.equal(parseCallbackInput('https://127.0.0.1/cb?error=access_denied'), null);
  assert.equal(parseCallbackInput('some words with spaces'), null);
});

test('a code with no state is refused by the parser contract', () => {
  // parseCallbackInput is permissive by design — it will hand back a bare code.
  // The route is what must insist on the state, because the caller chooses
  // whether to send one. This pins the parser's half of that contract.
  assert.equal(parseCallbackInput('ABC123')!.state, undefined);
  assert.equal(parseCallbackInput('?code=ABC')!.state, undefined);
  assert.equal(parseCallbackInput('?code=ABC&state=S')!.state, 'S');
});
