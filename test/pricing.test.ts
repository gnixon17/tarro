import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bsmGreeks, bsmPrice, impliedVol, strikeForDelta } from '../src/lib/math/blackScholes';
import { normCdf, normInv, normPdf } from '../src/lib/math/gaussian';

test('normCdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-12);
  assert.ok(Math.abs(normCdf(1) - 0.8413447460685429) < 1e-12);
  assert.ok(Math.abs(normCdf(-1) - 0.15865525393145707) < 1e-12);
  assert.ok(Math.abs(normCdf(1.96) - 0.9750021048517795) < 1e-12);
  assert.ok(Math.abs(normCdf(-8) - 6.220960574271793e-16) < 1e-20);
});

test('normInv inverts normCdf', () => {
  for (const p of [0.001, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999]) {
    assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-10, `p=${p}`);
  }
});

test('normPdf integrates to a sane peak', () => {
  assert.ok(Math.abs(normPdf(0) - 0.3989422804014327) < 1e-15);
});

const base = { spot: 100, strike: 100, timeYears: 1, vol: 0.2, rate: 0.05, dividendYield: 0.0 } as const;

test('known Black-Scholes value', () => {
  // Textbook: S=100, K=100, T=1, sigma=0.20, r=0.05 -> call 10.4506
  const call = bsmPrice({ ...base, right: 'CALL' });
  assert.ok(Math.abs(call - 10.450583572185565) < 1e-9, `got ${call}`);
});

test('put-call parity holds with a dividend yield', () => {
  const i = { spot: 123.45, strike: 110, timeYears: 0.75, vol: 0.31, rate: 0.043, dividendYield: 0.017 };
  const call = bsmPrice({ ...i, right: 'CALL' });
  const put = bsmPrice({ ...i, right: 'PUT' });
  const lhs = call - put;
  const rhs = i.spot * Math.exp(-i.dividendYield * i.timeYears) - i.strike * Math.exp(-i.rate * i.timeYears);
  assert.ok(Math.abs(lhs - rhs) < 1e-10, `parity off by ${lhs - rhs}`);
});

test('greeks agree with finite differences', () => {
  const i = { spot: 190, strike: 200, timeYears: 0.6, vol: 0.38, rate: 0.045, dividendYield: 0.01, right: 'PUT' as const };
  const g = bsmGreeks(i);
  const h = 1e-4;

  const dPrice = (bsmPrice({ ...i, spot: i.spot + h }) - bsmPrice({ ...i, spot: i.spot - h })) / (2 * h);
  assert.ok(Math.abs(dPrice - g.delta) < 1e-6, `delta ${g.delta} vs ${dPrice}`);

  const d2 = (bsmPrice({ ...i, spot: i.spot + h }) - 2 * bsmPrice(i) + bsmPrice({ ...i, spot: i.spot - h })) / (h * h);
  assert.ok(Math.abs(d2 - g.gamma) < 1e-4, `gamma ${g.gamma} vs ${d2}`);

  const dVol = (bsmPrice({ ...i, vol: i.vol + h }) - bsmPrice({ ...i, vol: i.vol - h })) / (2 * h);
  assert.ok(Math.abs(dVol - g.vega) < 1e-4, `vega ${g.vega} vs ${dVol}`);

  const dT = -(bsmPrice({ ...i, timeYears: i.timeYears + h }) - bsmPrice({ ...i, timeYears: i.timeYears - h })) / (2 * h);
  assert.ok(Math.abs(dT - g.theta) < 1e-4, `theta ${g.theta} vs ${dT}`);

  const dR = (bsmPrice({ ...i, rate: i.rate + h }) - bsmPrice({ ...i, rate: i.rate - h })) / (2 * h);
  assert.ok(Math.abs(dR - g.rho) < 1e-4, `rho ${g.rho} vs ${dR}`);
});

test('expired options collapse to intrinsic', () => {
  const g = bsmGreeks({ spot: 120, strike: 100, timeYears: 0, vol: 0.4, rate: 0.05, dividendYield: 0, right: 'CALL' });
  assert.equal(g.price, 20);
  assert.equal(g.delta, 1);
  assert.equal(g.vega, 0);
});

test('implied vol round-trips across the surface', () => {
  for (const strike of [60, 90, 100, 115, 160]) {
    for (const t of [0.02, 0.25, 1, 3]) {
      for (const vol of [0.1, 0.35, 0.9]) {
        for (const right of ['CALL', 'PUT'] as const) {
          const i = { spot: 100, strike, timeYears: t, rate: 0.04, dividendYield: 0.01, right };
          const price = bsmPrice({ ...i, vol });
          const solved = impliedVol(price, i);
          const where = `K=${strike} T=${t} v=${vol} ${right}`;
          assert.ok(solved !== null, `no solution for ${where}`);

          // Where vega has collapsed - deep ITM, days to expiry - the option is
          // all intrinsic and implied vol is genuinely undefined: every vol
          // reprints the same price. Assert what is recoverable there.
          const vega = bsmGreeks({ ...i, vol }).vega;
          if (vega > 1e-4) {
            assert.ok(Math.abs(solved! - vol) < 1e-5, `${where}: ${solved} vs ${vol}`);
          } else {
            assert.ok(
              Math.abs(bsmPrice({ ...i, vol: solved! }) - price) < 1e-6,
              `${where}: solved vol does not reprint the price`,
            );
          }
        }
      }
    }
  }
});

test('implied vol rejects arbitrage-violating prices', () => {
  const i = { spot: 100, strike: 100, timeYears: 1, rate: 0.05, dividendYield: 0, right: 'CALL' as const };
  assert.equal(impliedVol(-1, i), null);
  assert.equal(impliedVol(500, i), null);
});

test('strikeForDelta inverts the delta', () => {
  const k = strikeForDelta(0.25, 'PUT', 500, 0.5, 0.22, 0.04, 0.01);
  const g = bsmGreeks({ spot: 500, strike: k, timeYears: 0.5, vol: 0.22, rate: 0.04, dividendYield: 0.01, right: 'PUT' });
  assert.ok(Math.abs(Math.abs(g.delta) - 0.25) < 1e-6, `delta was ${g.delta}`);
  assert.ok(k < 500, 'a 25-delta put should be below spot');
});

test('a NaN input propagates instead of pricing to zero', () => {
  // Guards a real failure: a NaN vol used to make normCdf return 0, so every
  // option in a stress run priced at exactly $0 and the hedges silently
  // vanished from the P&L while the numbers still looked plausible.
  assert.ok(Number.isNaN(normCdf(NaN)));
  assert.ok(
    Number.isNaN(bsmPrice({ spot: 100, strike: 100, timeYears: 1, vol: NaN, rate: 0.04, dividendYield: 0, right: 'CALL' })),
  );
  assert.equal(normCdf(Infinity), 1);
  assert.equal(normCdf(-Infinity), 0);
});
