/**
 * Black-Scholes-Merton with a continuous dividend yield.
 *
 * Every function here is per-share (i.e. not multiplied by the contract
 * multiplier) and vol/rate/yield are decimals per annum, time is in years.
 * Vega/theta/rho are returned in their raw calculus units; the portfolio layer
 * rescales them into "per 1 vol point" / "per day" / "per 1bp" for display.
 */
import { clamp, normCdf, normInv, normPdf } from './gaussian';

export type OptionRight = 'CALL' | 'PUT';

export interface BsmInputs {
  /** Spot price of the underlying. */
  spot: number;
  strike: number;
  /** Time to expiry in years. Values <= 0 are treated as expired. */
  timeYears: number;
  /** Annualised volatility as a decimal (0.25 = 25 vol). */
  vol: number;
  /** Continuously compounded risk-free rate. */
  rate: number;
  /** Continuous dividend yield. */
  dividendYield: number;
  right: OptionRight;
}

export interface Greeks {
  price: number;
  /** dV/dS, per 1.00 move in the underlying. */
  delta: number;
  /** d2V/dS2. */
  gamma: number;
  /** dV/dSigma per 1.00 of vol (divide by 100 for "per vol point"). */
  vega: number;
  /** dV/dt per year (negative for long premium). */
  theta: number;
  /** dV/dr per 1.00 of rate. */
  rho: number;
  /** Risk-neutral probability of finishing in the money. */
  probItm: number;
}

const MIN_VOL = 1e-6;
const MIN_TIME = 1e-8;

function intrinsic(spot: number, strike: number, right: OptionRight): number {
  return right === 'CALL' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

export function d1d2(i: BsmInputs): { d1: number; d2: number; sqrtT: number } {
  const sqrtT = Math.sqrt(i.timeYears);
  const d1 =
    (Math.log(i.spot / i.strike) + (i.rate - i.dividendYield + 0.5 * i.vol * i.vol) * i.timeYears) /
    (i.vol * sqrtT);
  return { d1, d2: d1 - i.vol * sqrtT, sqrtT };
}

export function bsmPrice(i: BsmInputs): number {
  if (i.timeYears <= MIN_TIME || i.vol <= MIN_VOL) return intrinsic(i.spot, i.strike, i.right);
  const { d1, d2 } = d1d2(i);
  const dfQ = Math.exp(-i.dividendYield * i.timeYears);
  const dfR = Math.exp(-i.rate * i.timeYears);
  return i.right === 'CALL'
    ? i.spot * dfQ * normCdf(d1) - i.strike * dfR * normCdf(d2)
    : i.strike * dfR * normCdf(-d2) - i.spot * dfQ * normCdf(-d1);
}

export function bsmGreeks(i: BsmInputs): Greeks {
  if (i.timeYears <= MIN_TIME || i.vol <= MIN_VOL) {
    const itm = i.right === 'CALL' ? i.spot > i.strike : i.spot < i.strike;
    return {
      price: intrinsic(i.spot, i.strike, i.right),
      delta: itm ? (i.right === 'CALL' ? 1 : -1) : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      probItm: itm ? 1 : 0,
    };
  }

  const { d1, d2, sqrtT } = d1d2(i);
  const dfQ = Math.exp(-i.dividendYield * i.timeYears);
  const dfR = Math.exp(-i.rate * i.timeYears);
  const pdfD1 = normPdf(d1);

  const gamma = (dfQ * pdfD1) / (i.spot * i.vol * sqrtT);
  const vega = i.spot * dfQ * pdfD1 * sqrtT;
  const carry = -(i.spot * dfQ * pdfD1 * i.vol) / (2 * sqrtT);

  if (i.right === 'CALL') {
    return {
      price: i.spot * dfQ * normCdf(d1) - i.strike * dfR * normCdf(d2),
      delta: dfQ * normCdf(d1),
      gamma,
      vega,
      theta: carry - i.rate * i.strike * dfR * normCdf(d2) + i.dividendYield * i.spot * dfQ * normCdf(d1),
      rho: i.strike * i.timeYears * dfR * normCdf(d2),
      probItm: normCdf(d2),
    };
  }

  return {
    price: i.strike * dfR * normCdf(-d2) - i.spot * dfQ * normCdf(-d1),
    delta: -dfQ * normCdf(-d1),
    gamma,
    vega,
    theta: carry + i.rate * i.strike * dfR * normCdf(-d2) - i.dividendYield * i.spot * dfQ * normCdf(-d1),
    rho: -i.strike * i.timeYears * dfR * normCdf(-d2),
    probItm: normCdf(-d2),
  };
}

/**
 * Implied volatility from a market price.
 *
 * Newton-Raphson seeded with the Brenner-Subrahmanyam ATM approximation, with a
 * bisection fallback for the wings where vega collapses and Newton stalls.
 * Returns `null` when the price is outside the no-arbitrage bounds.
 */
export function impliedVol(
  targetPrice: number,
  i: Omit<BsmInputs, 'vol'>,
  opts: { tolerance?: number; maxIterations?: number } = {},
): number | null {
  const tolerance = opts.tolerance ?? 1e-8;
  const maxIterations = opts.maxIterations ?? 100;
  if (i.timeYears <= MIN_TIME) return null;

  const dfQ = Math.exp(-i.dividendYield * i.timeYears);
  const dfR = Math.exp(-i.rate * i.timeYears);
  const lower = i.right === 'CALL'
    ? Math.max(0, i.spot * dfQ - i.strike * dfR)
    : Math.max(0, i.strike * dfR - i.spot * dfQ);
  const upper = i.right === 'CALL' ? i.spot * dfQ : i.strike * dfR;
  if (targetPrice < lower - 1e-10 || targetPrice > upper + 1e-10) return null;

  // Brenner-Subrahmanyam: sigma ~ sqrt(2*pi/T) * price / spot.
  let vol = clamp(Math.sqrt((2 * Math.PI) / i.timeYears) * (targetPrice / i.spot), 0.01, 3);

  for (let n = 0; n < maxIterations; n++) {
    const g = bsmGreeks({ ...i, vol });
    const diff = g.price - targetPrice;
    if (Math.abs(diff) < tolerance) return vol;
    if (g.vega < 1e-10) break;
    const next = vol - diff / g.vega;
    if (!Number.isFinite(next) || next <= 0 || next > 10) break;
    if (Math.abs(next - vol) < 1e-12) return next;
    vol = next;
  }

  // Bisection fallback.
  let lo = 1e-4;
  let hi = 8;
  if (bsmPrice({ ...i, vol: hi }) < targetPrice) return null;
  for (let n = 0; n < 200; n++) {
    const mid = 0.5 * (lo + hi);
    const price = bsmPrice({ ...i, vol: mid });
    if (Math.abs(price - targetPrice) < tolerance) return mid;
    if (price < targetPrice) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Forward price of the underlying. */
export function forwardPrice(spot: number, rate: number, dividendYield: number, timeYears: number): number {
  return spot * Math.exp((rate - dividendYield) * timeYears);
}

/** Strike for a target BSM call-equivalent delta. Useful for "give me the 25-delta put". */
export function strikeForDelta(
  targetAbsDelta: number,
  right: OptionRight,
  spot: number,
  timeYears: number,
  vol: number,
  rate: number,
  dividendYield: number,
): number {
  // Invert delta = e^{-qT} N(d1) analytically.
  const dfQ = Math.exp(-dividendYield * timeYears);
  const p = clamp(targetAbsDelta / dfQ, 1e-6, 1 - 1e-6);
  const d1 = right === 'CALL' ? normInv(p) : -normInv(p);
  const sqrtT = Math.sqrt(Math.max(timeYears, MIN_TIME));
  return spot * Math.exp(-(d1 * vol * sqrtT) + (rate - dividendYield + 0.5 * vol * vol) * timeYears);
}
