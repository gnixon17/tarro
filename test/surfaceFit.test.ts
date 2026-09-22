import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitSmile, fitSurface } from '../src/lib/brokers/surfaceFit';
import { surfaceParamsFor, surfaceVol } from '../src/lib/options/surface';
import { forwardPrice } from '../src/lib/math/blackScholes';
import { DEFAULT_VOL_MODEL, type Instrument } from '../src/lib/types';
import type { ChainContract } from '../src/lib/brokers/schwabMap';

const SPOT = 178;
const RATE = 0.042;
const Q = 0;

/** Build a synthetic chain from known surface parameters. */
function syntheticChain(
  truth: { ivAtm30: number; skewSlope: number; skewCurvature: number; termSlope: number },
  expiries: { expiry: string; days: number }[],
  noiseVolPoints = 0,
): ChainContract[] {
  let seed = 42;
  const rand = () => {
    // Deterministic LCG so the test cannot flake.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };

  const instrument = {
    symbol: 'X', name: 'X', price: SPOT, dividendYield: Q, beta: 1, volBeta: 1, ...truth,
  } as Instrument;
  const params = surfaceParamsFor(instrument, DEFAULT_VOL_MODEL);

  const out: ChainContract[] = [];
  for (const { expiry, days } of expiries) {
    const t = days / 365;
    const fwd = forwardPrice(SPOT, RATE, Q, t);
    for (let pct = -40; pct <= 40; pct += 5) {
      const strike = Math.round(SPOT * (1 + pct / 100));
      const trueIv = surfaceVol(params, strike, t, { spot: SPOT, rate: RATE, dividendYield: Q });
      const iv = trueIv + (noiseVolPoints / 100) * rand() * 2;
      out.push({
        right: strike >= fwd ? 'CALL' : 'PUT',
        symbol: `X${expiry}${strike}`,
        strike, expiry, timeYears: t,
        iv, mark: 1, bid: 0.9, ask: 1.1, openInterest: 500, delta: null,
      });
    }
  }
  return out;
}

const OPTS = { spot: SPOT, rate: RATE, dividendYield: Q };

test('the smile fit recovers known parameters from a clean chain', () => {
  const truth = { ivAtm30: 0.44, skewSlope: -0.05, skewCurvature: 0.07, termSlope: 0.01 };
  const chain = syntheticChain(truth, [{ expiry: '2027-01-15', days: 116 }]);
  const fit = fitSmile(chain, OPTS)!;

  assert.ok(fit, 'expected a fit');
  assert.ok(Math.abs(fit.skewSlope - truth.skewSlope) < 0.01, `skew ${fit.skewSlope} vs ${truth.skewSlope}`);
  assert.ok(Math.abs(fit.skewCurvature - truth.skewCurvature) < 0.02, `curvature ${fit.skewCurvature}`);
  assert.ok(fit.rmseVolPoints < 0.5, `clean chain should fit tightly, got ${fit.rmseVolPoints}`);
});

test('the surface fit recovers level, skew and term structure together', () => {
  const truth = { ivAtm30: 0.44, skewSlope: -0.05, skewCurvature: 0.07, termSlope: 0.03 };
  const chain = syntheticChain(truth, [
    { expiry: '2026-10-16', days: 24 },
    { expiry: '2026-12-18', days: 87 },
    { expiry: '2027-01-15', days: 116 },
    { expiry: '2027-06-17', days: 268 },
  ]);
  const fit = fitSurface(chain, OPTS)!;

  assert.equal(fit.expiries, 4);
  assert.ok(Math.abs(fit.ivAtm30 - truth.ivAtm30) < 0.015, `level ${fit.ivAtm30} vs ${truth.ivAtm30}`);
  assert.ok(Math.abs(fit.skewSlope - truth.skewSlope) < 0.015, `skew ${fit.skewSlope}`);
  assert.ok(Math.abs(fit.termSlope - truth.termSlope) < 0.015, `term ${fit.termSlope} vs ${truth.termSlope}`);
});

test('noise degrades the fit but does not break it, and is reported', () => {
  const truth = { ivAtm30: 0.30, skewSlope: -0.06, skewCurvature: 0.04, termSlope: 0.01 };
  const chain = syntheticChain(truth, [
    { expiry: '2026-11-20', days: 59 },
    { expiry: '2027-03-19', days: 178 },
  ], 2);
  const fit = fitSurface(chain, OPTS)!;

  assert.ok(Math.abs(fit.ivAtm30 - truth.ivAtm30) < 0.03, `level ${fit.ivAtm30}`);
  assert.ok(fit.rmseVolPoints > 0.1, 'noise should show up in the residual');
  assert.ok(fit.rmseVolPoints < 3, `residual ${fit.rmseVolPoints} is too large for 2-point noise`);
});

test('an index-style steep skew is recovered', () => {
  const truth = { ivAtm30: 0.15, skewSlope: -0.085, skewCurvature: 0.05, termSlope: 0.012 };
  const chain = syntheticChain(truth, [{ expiry: '2027-03-19', days: 178 }, { expiry: '2026-12-18', days: 87 }]);
  const fit = fitSurface(chain, OPTS)!;
  assert.ok(fit.skewSlope < -0.06, `expected a steep negative skew, got ${fit.skewSlope}`);
  assert.ok(Math.abs(fit.ivAtm30 - 0.15) < 0.02);
});

test('a single expiry gives a level and a flat term structure, not a fabricated slope', () => {
  const chain = syntheticChain(
    { ivAtm30: 0.4, skewSlope: -0.05, skewCurvature: 0.06, termSlope: 0.02 },
    [{ expiry: '2027-01-15', days: 116 }],
  );
  const fit = fitSurface(chain, OPTS)!;
  assert.equal(fit.expiries, 1);
  assert.equal(fit.termSlope, 0, 'one expiry cannot imply a slope');
});

test('returns null rather than junk when the chain cannot support a fit', () => {
  assert.equal(fitSurface([], OPTS), null);
  assert.equal(fitSmile([], OPTS), null);

  // Two quoted strikes cannot determine a quadratic.
  const thin: ChainContract[] = [
    { right: 'PUT', symbol: 'a', strike: 150, expiry: '2027-01-15', timeYears: 0.3, iv: 0.5, mark: 1, bid: 1, ask: 1, openInterest: 1, delta: null },
    { right: 'CALL', symbol: 'b', strike: 200, expiry: '2027-01-15', timeYears: 0.3, iv: 0.4, mark: 1, bid: 1, ask: 1, openInterest: 1, delta: null },
  ];
  assert.equal(fitSurface(thin, OPTS), null);
});

test('contracts with no quoted IV are ignored', () => {
  const chain = syntheticChain({ ivAtm30: 0.4, skewSlope: -0.05, skewCurvature: 0.06, termSlope: 0 }, [
    { expiry: '2027-01-15', days: 116 },
  ]).map((c, i) => (i % 3 === 0 ? { ...c, iv: null } : c));
  const fit = fitSurface(chain, OPTS)!;
  assert.ok(fit.samples > 0);
  assert.ok(Math.abs(fit.ivAtm30 - 0.4) < 0.02);
});

test('the open-interest filter drops untraded strikes', () => {
  const chain = syntheticChain({ ivAtm30: 0.4, skewSlope: -0.05, skewCurvature: 0.06, termSlope: 0 }, [
    { expiry: '2027-01-15', days: 116 },
  ]).map((c, i) => (i % 2 === 0 ? { ...c, openInterest: 0 } : c));

  const unfiltered = fitSurface(chain, OPTS)!;
  const filtered = fitSurface(chain, { ...OPTS, minOpenInterest: 1 })!;
  assert.ok(filtered.samples < unfiltered.samples);
});
