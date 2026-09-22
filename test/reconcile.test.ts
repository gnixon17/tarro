import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySyncPlan, buildSyncPlan } from '../src/lib/brokers/reconcile';
import type { MappedPosition } from '../src/lib/brokers/schwabMap';
import { DEFAULT_SETTINGS, type PortfolioStore, type Position } from '../src/lib/types';

function store(positions: Position[] = [], linked = true): PortfolioStore {
  return {
    accounts: [
      {
        id: 'a1', name: 'Main brokerage', broker: 'Schwab', kind: 'TAXABLE', cash: 42000,
        ...(linked ? { externalId: 'HASH1', externalLabel: '…4321' } : {}),
      },
      { id: 'a2', name: 'Unlinked', broker: 'Fidelity', kind: 'ROTH_IRA', cash: 1000 },
    ],
    instruments: [
      { symbol: 'NVDA', name: 'NVIDIA', price: 178, dividendYield: 0, beta: 1.9, ivAtm30: 0.44, volBeta: 1, skewSlope: -0.05, skewCurvature: 0.07, termSlope: 0.01 },
    ],
    positions,
    groups: [],
    scenarios: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

const shares = (over: Partial<Position> = {}): Position => ({
  id: 'p1', kind: 'EQUITY', accountId: 'a1', symbol: 'NVDA', quantity: 800, costBasis: 61.4, ...over,
} as Position);

const put = (over: Partial<Position> = {}): Position => ({
  id: 'p2', kind: 'OPTION', accountId: 'a1', symbol: 'NVDA', right: 'PUT', strike: 155,
  expiry: '2027-01-15', quantity: 8, multiplier: 100, costBasis: 18.4, ...over,
} as Position);

const incomingShares: MappedPosition = {
  kind: 'EQUITY', symbol: 'NVDA', quantity: 800, costBasis: 61.4, externalSymbol: 'NVDA', marketValue: 142400,
};
const incomingPut: MappedPosition = {
  kind: 'OPTION', symbol: 'NVDA', right: 'PUT', strike: 155, expiry: '2027-01-15',
  quantity: 8, multiplier: 100, costBasis: 18.4, externalSymbol: 'NVDA  270115P00155000', marketValue: 5887,
};

const account = (positions: MappedPosition[], cash = 42000) => [
  { externalId: 'HASH1', externalLabel: '…4321', marginType: 'MARGIN', cash, positions },
];

test('a new position is proposed for creation', () => {
  const plan = buildSyncPlan({ store: store(), accounts: account([incomingShares]) });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].kind, 'create');
  assert.equal(plan.changes[0].label, 'NVDA shares');
});

test('an unchanged synced position produces no change', () => {
  const plan = buildSyncPlan({
    store: store([shares({ source: 'SCHWAB' })]),
    accounts: account([incomingShares]),
  });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.unchanged, 1);
});

test('a quantity change is an update with before and after', () => {
  const plan = buildSyncPlan({
    store: store([shares({ source: 'SCHWAB' })]),
    accounts: account([{ ...incomingShares, quantity: 900 }]),
  });
  assert.equal(plan.changes.length, 1);
  const change = plan.changes[0];
  assert.equal(change.kind, 'update');
  assert.deepEqual(change.before, { quantity: 800, costBasis: 61.4 });
  assert.deepEqual(change.after, { quantity: 900, costBasis: 61.4 });
  assert.match(change.detail, /800 → 900/);
});

test('a hand-entered position is adopted, not duplicated, and keeps its group and notes', () => {
  const existing = shares({ groupId: 'grp_collar', notes: 'core holding', openedAt: '2024-02-20' });
  const plan = buildSyncPlan({ store: store([existing]), accounts: account([{ ...incomingShares, costBasis: 60 }]) });

  assert.equal(plan.changes.length, 1);
  const change = plan.changes[0];
  assert.equal(change.kind, 'adopt');
  assert.equal(change.positionId, 'p1');

  const s = store([existing]);
  applySyncPlan(s, plan);
  assert.equal(s.positions.length, 1, 'adopted, not duplicated');
  assert.equal(s.positions[0].groupId, 'grp_collar', 'strategy group survives');
  assert.equal(s.positions[0].notes, 'core holding', 'notes survive');
  assert.equal(s.positions[0].openedAt, '2024-02-20');
  assert.equal(s.positions[0].costBasis, 60, 'broker cost wins');
  assert.equal(s.positions[0].source, 'SCHWAB');
});

test('a hand-entered position the broker does not report is never closed', () => {
  const plan = buildSyncPlan({
    store: store([shares(), put({ source: 'SCHWAB' })]),
    accounts: account([]),
  });
  const closes = plan.changes.filter((c) => c.kind === 'close');
  assert.equal(closes.length, 1, 'only the synced leg is proposed for closing');
  assert.equal(closes[0].positionId, 'p2');
});

test('closes are excluded by default and only run when explicitly accepted', () => {
  const positions = [shares({ source: 'SCHWAB' }), put({ source: 'SCHWAB' })];
  const plan = buildSyncPlan({ store: store(positions), accounts: account([incomingShares]) });
  const close = plan.changes.find((c) => c.kind === 'close')!;
  assert.ok(close);

  const safe = store([shares({ source: 'SCHWAB' }), put({ source: 'SCHWAB' })]);
  const r1 = applySyncPlan(safe, plan);
  assert.equal(r1.closed, 0, 'default apply must not delete');
  assert.equal(safe.positions.length, 2);

  const explicit = store([shares({ source: 'SCHWAB' }), put({ source: 'SCHWAB' })]);
  const r2 = applySyncPlan(explicit, plan, new Set([close.key]));
  assert.equal(r2.closed, 1);
  assert.equal(explicit.positions.length, 1);
});

test('positions in other accounts are untouched', () => {
  const other = shares({ id: 'p9', accountId: 'a2', source: 'SCHWAB' });
  const plan = buildSyncPlan({ store: store([other]), accounts: account([]) });
  assert.equal(plan.changes.length, 0, 'a2 is not linked to this broker account');
});

test('an unlinked broker account is reported, not guessed at', () => {
  const plan = buildSyncPlan({
    store: store([], false),
    accounts: account([incomingShares]),
  });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.unlinkedAccounts.length, 1);
  assert.equal(plan.unlinkedAccounts[0].externalLabel, '…4321');
});

test('unknown tickers are listed and created on apply', () => {
  const incoming: MappedPosition = {
    kind: 'EQUITY', symbol: 'AMD', quantity: 100, costBasis: 120, externalSymbol: 'AMD', marketValue: 12000,
  };
  const plan = buildSyncPlan({ store: store(), accounts: account([incoming]) });
  assert.deepEqual(plan.newInstruments, ['AMD']);

  const s = store();
  const r = applySyncPlan(s, plan);
  assert.equal(r.instrumentsCreated, 1);
  assert.ok(s.instruments.some((i) => i.symbol === 'AMD'));
});

test('a ticker is not created when its position is rejected', () => {
  const incoming: MappedPosition = {
    kind: 'EQUITY', symbol: 'AMD', quantity: 100, costBasis: 120, externalSymbol: 'AMD', marketValue: 12000,
  };
  const plan = buildSyncPlan({ store: store(), accounts: account([incoming]) });
  const s = store();
  applySyncPlan(s, plan, new Set());
  assert.equal(s.instruments.some((i) => i.symbol === 'AMD'), false);
});

test('cash differences are proposed and applied', () => {
  const plan = buildSyncPlan({ store: store(), accounts: account([], 51234.5) });
  assert.deepEqual(plan.cashUpdates, [{ accountId: 'a1', before: 42000, after: 51234.5 }]);
  const s = store();
  applySyncPlan(s, plan);
  assert.equal(s.accounts[0].cash, 51234.5);
});

test('options match on the full contract, not just the ticker', () => {
  const plan = buildSyncPlan({
    store: store([put({ source: 'SCHWAB' })]),
    accounts: account([{ ...incomingPut, strike: 150 }]),
  });
  const kinds = plan.changes.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['close', 'create'], 'a different strike is a different contract');
});

test('apply stamps lastSyncedAt on linked accounts only', () => {
  const s = store();
  applySyncPlan(s, buildSyncPlan({ store: s, accounts: account([]) }));
  assert.ok(s.accounts[0].lastSyncedAt, 'linked account stamped');
  assert.equal(s.accounts[1].lastSyncedAt, undefined, 'unlinked account untouched');
});
