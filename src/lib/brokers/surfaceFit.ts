/**
 * Calibrate a ticker's vol surface to a real option chain.
 *
 * Tarro's surface is
 *
 *   IV(K, T) = atm(T) + skewSlope · m + skewCurvature · m²
 *   atm(T)   = ivAtm30 + termSlope · ln(T_days / 30)
 *   m        = ln(K / F) / √T
 *
 * so the fit is two ordinary least squares problems: a quadratic in `m` per
 * expiry for the smile, then a line in `ln(days/30)` across expiries for the
 * term structure. No optimiser needed, and the residual is reported in vol
 * points so the parameters can be judged rather than trusted.
 */
import { forwardPrice } from '../math/blackScholes';
import { clamp } from '../math/gaussian';
import type { ChainContract } from './schwabMap';

export interface SmileFit {
  expiry: string;
  timeYears: number;
  atm: number;
  skewSlope: number;
  skewCurvature: number;
  rmseVolPoints: number;
  samples: number;
}

export interface SurfaceFit {
  ivAtm30: number;
  skewSlope: number;
  skewCurvature: number;
  termSlope: number;
  rmseVolPoints: number;
  samples: number;
  expiries: number;
  perExpiry: SmileFit[];
}

/**
 * Solve a small symmetric normal-equation system by Gaussian elimination with
 * partial pivoting. Returns null for a singular system rather than NaNs.
 */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / a[i][i]);
}

/** Weighted least squares on the basis [1, m, m²]. */
function fitQuadratic(points: { m: number; iv: number; weight: number }[]): { c: number[]; rmse: number } | null {
  if (points.length < 3) return null;

  const basis = (m: number) => [1, m, m * m];
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];

  for (const p of points) {
    const b = basis(p.m);
    for (let i = 0; i < 3; i++) {
      rhs[i] += p.weight * b[i] * p.iv;
      for (let j = 0; j < 3; j++) matrix[i][j] += p.weight * b[i] * b[j];
    }
  }

  const c = solve(matrix, rhs);
  if (!c || c.some((v) => !Number.isFinite(v))) return null;

  let sse = 0;
  let weightSum = 0;
  for (const p of points) {
    const predicted = c[0] + c[1] * p.m + c[2] * p.m * p.m;
    sse += p.weight * (predicted - p.iv) ** 2;
    weightSum += p.weight;
  }
  return { c, rmse: Math.sqrt(sse / Math.max(weightSum, 1e-9)) };
}

export interface FitOptions {
  spot: number;
  rate: number;
  dividendYield: number;
  /** Ignore strikes further than this in standardised moneyness. */
  moneynessLimit?: number;
  /** Ignore contracts with less open interest than this. */
  minOpenInterest?: number;
}

/**
 * Fit one expiry's smile.
 *
 * Only out-of-the-money contracts are used, and each is weighted by how close
 * it is to the money. That is the market convention for a reason: OTM options
 * are where the liquidity is, and a deep-ITM contract is all intrinsic, so its
 * quoted IV is noise divided by a vega near zero.
 */
export function fitSmile(contracts: ChainContract[], opts: FitOptions): SmileFit | null {
  if (contracts.length === 0) return null;

  const timeYears = contracts[0].timeYears;
  const expiry = contracts[0].expiry;
  const forward = forwardPrice(opts.spot, opts.rate, opts.dividendYield, Math.max(timeYears, 1 / 365));
  const limit = opts.moneynessLimit ?? 1.5;
  const minOi = opts.minOpenInterest ?? 0;

  const points = contracts
    .filter((c) => c.iv !== null && c.iv > 0 && c.strike > 0)
    .filter((c) => (c.openInterest ?? 0) >= minOi)
    // Out-of-the-money only: puts below the forward, calls above it.
    .filter((c) => (c.right === 'PUT' ? c.strike <= forward : c.strike >= forward))
    .map((c) => {
      const m = Math.log(c.strike / forward) / Math.sqrt(Math.max(timeYears, 1 / 365));
      return { m, iv: c.iv!, weight: Math.exp(-0.5 * m * m) };
    })
    .filter((p) => Number.isFinite(p.m) && Math.abs(p.m) <= limit);

  const fit = fitQuadratic(points);
  if (!fit) return null;

  return {
    expiry,
    timeYears,
    atm: fit.c[0],
    skewSlope: fit.c[1],
    skewCurvature: fit.c[2],
    rmseVolPoints: fit.rmse * 100,
    samples: points.length,
  };
}

const DAYS_PER_YEAR = 365;

/**
 * Fit the whole surface from a chain.
 *
 * Returns null when the chain cannot support a fit — too few expiries, too few
 * quoted strikes — rather than returning parameters nobody should trust.
 */
export function fitSurface(contracts: ChainContract[], opts: FitOptions): SurfaceFit | null {
  const byExpiry = new Map<string, ChainContract[]>();
  for (const c of contracts) {
    if (!byExpiry.has(c.expiry)) byExpiry.set(c.expiry, []);
    byExpiry.get(c.expiry)!.push(c);
  }

  const perExpiry = [...byExpiry.values()]
    .map((group) => fitSmile(group, opts))
    .filter((f): f is SmileFit => f !== null && Number.isFinite(f.atm) && f.atm > 0.01 && f.atm < 5)
    .sort((a, b) => a.timeYears - b.timeYears);

  if (perExpiry.length === 0) return null;

  // Skew and curvature are already normalised by √T, so they should be roughly
  // tenor-independent; average them, weighted by how well each expiry fit.
  const weights = perExpiry.map((f) => f.samples / (1 + f.rmseVolPoints));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const skewSlope = perExpiry.reduce((sum, f, i) => sum + f.skewSlope * weights[i], 0) / weightSum;
  const skewCurvature = perExpiry.reduce((sum, f, i) => sum + f.skewCurvature * weights[i], 0) / weightSum;

  // Term structure: atm = ivAtm30 + termSlope · ln(days/30).
  let ivAtm30: number;
  let termSlope: number;

  if (perExpiry.length === 1) {
    // One expiry cannot say anything about the slope. Keep it flat and pin the
    // level at the tenor we actually observed.
    ivAtm30 = perExpiry[0].atm;
    termSlope = 0;
  } else {
    const xs = perExpiry.map((f) => Math.log((f.timeYears * DAYS_PER_YEAR) / 30));
    const ys = perExpiry.map((f) => f.atm);
    const w = weights;
    const sw = w.reduce((a, b) => a + b, 0);
    const meanX = xs.reduce((s, x, i) => s + x * w[i], 0) / sw;
    const meanY = ys.reduce((s, y, i) => s + y * w[i], 0) / sw;
    const cov = xs.reduce((s, x, i) => s + w[i] * (x - meanX) * (ys[i] - meanY), 0);
    const varX = xs.reduce((s, x, i) => s + w[i] * (x - meanX) ** 2, 0);
    termSlope = varX > 1e-9 ? cov / varX : 0;
    ivAtm30 = meanY - termSlope * meanX;
  }

  const samples = perExpiry.reduce((s, f) => s + f.samples, 0);
  const rmseVolPoints =
    perExpiry.reduce((s, f) => s + f.rmseVolPoints * f.samples, 0) / Math.max(samples, 1);

  return {
    // Clamp to the same band the pricing surface enforces, so a pathological
    // chain cannot write parameters the engine will silently clip later.
    ivAtm30: clamp(ivAtm30, 0.02, 3),
    skewSlope: clamp(skewSlope, -1, 1),
    skewCurvature: clamp(skewCurvature, -1, 1),
    termSlope: clamp(termSlope, -0.5, 0.5),
    rmseVolPoints,
    samples,
    expiries: perExpiry.length,
    perExpiry,
  };
}
