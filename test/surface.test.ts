import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  atmVol,
  instrumentAtmVolShock,
  marketAtmVolShock,
  surfaceParamsFor,
  surfaceVol,
  termResponseFactor,
} from '../src/lib/options/surface';
import { DEFAULT_VOL_MODEL, type Instrument } from '../src/lib/types';

const spy: Instrument = {
  symbol: 'SPY', name: 'SPY', price: 600, dividendYield: 0.012, beta: 1,
  ivAtm30: 0.15, volBeta: 1, skewSlope: -0.085, skewCurvature: 0.05, termSlope: 0.012,
};
const nvda: Instrument = {
  symbol: 'NVDA', name: 'NVDA', price: 180, dividendYield: 0, beta: 1.9,
  ivAtm30: 0.45, volBeta: 1.3, skewSlope: -0.05, skewCurvature: 0.07, termSlope: 0.01,
};

const params = surfaceParamsFor(spy, DEFAULT_VOL_MODEL);
const ctx = { spot: 600, rate: 0.04, dividendYield: 0.012 };

test('downside puts carry more implied vol than upside calls', () => {
  const t = 90 / 365;
  const downside = surfaceVol(params, 480, t, ctx);
  const atTheMoney = surfaceVol(params, 600, t, ctx);
  const upside = surfaceVol(params, 720, t, ctx);
  assert.ok(downside > atTheMoney, `${downside} should exceed ${atTheMoney}`);
  assert.ok(atTheMoney > upside, `${atTheMoney} should exceed ${upside}`);
});

test('skew flattens with tenor', () => {
  const nearSkew = surfaceVol(params, 540, 30 / 365, ctx) - surfaceVol(params, 600, 30 / 365, ctx);
  const farSkew = surfaceVol(params, 540, 720 / 365, ctx) - surfaceVol(params, 600, 720 / 365, ctx);
  assert.ok(nearSkew > farSkew, `near ${nearSkew} should be steeper than far ${farSkew}`);
});

test('term structure is upward sloping by default', () => {
  assert.ok(atmVol(params, 365 / 365) > atmVol(params, 30 / 365));
});

test('a selloff lifts index vol, a rally compresses it by less', () => {
  const down = marketAtmVolShock(-0.10, DEFAULT_VOL_MODEL);
  const up = marketAtmVolShock(0.10, DEFAULT_VOL_MODEL);
  assert.ok(down > 0, 'a 10% drop should raise vol');
  assert.ok(up < 0, 'a 10% rally should lower vol');
  assert.ok(down > Math.abs(up), 'vol response is asymmetric');
});

test('vol response is convex in the size of the move', () => {
  const small = marketAtmVolShock(-0.05, DEFAULT_VOL_MODEL);
  const large = marketAtmVolShock(-0.20, DEFAULT_VOL_MODEL);
  assert.ok(large / small > 4, `expected super-linear response, got ${large / small}x for 4x the move`);
});

test('a 20% drop roughly doubles index IV', () => {
  const shock = marketAtmVolShock(-0.20, DEFAULT_VOL_MODEL);
  const newIv = spy.ivAtm30 + shock;
  assert.ok(newIv > 0.3 && newIv < 0.7, `SPY 15 vol -> ${(newIv * 100).toFixed(1)} vol is outside the plausible band`);
});

test('high-vol names move more vol points than the index', () => {
  const marketShock = marketAtmVolShock(-0.15, DEFAULT_VOL_MODEL);
  const spyShift = instrumentAtmVolShock(spy, marketShock, spy.ivAtm30, DEFAULT_VOL_MODEL);
  const nvdaShift = instrumentAtmVolShock(nvda, marketShock, spy.ivAtm30, DEFAULT_VOL_MODEL);
  assert.ok(nvdaShift > spyShift * 2, `NVDA ${nvdaShift} vs SPY ${spyShift}`);
});

test('short-dated vol reacts harder than long-dated', () => {
  const weekly = termResponseFactor(7 / 365, DEFAULT_VOL_MODEL);
  const monthly = termResponseFactor(30 / 365, DEFAULT_VOL_MODEL);
  const leaps = termResponseFactor(730 / 365, DEFAULT_VOL_MODEL);
  assert.ok(weekly > monthly, `${weekly} > ${monthly}`);
  assert.ok(monthly > leaps, `${monthly} > ${leaps}`);
  assert.ok(Math.abs(monthly - 1) < 1e-9, '30 days is the reference tenor');
});

test('vol stays inside its clamps under an extreme shock', () => {
  const shock = marketAtmVolShock(-0.9, DEFAULT_VOL_MODEL);
  const v = surfaceVol(params, 100, 7 / 365, { ...ctx, atmShift: shock });
  assert.ok(v <= DEFAULT_VOL_MODEL.maxVol && v >= DEFAULT_VOL_MODEL.minVol, `vol ${v} escaped its clamps`);
});

test('the market vol response reproduces the historical record', () => {
  // (index move %, VIX points gained). Tolerance is wide on purpose - this is a
  // regime-dependent relationship, not a law - but it must land in the right
  // neighbourhood, because every hedge P&L in the app depends on it.
  const episodes: [number, number, number][] = [
    [-5, 7, 4],    // typical 5% pullback
    [-10, 15, 6],  // Feb 2018 style
    [-20, 30, 12], // Aug 2015 / Oct 2018 style
    [-34, 68, 18], // COVID
  ];
  for (const [movePct, expectedPoints, tolerance] of episodes) {
    const got = marketAtmVolShock(movePct / 100, DEFAULT_VOL_MODEL) * 100;
    assert.ok(
      Math.abs(got - expectedPoints) <= tolerance,
      `${movePct}% move: model says +${got.toFixed(1)} vol, history says about +${expectedPoints}`,
    );
  }
});

test('single names gain more vol points than the index but multiply by less', () => {
  // The failure this guards against: scaling by the raw vol ratio, which sent a
  // 55-vol name to 250 vol on a 20% index drop.
  const marketShock = marketAtmVolShock(-0.20, DEFAULT_VOL_MODEL);
  const spyAfter = spy.ivAtm30 + marketShock;

  for (const name of [nvda, { ...nvda, symbol: 'TSLA', ivAtm30: 0.55 }]) {
    const shift = instrumentAtmVolShock(name as typeof nvda, marketShock, spy.ivAtm30, DEFAULT_VOL_MODEL);
    const after = name.ivAtm30 + shift;

    assert.ok(shift > marketShock, `${name.symbol} should gain more points than the index`);
    assert.ok(
      after / name.ivAtm30 < spyAfter / spy.ivAtm30,
      `${name.symbol} should multiply by less than the index (${(after / name.ivAtm30).toFixed(2)}x vs ${(spyAfter / spy.ivAtm30).toFixed(2)}x)`,
    );
    assert.ok(after < 1.6, `${name.symbol} at ${(after * 100).toFixed(0)} vol is not a market, it is a bug`);
  }
});

test('the COVID preset lands the index near 80 vol', () => {
  const shock = marketAtmVolShock(-0.34, DEFAULT_VOL_MODEL);
  const after = (0.14 + shock) * 100;
  assert.ok(after > 70 && after < 95, `VIX 14 -> ${after.toFixed(0)} does not match the 82 that actually printed`);
});
