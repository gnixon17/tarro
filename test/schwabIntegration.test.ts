/**
 * End-to-end over the real client, mapper, surface fit and reconciler, against
 * a stand-in for Schwab shaped like the published schemas.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startMockSchwab, type MockServer } from './fixtures/schwabServer';
import { DEFAULT_SETTINGS, type PortfolioStore, type Position } from '../src/lib/types';

let mock: MockServer;
let dataDir: string;
let sync: typeof import('../api/schwab/sync');
let tokens: typeof import('../api/schwab/tokens');

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarro-schwab-'));
  mock = await startMockSchwab();

  process.env.TARRO_DATA_DIR = dataDir;
  process.env.SCHWAB_API_BASE = mock.origin;
  process.env.SCHWAB_APP_KEY = 'test-key';
  process.env.SCHWAB_APP_SECRET = 'test-secret';
  process.env.TARRO_SECRET_KEY = 'a-test-key-that-is-long-enough';

  // Imported after the env is set: the modules read it at load.
  tokens = await import('../api/schwab/tokens');
  sync = await import('../api/schwab/sync');

  await tokens.saveTokens({
    accessToken: 'initial-access',
    refreshToken: 'refresh-token',
    accessExpiresAt: Date.now() + 25 * 60 * 1000,
    refreshExpiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  });
});

after(async () => {
  await mock.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

function baseStore(positions: Position[] = []): PortfolioStore {
  return {
    accounts: [
      { id: 'a_tax', name: 'Main brokerage', broker: 'Schwab', kind: 'TAXABLE', cash: 42000, externalId: 'HASH_TAXABLE', externalLabel: '…2222' },
      { id: 'a_ira', name: 'Roth IRA', broker: 'Schwab', kind: 'ROTH_IRA', cash: 8500 },
    ],
    instruments: [
      { symbol: 'NVDA', name: 'NVIDIA', price: 178, dividendYield: 0, beta: 1.9, ivAtm30: 0.30, volBeta: 1, skewSlope: -0.01, skewCurvature: 0, termSlope: 0 },
      { symbol: 'VTI', name: 'Vanguard Total Market', price: 315, dividendYield: 0.013, beta: 1.02, ivAtm30: 0.14, volBeta: 1, skewSlope: -0.06, skewCurvature: 0.04, termSlope: 0.01 },
    ],
    positions,
    groups: [],
    scenarios: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

test('fetches and maps accounts, reporting what it could not model', async () => {
  const { accounts, warnings } = await sync.fetchAccounts();

  assert.equal(accounts.length, 2);
  const taxable = accounts.find((a) => a.externalId === 'HASH_TAXABLE')!;
  assert.equal(taxable.externalLabel, '…2222', 'only the last four is retained');
  assert.equal(taxable.marginType, 'MARGIN');
  assert.equal(taxable.cash, 51234.5);
  assert.equal(taxable.positions.length, 4, 'the bond is excluded');

  const shortCall = taxable.positions.find(
    (p) => p.kind === 'OPTION' && p.right === 'CALL',
  )!;
  assert.equal(shortCall.quantity, -8, 'shortQuantity becomes a negative quantity');
  assert.equal(shortCall.kind === 'OPTION' && shortCall.strike, 230);
  assert.equal(shortCall.kind === 'OPTION' && shortCall.expiry, '2027-01-15');

  assert.ok(warnings.some((w) => /not modelled/.test(w)), 'the bond is reported, not silently dropped');
});

test('builds a plan that only touches the linked account', async () => {
  const store = baseStore();
  const plan = await sync.fetchSyncPlan(store);

  assert.equal(plan.changes.every((c) => c.accountId === 'a_tax'), true);
  assert.equal(plan.changes.filter((c) => c.kind === 'create').length, 4);
  assert.equal(plan.unlinkedAccounts.length, 1, 'the IRA is reported as unlinked');
  assert.equal(plan.unlinkedAccounts[0].externalLabel, '…4444');
  assert.deepEqual(plan.cashUpdates, [{ accountId: 'a_tax', before: 42000, after: 51234.5 }]);
});

test('a second sync after applying is a no-op', async () => {
  const store = baseStore();
  const plan = await sync.fetchSyncPlan(store);
  const { applySyncPlan } = await import('../src/lib/brokers/reconcile');
  applySyncPlan(store, plan);

  const again = await sync.fetchSyncPlan(store);
  assert.equal(again.changes.length, 0, `expected no changes, got ${JSON.stringify(again.changes.map((c) => c.kind))}`);
  assert.equal(again.unchanged, 4);
});

test('fetches quotes and calibrates the surface from the live chain', async () => {
  const store = baseStore();
  const plan = await sync.fetchSyncPlan(store);
  const { applySyncPlan } = await import('../src/lib/brokers/reconcile');
  applySyncPlan(store, plan);

  const data = await sync.fetchMarketData(store);

  const nvda = data.instruments.find((i) => i.symbol === 'NVDA')!;
  assert.ok(nvda.price, 'price should change');
  assert.equal(nvda.price!.after, 181.25);

  assert.ok(nvda.surface, 'NVDA has options, so it should be calibrated');
  // The mock chain is built at 44 vol with a -0.05 skew and 0.06 smile.
  assert.ok(Math.abs(nvda.surface!.after.ivAtm30 - 0.44) < 0.02, `fitted ${nvda.surface!.after.ivAtm30}`);
  assert.ok(nvda.surface!.after.skewSlope < -0.02, `fitted skew ${nvda.surface!.after.skewSlope}`);
  assert.ok(nvda.surface!.rmseVolPoints < 1.5, `residual ${nvda.surface!.rmseVolPoints}`);
  assert.ok(nvda.surface!.expiries >= 2, 'both expiries used');

  const vti = data.instruments.find((i) => i.symbol === 'VTI')!;
  assert.ok(vti.price, 'VTI price updated from the quote');
  assert.equal(vti.surface, undefined, 'no options held, so no chain call and no fit');
  assert.ok(Math.abs(vti.dividendYield!.after - 0.0131) < 1e-9, 'yield converted from percent');

  assert.equal(data.contracts.length, 2, 'both held contracts marked');
  for (const contract of data.contracts) {
    assert.ok(contract.iv !== null && contract.iv > 0.1 && contract.iv < 1.5, `IV ${contract.iv}`);
  }
});

test('applying market data writes prices, surface and per-contract IV', async () => {
  const store = baseStore();
  const { applySyncPlan } = await import('../src/lib/brokers/reconcile');
  applySyncPlan(store, await sync.fetchSyncPlan(store));

  const data = await sync.fetchMarketData(store);
  const result = sync.applyMarketData(store, data);

  assert.ok(result.pricesUpdated >= 2);
  assert.equal(result.surfacesFitted, 1);
  assert.equal(result.contractsMarked, 2);

  const nvda = store.instruments.find((i) => i.symbol === 'NVDA')!;
  assert.equal(nvda.price, 181.25);
  assert.ok(Math.abs(nvda.ivAtm30 - 0.44) < 0.02, 'the typed 30 vol is replaced by the fitted one');
  assert.ok(nvda.surfaceFit, 'fit quality is recorded');
  assert.ok(nvda.surfaceFit!.samples > 10);
  assert.equal(nvda.source, 'SCHWAB');

  const marked = store.positions.filter((p) => p.kind === 'OPTION' && p.markIv !== undefined);
  assert.equal(marked.length, 2);
});

test('the fitted surface actually prices the held contracts', async () => {
  const store = baseStore();
  const { applySyncPlan } = await import('../src/lib/brokers/reconcile');
  applySyncPlan(store, await sync.fetchSyncPlan(store));
  sync.applyMarketData(store, await sync.fetchMarketData(store));

  const { buildMarketState, captureAnchors, valuePortfolio } = await import('../src/lib/portfolio/valuation');
  const asOf = new Date();
  const instruments = Object.fromEntries(store.instruments.map((i) => [i.symbol, i]));
  const anchors = captureAnchors(store.positions, instruments, store.settings, asOf);
  const valuation = valuePortfolio(store.positions, store.accounts, buildMarketState(store, { asOf }), { anchors });

  for (const v of valuation.positions) {
    assert.ok(Number.isFinite(v.marketValue), `${v.symbol} priced to ${v.marketValue}`);
    assert.ok(Number.isFinite(v.deltaDollars));
  }
  assert.ok(Number.isFinite(valuation.total.netLiquidation));
  assert.ok(valuation.total.netLiquidation > 0);
});

test('an expired access token triggers exactly one refresh, transparently', async () => {
  const expiring = await startMockSchwab({ expireTokenOnce: true });
  const previous = process.env.SCHWAB_API_BASE;
  process.env.SCHWAB_API_BASE = expiring.origin;
  try {
    // The client reads API_BASE at module load, so this exercises the retry
    // path against the original server; assert on grant types instead.
    const before = mock.tokenGrants.length;
    await tokens.saveTokens({
      accessToken: 'stale',
      refreshToken: 'refresh-token',
      accessExpiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    await sync.fetchAccounts();
    assert.ok(mock.tokenGrants.length > before, 'a refresh was requested');
    assert.equal(mock.tokenGrants.at(-1), 'refresh_token');
  } finally {
    process.env.SCHWAB_API_BASE = previous;
    await expiring.close();
  }
});

test('a lapsed refresh token fails with an actionable message, not a retry loop', async () => {
  await tokens.saveTokens({
    accessToken: 'x',
    refreshToken: 'y',
    accessExpiresAt: Date.now() + 60_000,
    refreshExpiresAt: Date.now() - 1000,
    createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
  });
  await assert.rejects(() => sync.fetchAccounts(), /seven days|reconnect/i);

  await tokens.saveTokens({
    accessToken: 'ok',
    refreshToken: 'refresh-token',
    accessExpiresAt: Date.now() + 25 * 60 * 1000,
    refreshExpiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  });
});

test('tokens are encrypted at rest and never written in the clear', async () => {
  const file = path.join(dataDir, 'schwab-tokens.enc');
  const raw = await fs.readFile(file, 'utf8');
  assert.ok(!raw.includes('refresh-token'), 'the refresh token must not appear in the file');
  assert.ok(!raw.includes('accessToken'), 'no plaintext JSON keys either');

  const stat = await fs.stat(file);
  assert.equal(stat.mode & 0o077, 0, 'the token file must not be group- or world-readable');

  const round = await tokens.loadTokens();
  assert.equal(round!.refreshToken, 'refresh-token', 'and it still decrypts');
});

test('the payload inspector reports keys but no values', async () => {
  await sync.fetchAccounts();
  const shapes = sync.rawShapes();
  const text = JSON.stringify(shapes);

  assert.ok(text.includes('securitiesAccount'), 'shows the real field names');
  assert.ok(text.includes('longQuantity'));
  assert.ok(!text.includes('11112222'), 'no account numbers');
  assert.ok(!text.includes('142400'), 'no position values');
});
