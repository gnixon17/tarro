import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestGuard } from '../api/_guard';

function run(
  req: { method: string; headers: Record<string, string | undefined> },
  env: Record<string, string | undefined> = {},
): { status: number | null; passed: boolean } {
  const previous = process.env.TARRO_ALLOWED_HOSTS;
  if ('TARRO_ALLOWED_HOSTS' in env) {
    if (env.TARRO_ALLOWED_HOSTS === undefined) delete process.env.TARRO_ALLOWED_HOSTS;
    else process.env.TARRO_ALLOWED_HOSTS = env.TARRO_ALLOWED_HOSTS;
  }

  let status: number | null = null;
  let passed = false;
  const res = {
    status(code: number) { status = code; return this; },
    json() { return this; },
  };
  try {
    requestGuard(req as never, res as never, () => { passed = true; });
  } finally {
    if (previous === undefined) delete process.env.TARRO_ALLOWED_HOSTS;
    else process.env.TARRO_ALLOWED_HOSTS = previous;
  }
  return { status, passed };
}

const local = { host: 'localhost:3000' };

test('same-origin writes are allowed', () => {
  const r = run({ method: 'POST', headers: { ...local, origin: 'http://localhost:3000' } });
  assert.equal(r.passed, true);
});

test('a cross-site form POST is rejected', () => {
  // The attack this exists for: an ordinary HTML form POST is a simple request,
  // so it is never preflighted and reaches the handler with no body.
  const r = run({ method: 'POST', headers: { ...local, origin: 'https://evil.example' } });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test('a cross-site request is rejected even when the browser omits Origin but labels it', () => {
  const r = run({ method: 'POST', headers: { ...local, 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test('non-browser clients with no Origin still work', () => {
  assert.equal(run({ method: 'POST', headers: { ...local } }).passed, true, 'curl');
  assert.equal(run({ method: 'DELETE', headers: { ...local } }).passed, true);
});

test('reads are not blocked by the Origin rule', () => {
  assert.equal(run({ method: 'GET', headers: { ...local, origin: 'https://evil.example' } }).passed, true);
});

test('a rebound hostname pointing at loopback is rejected', () => {
  // DNS rebinding: attacker.example resolves to 127.0.0.1, so the page is
  // same-origin with itself and the Origin check alone would pass.
  const r = run({ method: 'POST', headers: { host: 'attacker.example:3000', origin: 'http://attacker.example:3000' } });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test('loopback spellings are all accepted', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'localhost']) {
    assert.equal(run({ method: 'GET', headers: { host } }).passed, true, host);
  }
});

test('the host allowlist is configurable and can be disabled', () => {
  assert.equal(
    run({ method: 'GET', headers: { host: 'tarro.internal:3000' } }, { TARRO_ALLOWED_HOSTS: 'tarro.internal' }).passed,
    true,
  );
  assert.equal(
    run({ method: 'GET', headers: { host: 'anything.example' } }, { TARRO_ALLOWED_HOSTS: '*' }).passed,
    true,
  );
  // Disabling the host check must not disable the Origin check.
  const r = run(
    { method: 'POST', headers: { host: 'anything.example', origin: 'https://evil.example' } },
    { TARRO_ALLOWED_HOSTS: '*' },
  );
  assert.equal(r.passed, false);
});

test('a malformed Origin is rejected rather than parsed loosely', () => {
  const r = run({ method: 'POST', headers: { ...local, origin: 'not a url' } });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test('a missing Host header is rejected', () => {
  assert.equal(run({ method: 'GET', headers: {} }).passed, false);
});
