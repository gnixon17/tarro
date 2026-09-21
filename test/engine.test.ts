import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScenario, shockTickers } from '../src/lib/sim/engine';
import { makeScenario } from '../src/lib/sim/presets';
import { buildMarketState, valuePortfolio, yearsToExpiry } from '../src/lib/portfolio/valuation';
import { underlyingLadder } from '../src/lib/portfolio/analysis';
import { demoStore } from '../src/lib/seed';
import { DEFAULT_SETTINGS, type Instrument, type PortfolioStore, type Position } from '../src/lib/types';

function instrument(symbol: string, price: number, beta: number, iv: number): Instrument {
  return {
    symbol, name: symbol, price, dividendYield: 0, beta,
    ivAtm30: iv, volBeta: 1, skewSlope: -0.06, skewCurvature: 0.04, termSlope: 0.01,
  };
}

/** Portfolio with a single long-stock line and whatever legs are passed in. */
function storeWith(positions: Position[], instruments: Instrument[]): PortfolioStore {
  return {
    accounts: [{ id: 'a', name: 'Test', broker: 'T', kind: 'TAXABLE', cash: 0 }],
    instruments,
    positions,
    groups: [],
    scenarios: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

const oneYearOut = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

test('beta propagates a market move to every ticker', () => {
  const store = storeWith([], [instrument('SPY', 600, 1, 0.15), instrument('NVDA', 180, 2, 0.45)]);
  const scenario = makeScenario({ name: 's', marketMovePct: -10 });
  const outcomes = shockTickers(store.instruments, scenario, 'SPY', store.settings.volModel, -10);

  const spy = outcomes.find((o) => o.symbol === 'SPY')!;
  const nvda = outcomes.find((o) => o.symbol === 'NVDA')!;
  assert.ok(Math.abs(spy.returnPct - -10) < 1e-9);
  assert.ok(Math.abs(nvda.returnPct - -20) < 1e-9, `beta 2 on -10% should be -20%, got ${nvda.returnPct}`);
  assert.equal(spy.source, 'MARKET_PROXY');
  assert.equal(nvda.source, 'BETA');
});

test('per-ticker overrides beat beta, and pinning holds a name flat', () => {
  const store = storeWith([], [instrument('SPY', 600, 1, 0.15), instrument('NVDA', 180, 2, 0.45), instrument('KO', 70, 0.6, 0.18)]);
  const scenario = makeScenario({
    name: 's',
    marketMovePct: -10,
    tickerShocks: { NVDA: { movePct: -45 }, KO: { pinned: true } },
  });
  const outcomes = shockTickers(store.instruments, scenario, 'SPY', store.settings.volModel, -10);
  assert.equal(outcomes.find((o) => o.symbol === 'NVDA')!.returnPct, -45);
  assert.equal(outcomes.find((o) => o.symbol === 'KO')!.returnPct, 0);
  assert.equal(outcomes.find((o) => o.symbol === 'KO')!.ivPointsChange, 0);
});

test('a selloff lifts implied vol on every name', () => {
  const store = storeWith([], [instrument('SPY', 600, 1, 0.15), instrument('NVDA', 180, 2, 0.45)]);
  const scenario = makeScenario({ name: 's', marketMovePct: -20 });
  const outcomes = shockTickers(store.instruments, scenario, 'SPY', store.settings.volModel, -20);
  for (const o of outcomes) {
    assert.ok(o.ivPointsChange > 0, `${o.symbol} IV should rise, got ${o.ivPointsChange}`);
  }
  const nvda = outcomes.find((o) => o.symbol === 'NVDA')!;
  const spy = outcomes.find((o) => o.symbol === 'SPY')!;
  assert.ok(nvda.ivPointsChange > spy.ivPointsChange, 'the high-beta, high-vol name should move more');
});

test('a protective put cuts the loss in a crash', () => {
  const instruments = [instrument('SPY', 600, 1, 0.15), instrument('XYZ', 100, 1, 0.3)];
  const shares: Position[] = [
    { id: 'eq', kind: 'EQUITY', accountId: 'a', symbol: 'XYZ', quantity: 1000, costBasis: 60 },
  ];
  const hedged: Position[] = [
    ...shares,
    { id: 'op', kind: 'OPTION', accountId: 'a', symbol: 'XYZ', right: 'PUT', strike: 95, expiry: oneYearOut, quantity: 10, multiplier: 100, costBasis: 8 },
  ];
  const scenario = makeScenario({ name: 'crash', marketMovePct: -30, daysForward: 20 });

  const naked = runScenario(storeWith(shares, instruments), scenario);
  const withPut = runScenario(storeWith(hedged, instruments), scenario);

  assert.ok(naked.total.pnl < 0, 'unhedged shares should lose in a 30% crash');
  assert.ok(withPut.total.pnl > naked.total.pnl, 'the put should reduce the loss');
  assert.ok(withPut.total.hedgeContribution > 0, 'hedge contribution should be positive in a crash');

  // The put leg itself must gain: spot down, IV up, both help a long put.
  const put = withPut.positions.find((p) => p.positionId === 'op')!;
  assert.ok(put.pnl > 0, `put should gain, got ${put.pnl}`);
  assert.ok((put.shockedIv ?? 0) > (put.baseIv ?? 0), 'put IV should rise in the crash');
});

test('a covered call caps the upside', () => {
  const instruments = [instrument('SPY', 600, 1, 0.15), instrument('XYZ', 100, 1, 0.3)];
  const shares: Position[] = [
    { id: 'eq', kind: 'EQUITY', accountId: 'a', symbol: 'XYZ', quantity: 100, costBasis: 60 },
  ];
  const covered: Position[] = [
    ...shares,
    { id: 'cc', kind: 'OPTION', accountId: 'a', symbol: 'XYZ', right: 'CALL', strike: 105, expiry: oneYearOut, quantity: -1, multiplier: 100, costBasis: 9 },
  ];
  const rally = makeScenario({ name: 'rally', marketMovePct: 40, daysForward: 370 });

  const naked = runScenario(storeWith(shares, instruments), rally);
  const withCall = runScenario(storeWith(covered, instruments), rally);
  assert.ok(withCall.total.pnl < naked.total.pnl, 'the short call should cap the upside');
  assert.ok(withCall.total.hedgeContribution < 0, 'the cap costs money in a rally');
});

test('the stress curve is monotonic for a plain long book', () => {
  const instruments = [instrument('SPY', 600, 1, 0.15)];
  const positions: Position[] = [
    { id: 'eq', kind: 'EQUITY', accountId: 'a', symbol: 'SPY', quantity: 100, costBasis: 500 },
  ];
  const scenario = makeScenario({ name: 's', marketMovePct: 0, sweep: { from: -30, to: 30, steps: 25 } });
  const result = runScenario(storeWith(positions, instruments), scenario);

  assert.equal(result.curve.length, 25);
  for (let i = 1; i < result.curve.length; i++) {
    assert.ok(result.curve[i].pnl > result.curve[i - 1].pnl, 'long stock P&L must rise with the market');
  }
  const flat = result.curve.find((p) => Math.abs(p.movePct) < 1e-9);
  if (flat) assert.ok(Math.abs(flat.pnl) < 1e-6, 'a flat market is a flat P&L for shares');
});

test('a zero move with no time forward is a no-op', () => {
  const store = demoStore();
  const scenario = makeScenario({ name: 'flat', marketMovePct: 0, daysForward: 0 });
  const result = runScenario(store, scenario);
  assert.ok(Math.abs(result.total.pnl) < 1e-6, `expected no P&L, got ${result.total.pnl}`);
  assert.ok(Math.abs(result.total.unhedgedPnl) < 1e-9);
});

test('time alone decays long premium and pays short premium', () => {
  const instruments = [instrument('SPY', 600, 1, 0.15), instrument('XYZ', 100, 1, 0.3)];
  const longCall: Position[] = [
    { id: 'lc', kind: 'OPTION', accountId: 'a', symbol: 'XYZ', right: 'CALL', strike: 100, expiry: oneYearOut, quantity: 1, multiplier: 100, costBasis: 12 },
  ];
  const shortCall: Position[] = [{ ...longCall[0], id: 'sc', quantity: -1 }];
  const scenario = makeScenario({ name: 'theta', marketMovePct: 0, daysForward: 60 });

  assert.ok(runScenario(storeWith(longCall, instruments), scenario).total.pnl < 0);
  assert.ok(runScenario(storeWith(shortCall, instruments), scenario).total.pnl > 0);
});

test('a marked IV is respected and still responds to the shock', () => {
  const instruments = [instrument('SPY', 600, 1, 0.15), instrument('XYZ', 100, 1, 0.3)];
  const positions: Position[] = [
    { id: 'op', kind: 'OPTION', accountId: 'a', symbol: 'XYZ', right: 'PUT', strike: 90, expiry: oneYearOut, quantity: 1, multiplier: 100, costBasis: 5, markIv: 0.55 },
  ];
  const store = storeWith(positions, instruments);
  const state = buildMarketState(store);
  const anchored = valuePortfolio(positions, store.accounts, state, {
    anchors: { op: 0.55 - 0 },
  });
  assert.ok(anchored.positions.length === 1);

  const result = runScenario(store, makeScenario({ name: 'x', marketMovePct: -15, daysForward: 1 }));
  const leg = result.positions[0];
  assert.ok(Math.abs((leg.baseIv ?? 0) - 0.55) < 1e-6, `base IV should be the mark, got ${leg.baseIv}`);
  assert.ok((leg.shockedIv ?? 0) > 0.55, 'the marked IV should still rise in a selloff');
});

test('account filtering restricts the run', () => {
  const store = demoStore();
  const all = runScenario(store, makeScenario({ name: 'a', marketMovePct: -20, daysForward: 10 }));
  const rothOnly = runScenario(
    store,
    makeScenario({ name: 'b', marketMovePct: -20, daysForward: 10, accountIds: ['acc_roth'] }),
  );
  assert.ok(rothOnly.base.total.netLiquidation < all.base.total.netLiquidation);
  assert.ok(rothOnly.byAccount.every((a) => a.key === 'acc_roth'));
});

test('the demo portfolio survives a 34% crash with hedges helping', () => {
  const store = demoStore();
  const covid = store.scenarios.find((s) => s.name.includes('COVID'))!;
  const result = runScenario(store, covid);
  assert.ok(result.total.pnl < 0, 'a 34% crash should still hurt');
  assert.ok(
    result.total.hedgeContribution > 0,
    `hedges should soften the crash, contribution was ${result.total.hedgeContribution}`,
  );
  assert.ok(result.tickers.every((t) => t.newPrice > 0), 'no ticker should go non-positive');
});

test('the per-ticker expiry ladder is a true payoff diagram', () => {
  const store = demoStore();
  const ladder = underlyingLadder(store, 'NVDA', {
    fromPct: -60, upToPct: 60, steps: 61,
    daysForward: Math.ceil(yearsToExpiry('2027-01-15', new Date()) * 365) + 1,
    applyVolShock: false,
  });
  assert.equal(ladder.length, 61);

  // NVDA is collared: the floor and the cap should both bind at expiry.
  const worst = ladder[0];
  const best = ladder[ladder.length - 1];
  const spot = store.instruments.find((i) => i.symbol === 'NVDA')!.price;
  assert.ok(worst.pnl > worst.sharesOnlyPnl, 'the put floor must beat naked shares on the downside');
  assert.ok(best.pnl < best.sharesOnlyPnl, 'the short call must cap the upside');
  assert.ok(Math.abs(ladder[30].price - spot) < spot * 0.02, 'the ladder should straddle spot');
});
