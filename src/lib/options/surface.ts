/**
 * A small parametric implied-vol surface, plus the shock model that makes it
 * react to a move in the underlying.
 *
 * The surface is deliberately simple - three parameters per name - because the
 * point is not to fit a market surface exactly, it is to make a stress test
 * behave the way the option chain actually behaves: a 20% gap down lifts IV,
 * lifts it more on short-dated contracts, and lifts downside puts more than
 * upside calls.
 *
 *   IV(K, T) = atm(T) + skewSlope * m + skewCurvature * m^2
 *   atm(T)   = ivAtm30 + termSlope * ln(T_days / 30)
 *   m        = ln(K / F) / sqrt(T)        (standardised log-moneyness)
 *
 * `m` is normalised by sqrt(T) so the same skew parameters describe weeklies
 * and LEAPS: skew flattens with time, which is what is observed.
 */
import { clamp } from '../math/gaussian';
import { forwardPrice } from '../math/blackScholes';
import type { Instrument, VolModelParams } from '../types';

export const DAYS_PER_YEAR = 365;

export interface SurfaceContext {
  spot: number;
  rate: number;
  dividendYield: number;
  /** Additive shift applied to the whole ATM term structure, in vol decimals. */
  atmShift?: number;
  /**
   * Reference spot used to compute moneyness. Under sticky-strike this stays at
   * the pre-shock spot so the smile does not slide with the market.
   */
  moneynessSpot?: number;
}

export interface SurfaceParams {
  ivAtm30: number;
  skewSlope: number;
  skewCurvature: number;
  termSlope: number;
  minVol: number;
  maxVol: number;
}

export function surfaceParamsFor(instrument: Instrument, volModel: VolModelParams): SurfaceParams {
  return {
    ivAtm30: instrument.ivAtm30,
    skewSlope: instrument.skewSlope,
    skewCurvature: instrument.skewCurvature,
    termSlope: instrument.termSlope,
    minVol: volModel.minVol,
    maxVol: volModel.maxVol,
  };
}

/** At-the-money vol for a given tenor. */
export function atmVol(params: SurfaceParams, timeYears: number, atmShift = 0): number {
  const days = Math.max(timeYears * DAYS_PER_YEAR, 1);
  const raw = params.ivAtm30 + params.termSlope * Math.log(days / 30) + atmShift;
  return clamp(raw, params.minVol, params.maxVol);
}

/** Standardised log-moneyness for a strike. */
export function standardisedMoneyness(
  strike: number,
  spot: number,
  timeYears: number,
  rate: number,
  dividendYield: number,
): number {
  const t = Math.max(timeYears, 1 / DAYS_PER_YEAR);
  const fwd = forwardPrice(spot, rate, dividendYield, t);
  return Math.log(strike / fwd) / Math.sqrt(t);
}

/** Implied vol at a strike/tenor on this surface. */
export function surfaceVol(
  params: SurfaceParams,
  strike: number,
  timeYears: number,
  ctx: SurfaceContext,
): number {
  const t = Math.max(timeYears, 1 / DAYS_PER_YEAR);
  const refSpot = ctx.moneynessSpot ?? ctx.spot;
  const m = standardisedMoneyness(strike, refSpot, t, ctx.rate, ctx.dividendYield);
  const base = atmVol(params, t, ctx.atmShift ?? 0);
  // Cap the moneyness used for the smile so far-out wings stay finite.
  const mc = clamp(m, -1.5, 1.5);
  return clamp(base + params.skewSlope * mc + params.skewCurvature * mc * mc, params.minVol, params.maxVol);
}

/**
 * The market's ATM vol response to its own move.
 *
 * Returns a change in vol points (decimal), e.g. 0.06 = +6 vol.
 * Selloffs lift vol; rallies compress it, but by less (`upsideDamping`), and
 * large moves get a convex kick.
 */
export function marketAtmVolShock(marketReturn: number, volModel: VolModelParams): number {
  const magnitude = Math.abs(marketReturn);
  const convex = 1 + volModel.convexity * magnitude;
  const raw = -volModel.betaVolToSpot * marketReturn * convex;
  return marketReturn > 0 ? raw * volModel.upsideDamping : raw;
}

/**
 * Translate the market's ATM vol shock into a single name's ATM vol shock.
 *
 * A high-vol name gains more vol POINTS than the index in a selloff, but it
 * multiplies by less - the index starts lowest and so has the most room to
 * triple. Scaling by the raw vol ratio gets this badly wrong (it would send a
 * 55-vol name to 250 in a bad month); the fitted relationship is a damped
 * power of the ratio, with `volLevelExponent` around 0.3-0.5.
 */
export function instrumentAtmVolShock(
  instrument: Instrument,
  marketVolShock: number,
  marketIvAtm30: number,
  volModel: VolModelParams,
): number {
  const ratio = marketIvAtm30 > 1e-6 ? instrument.ivAtm30 / marketIvAtm30 : 1;
  const scaled = Math.pow(clamp(ratio, 0.05, 20), volModel.volLevelExponent);
  return instrument.volBeta * marketVolShock * clamp(scaled, 0.25, 4);
}

/**
 * Term-structure factor for a vol shock: short-dated IV reacts harder than
 * long-dated IV. Clamped so weeklies do not explode and LEAPS still move.
 */
export function termResponseFactor(timeYears: number, volModel: VolModelParams): number {
  const days = clamp(timeYears * DAYS_PER_YEAR, 1, 2000);
  return clamp(Math.pow(30 / days, volModel.termDecay), 0.3, 2.5);
}

/**
 * Anchor offset that reconciles a user's marked IV with the model surface.
 *
 * If the user marks their Jan-27 400 put at 31 vol and the surface says 28,
 * the +3 is carried through every scenario so their mark is never silently
 * overwritten while still responding to shocks.
 */
export function anchorOffset(
  markIv: number | undefined,
  params: SurfaceParams,
  strike: number,
  timeYears: number,
  ctx: SurfaceContext,
): number {
  if (markIv === undefined || !Number.isFinite(markIv) || markIv <= 0) return 0;
  return markIv - surfaceVol(params, strike, timeYears, ctx);
}
