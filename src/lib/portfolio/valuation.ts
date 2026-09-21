/**
 * Marking positions and rolling them up.
 *
 * Everything downstream - the dashboard, the per-ticker hedge view, the
 * scenario engine - goes through `valuePortfolio`, so there is exactly one
 * definition of what a position is worth and what its greeks are.
 */
import { bsmGreeks, impliedVol } from '../math/blackScholes';
import {
  DAYS_PER_YEAR,
  anchorOffset,
  surfaceParamsFor,
  surfaceVol,
  termResponseFactor,
  type SurfaceContext,
} from '../options/surface';
import type {
  Account,
  Instrument,
  OptionPosition,
  Position,
  PortfolioStore,
  Settings,
  VolModelParams,
} from '../types';

export interface MarketState {
  /** Underlying marks, keyed by symbol. */
  prices: Record<string, number>;
  /**
   * Additive ATM vol shift per symbol, in vol decimals, quoted at the 30-day
   * tenor. Scaled per-contract by `termResponseFactor` so short-dated IV reacts
   * harder than long-dated IV.
   */
  atmShifts: Record<string, number>;
  /**
   * Additive vol shift per symbol applied literally at every tenor. This is
   * where an explicit user override ("+10 vol on TSLA") lands, so what the user
   * typed is what the surface gets.
   */
  atmShiftsFlat?: Record<string, number>;
  /** Multiplier applied to the final IV per symbol. 1.0 is a no-op. */
  ivMultipliers?: Record<string, number>;
  /**
   * Spot used for moneyness per symbol. Equals `prices` under sticky-moneyness
   * and the pre-shock spot under sticky-strike.
   */
  moneynessSpots: Record<string, number>;
  rate: number;
  /** Valuation date. */
  asOf: Date;
  instruments: Record<string, Instrument>;
  volModel: VolModelParams;
}

export interface PositionValuation {
  positionId: string;
  symbol: string;
  accountId: string;
  groupId?: string | null;
  kind: Position['kind'];
  /** Shares, or contracts for options. */
  quantity: number;
  /** Share-equivalent exposure (contracts * multiplier for options). */
  shareEquivalent: number;
  /** Per-share mark. */
  unitPrice: number;
  /** Total market value in dollars, signed. */
  marketValue: number;
  /** Cost basis in dollars, signed the same way as marketValue. */
  costValue: number;
  unrealizedPnl: number;
  /** Implied vol used for this mark. */
  iv?: number;
  /** Years to expiry at valuation time. */
  timeYears?: number;
  /** Share-equivalent delta: 100 means "behaves like 100 shares". */
  deltaShares: number;
  /** Dollar delta: deltaShares * spot. */
  deltaDollars: number;
  /** Change in dollar delta per 1% move in the underlying. */
  gammaDollarsPer1Pct: number;
  /** Dollars gained per 1 vol point increase in IV. */
  vegaDollars: number;
  /** Dollars per calendar day of decay. */
  thetaDollars: number;
  /** Dollars per 1bp parallel rate move. */
  rhoDollars: number;
  /** Beta-weighted dollar delta against the market proxy. */
  betaWeightedDeltaDollars: number;
  expired?: boolean;
}

export interface Rollup {
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  deltaDollars: number;
  betaWeightedDeltaDollars: number;
  gammaDollarsPer1Pct: number;
  vegaDollars: number;
  thetaDollars: number;
  rhoDollars: number;
  /** Long share-equivalent exposure, net of options delta, in shares. */
  deltaShares: number;
}

export interface PortfolioValuation {
  positions: PositionValuation[];
  byPosition: Record<string, PositionValuation>;
  bySymbol: Record<string, Rollup & { symbol: string; spot: number; positionIds: string[] }>;
  byAccount: Record<string, Rollup & { accountId: string; cash: number }>;
  byGroup: Record<string, Rollup & { groupId: string }>;
  total: Rollup & { cash: number; netLiquidation: number };
}

export function emptyRollup(): Rollup {
  return {
    marketValue: 0,
    costValue: 0,
    unrealizedPnl: 0,
    deltaDollars: 0,
    betaWeightedDeltaDollars: 0,
    gammaDollarsPer1Pct: 0,
    vegaDollars: 0,
    thetaDollars: 0,
    rhoDollars: 0,
    deltaShares: 0,
  };
}

function addToRollup(target: Rollup, v: PositionValuation): void {
  target.marketValue += v.marketValue;
  target.costValue += v.costValue;
  target.unrealizedPnl += v.unrealizedPnl;
  target.deltaDollars += v.deltaDollars;
  target.betaWeightedDeltaDollars += v.betaWeightedDeltaDollars;
  target.gammaDollarsPer1Pct += v.gammaDollarsPer1Pct;
  target.vegaDollars += v.vegaDollars;
  target.thetaDollars += v.thetaDollars;
  target.rhoDollars += v.rhoDollars;
  target.deltaShares += v.deltaShares;
}

/** Years to expiry, floored at zero. Options are assumed to expire end-of-day. */
export function yearsToExpiry(expiry: string, asOf: Date): number {
  const expiryMs = Date.parse(`${expiry}T20:00:00Z`);
  if (!Number.isFinite(expiryMs)) return 0;
  return Math.max(0, (expiryMs - asOf.getTime()) / (86400000 * DAYS_PER_YEAR));
}

export function daysToExpiry(expiry: string, asOf: Date): number {
  return yearsToExpiry(expiry, asOf) * DAYS_PER_YEAR;
}

export function buildMarketState(
  store: Pick<PortfolioStore, 'instruments' | 'settings'>,
  overrides: Partial<MarketState> = {},
): MarketState {
  const instruments: Record<string, Instrument> = {};
  const prices: Record<string, number> = {};
  for (const inst of store.instruments) {
    instruments[inst.symbol] = inst;
    prices[inst.symbol] = inst.price;
  }
  return {
    prices,
    atmShifts: {},
    moneynessSpots: { ...prices },
    rate: store.settings.riskFreeRate,
    asOf: new Date(),
    instruments,
    volModel: store.settings.volModel,
    ...overrides,
  };
}

/**
 * The implied vol this contract is marked at *today*, before any shock.
 *
 * Priority: an explicit `markIv`, then an IV backed out of `markPrice`, then
 * the model surface. The returned `anchor` is the gap between that mark and the
 * surface; the scenario engine carries it forward so a user's own mark is never
 * thrown away.
 */
export function resolveBaseIv(
  option: OptionPosition,
  instrument: Instrument,
  settings: Settings,
  asOf: Date,
): { iv: number; anchor: number } {
  const params = surfaceParamsFor(instrument, settings.volModel);
  const t = yearsToExpiry(option.expiry, asOf);
  const ctx: SurfaceContext = {
    spot: instrument.price,
    rate: settings.riskFreeRate,
    dividendYield: instrument.dividendYield,
  };
  const modelIv = surfaceVol(params, option.strike, t, ctx);

  let markIv = option.markIv;
  if (markIv === undefined && option.markPrice !== undefined && t > 0) {
    const solved = impliedVol(option.markPrice, {
      spot: instrument.price,
      strike: option.strike,
      timeYears: t,
      rate: settings.riskFreeRate,
      dividendYield: instrument.dividendYield,
      right: option.right,
    });
    if (solved !== null) markIv = solved;
  }

  if (markIv === undefined) return { iv: modelIv, anchor: 0 };
  return { iv: markIv, anchor: anchorOffset(markIv, params, option.strike, t, ctx) };
}

export interface ValuationOptions {
  /** Anchors captured at t0, keyed by position id. */
  anchors?: Record<string, number>;
  /** Symbol whose beta is 1.0 for beta-weighting. */
  betaWeightSymbol?: string;
}

export function valuePosition(
  position: Position,
  state: MarketState,
  opts: ValuationOptions = {},
): PositionValuation | null {
  const instrument = state.instruments[position.symbol];
  if (!instrument) return null;

  const spot = state.prices[position.symbol] ?? instrument.price;
  const betaWeightSpot = opts.betaWeightSymbol
    ? state.prices[opts.betaWeightSymbol] ?? state.instruments[opts.betaWeightSymbol]?.price ?? 0
    : 0;

  const base = {
    positionId: position.id,
    symbol: position.symbol,
    accountId: position.accountId,
    groupId: position.groupId ?? null,
  };

  if (position.kind === 'EQUITY') {
    const marketValue = position.quantity * spot;
    const costValue = position.quantity * position.costBasis;
    const deltaDollars = position.quantity * spot;
    return {
      ...base,
      kind: 'EQUITY',
      quantity: position.quantity,
      shareEquivalent: position.quantity,
      unitPrice: spot,
      marketValue,
      costValue,
      unrealizedPnl: marketValue - costValue,
      deltaShares: position.quantity,
      deltaDollars,
      gammaDollarsPer1Pct: 0,
      vegaDollars: 0,
      thetaDollars: 0,
      rhoDollars: 0,
      betaWeightedDeltaDollars: deltaDollars * instrument.beta,
    };
  }

  const shares = position.quantity * position.multiplier;
  const t = yearsToExpiry(position.expiry, state.asOf);
  const params = surfaceParamsFor(instrument, state.volModel);
  const ctx: SurfaceContext = {
    spot,
    rate: state.rate,
    dividendYield: instrument.dividendYield,
    atmShift:
      (state.atmShifts[position.symbol] ?? 0) * termResponseFactor(t, state.volModel) +
      (state.atmShiftsFlat?.[position.symbol] ?? 0),
    moneynessSpot: state.moneynessSpots[position.symbol] ?? spot,
  };
  const anchor = opts.anchors?.[position.id] ?? 0;
  const ivMultiplier = state.ivMultipliers?.[position.symbol] ?? 1;
  const iv = Math.max(
    state.volModel.minVol,
    Math.min(state.volModel.maxVol, (surfaceVol(params, position.strike, t, ctx) + anchor) * ivMultiplier),
  );

  const g = bsmGreeks({
    spot,
    strike: position.strike,
    timeYears: t,
    vol: iv,
    rate: state.rate,
    dividendYield: instrument.dividendYield,
    right: position.right,
  });

  const marketValue = g.price * shares;
  const costValue = position.costBasis * shares;
  const deltaShares = g.delta * shares;
  const deltaDollars = deltaShares * spot;

  return {
    ...base,
    kind: 'OPTION',
    quantity: position.quantity,
    shareEquivalent: shares,
    unitPrice: g.price,
    marketValue,
    costValue,
    unrealizedPnl: marketValue - costValue,
    iv,
    timeYears: t,
    expired: t <= 0,
    deltaShares,
    deltaDollars,
    // Change in dollar delta for a 1% move: gamma * shares * spot * (1% of spot).
    gammaDollarsPer1Pct: g.gamma * shares * spot * spot * 0.01,
    vegaDollars: (g.vega * shares) / 100,
    thetaDollars: (g.theta * shares) / DAYS_PER_YEAR,
    rhoDollars: g.rho * shares * 0.0001,
    betaWeightedDeltaDollars: deltaDollars * instrument.beta,
  };
}

export function valuePortfolio(
  positions: Position[],
  accounts: Account[],
  state: MarketState,
  opts: ValuationOptions = {},
): PortfolioValuation {
  const valuations: PositionValuation[] = [];
  const byPosition: PortfolioValuation['byPosition'] = {};
  const bySymbol: PortfolioValuation['bySymbol'] = {};
  const byAccount: PortfolioValuation['byAccount'] = {};
  const byGroup: PortfolioValuation['byGroup'] = {};

  for (const account of accounts) {
    byAccount[account.id] = { ...emptyRollup(), accountId: account.id, cash: account.cash };
  }

  for (const position of positions) {
    const v = valuePosition(position, state, opts);
    if (!v) continue;
    valuations.push(v);
    byPosition[v.positionId] = v;

    if (!bySymbol[v.symbol]) {
      bySymbol[v.symbol] = {
        ...emptyRollup(),
        symbol: v.symbol,
        spot: state.prices[v.symbol] ?? state.instruments[v.symbol]?.price ?? 0,
        positionIds: [],
      };
    }
    addToRollup(bySymbol[v.symbol], v);
    bySymbol[v.symbol].positionIds.push(v.positionId);

    if (!byAccount[v.accountId]) {
      byAccount[v.accountId] = { ...emptyRollup(), accountId: v.accountId, cash: 0 };
    }
    addToRollup(byAccount[v.accountId], v);

    if (v.groupId) {
      if (!byGroup[v.groupId]) byGroup[v.groupId] = { ...emptyRollup(), groupId: v.groupId };
      addToRollup(byGroup[v.groupId], v);
    }
  }

  const total = { ...emptyRollup(), cash: 0, netLiquidation: 0 };
  for (const v of valuations) addToRollup(total, v);
  total.cash = accounts.reduce((sum, a) => sum + a.cash, 0);
  total.netLiquidation = total.marketValue + total.cash;

  return { positions: valuations, byPosition, bySymbol, byAccount, byGroup, total };
}

/** Capture t0 IV anchors for every option position. */
export function captureAnchors(
  positions: Position[],
  instruments: Record<string, Instrument>,
  settings: Settings,
  asOf: Date,
): Record<string, number> {
  const anchors: Record<string, number> = {};
  for (const p of positions) {
    if (p.kind !== 'OPTION') continue;
    const inst = instruments[p.symbol];
    if (!inst) continue;
    anchors[p.id] = resolveBaseIv(p, inst, settings, asOf).anchor;
  }
  return anchors;
}

/**
 * Beta-weighted delta expressed in shares of the market proxy.
 *
 * "How many SPY shares is this portfolio effectively long?" - the number people
 * actually hedge against.
 */
export function betaWeightedShares(rollup: Rollup, marketPrice: number): number {
  if (marketPrice <= 0) return 0;
  return rollup.betaWeightedDeltaDollars / marketPrice;
}
