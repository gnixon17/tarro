/**
 * Per-ticker analysis: payoff ladders, hedge coverage, breakevens.
 *
 * This is what backs the "show me every hedge on NVDA and what it actually
 * does" view.
 */
import { clamp } from '../math/gaussian';
import {
  atmVol,
  instrumentAtmVolShock,
  marketAtmVolShock,
  surfaceParamsFor,
} from '../options/surface';
import {
  buildMarketState,
  captureAnchors,
  daysToExpiry,
  valuePortfolio,
  type MarketState,
  type PortfolioValuation,
} from './valuation';
import type { Instrument, OptionPosition, PortfolioStore, Position } from '../types';

export interface LadderOptions {
  /** Lower bound of the sweep, in percent from spot. */
  fromPct?: number;
  upToPct?: number;
  steps?: number;
  /** Calendar days forward for the valuation date. */
  daysForward?: number;
  /**
   * Whether a move in this ticker drags its own IV with it. On for the "today"
   * line, irrelevant at expiry where everything is intrinsic.
   */
  applyVolShock?: boolean;
  /** Restrict to these accounts. Empty or omitted means all. */
  accountIds?: string[];
}

export interface LadderPoint {
  price: number;
  movePct: number;
  /** Total value of this ticker's positions at that price. */
  value: number;
  /** Change from today's value. */
  pnl: number;
  /** What the shares alone would have done. */
  sharesOnlyPnl: number;
  iv30?: number;
  deltaShares: number;
}

function positionsForSymbol(store: PortfolioStore, symbol: string, accountIds?: string[]): Position[] {
  const set = accountIds && accountIds.length ? new Set(accountIds) : null;
  return store.positions.filter((p) => p.symbol === symbol && (!set || set.has(p.accountId)));
}

/**
 * Value a single ticker's book across a range of prices.
 *
 * The rest of the portfolio is ignored on purpose - this is the single-name
 * view, and mixing in correlated names would blur exactly what the reader came
 * to see.
 */
export function underlyingLadder(
  store: PortfolioStore,
  symbol: string,
  opts: LadderOptions = {},
): LadderPoint[] {
  const instrument = store.instruments.find((i) => i.symbol === symbol);
  if (!instrument) return [];

  const fromPct = opts.fromPct ?? -50;
  const upToPct = opts.upToPct ?? 50;
  const steps = clamp(Math.round(opts.steps ?? 81), 3, 401);
  const daysForward = opts.daysForward ?? 0;
  const applyVolShock = opts.applyVolShock ?? true;

  const positions = positionsForSymbol(store, symbol, opts.accountIds);
  const accounts = store.accounts.filter((a) => positions.some((p) => p.accountId === a.id));
  const cashlessAccounts = accounts.map((a) => ({ ...a, cash: 0 }));

  const asOf = new Date();
  const instrumentMap: Record<string, Instrument> = Object.fromEntries(
    store.instruments.map((i) => [i.symbol, i]),
  );
  const anchors = captureAnchors(positions, instrumentMap, store.settings, asOf);
  const opts2 = { anchors, betaWeightSymbol: store.settings.betaWeightSymbol };

  const baseState = buildMarketState(store, { asOf });
  const baseValue = valuePortfolio(positions, cashlessAccounts, baseState, opts2).total.marketValue;
  const shares = positions.reduce((sum, p) => (p.kind === 'EQUITY' ? sum + p.quantity : sum), 0);

  const volModel = store.settings.volModel;
  const params = surfaceParamsFor(instrument, volModel);
  // Use the real market proxy's vol level here so the ladder and the scenario
  // engine put the same IV on the same contract for the same move.
  const marketIv30 = store.instruments.find((i) => i.symbol === store.settings.marketSymbol)?.ivAtm30
    ?? instrument.ivAtm30;
  const horizon = new Date(asOf.getTime() + daysForward * 86400000);

  const out: LadderPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const movePct = fromPct + ((upToPct - fromPct) * i) / (steps - 1);
    const price = Math.max(0.01, instrument.price * (1 + movePct / 100));

    // A single-name move drags its own vol: treat the move as if it came
    // through the market factor, so the same model is used everywhere.
    const impliedMarketReturn = instrument.beta !== 0 ? movePct / 100 / instrument.beta : movePct / 100;
    const marketVolShock = marketAtmVolShock(impliedMarketReturn, volModel);
    const atmShift = applyVolShock
      ? instrumentAtmVolShock(instrument, marketVolShock, marketIv30, volModel)
      : 0;

    const state: MarketState = {
      prices: { ...baseState.prices, [symbol]: price },
      atmShifts: { [symbol]: atmShift },
      moneynessSpots: {
        ...baseState.moneynessSpots,
        [symbol]: volModel.stickiness === 'STICKY_MONEYNESS' ? price : instrument.price,
      },
      rate: store.settings.riskFreeRate,
      asOf: horizon,
      instruments: instrumentMap,
      volModel,
    };

    const valuation = valuePortfolio(positions, cashlessAccounts, state, opts2);
    out.push({
      price,
      movePct,
      value: valuation.total.marketValue,
      pnl: valuation.total.marketValue - baseValue,
      sharesOnlyPnl: shares * (price - instrument.price),
      iv30: atmVol(params, 30 / 365, atmShift),
      deltaShares: valuation.total.deltaShares,
    });
  }
  return out;
}

/** The latest expiry among a ticker's option legs, or null if there are none. */
export function lastExpiry(positions: Position[]): string | null {
  const expiries = positions
    .filter((p): p is OptionPosition => p.kind === 'OPTION')
    .map((p) => p.expiry)
    .sort();
  return expiries.length ? expiries[expiries.length - 1] : null;
}

export function nearestExpiry(positions: Position[]): string | null {
  const expiries = positions
    .filter((p): p is OptionPosition => p.kind === 'OPTION')
    .map((p) => p.expiry)
    .sort();
  return expiries.length ? expiries[0] : null;
}

export interface HedgeSummary {
  symbol: string;
  spot: number;
  shares: number;
  shareNotional: number;
  /** Net share-equivalent delta including every option leg. */
  netDeltaShares: number;
  /** netDeltaShares / shares - 1, i.e. how much exposure the options strip out. */
  hedgeRatio: number;
  /** Net premium: negative when the structure cost money. */
  netOptionValue: number;
  optionCount: number;
  putContracts: number;
  callContracts: number;
  /** Sum of long put notional: strike * contracts * multiplier. */
  protectedNotional: number;
  /** protectedNotional / shareNotional. 1.0 = fully covered by long puts. */
  coverageRatio: number;
  /** Lowest P&L reachable in the ladder, and where. */
  worstCase: { movePct: number; pnl: number } | null;
  /** P&L floor relative to an unhedged book at the same point. */
  worstCaseUnhedged: number | null;
  /** Prices where the expiry payoff crosses zero. */
  breakevens: number[];
  /** Expiry used for the payoff line. */
  payoffExpiry: string | null;
  vegaDollars: number;
  thetaDollars: number;
}

export function hedgeSummary(
  store: PortfolioStore,
  symbol: string,
  valuation: PortfolioValuation,
  expiryLadder: LadderPoint[],
): HedgeSummary | null {
  const instrument = store.instruments.find((i) => i.symbol === symbol);
  if (!instrument) return null;

  const positions = positionsForSymbol(store, symbol);
  const rollup = valuation.bySymbol[symbol];
  const shares = positions.reduce((sum, p) => (p.kind === 'EQUITY' ? sum + p.quantity : sum), 0);
  const options = positions.filter((p): p is OptionPosition => p.kind === 'OPTION');

  const longPuts = options.filter((o) => o.right === 'PUT' && o.quantity > 0);
  const protectedNotional = longPuts.reduce((sum, o) => sum + o.strike * o.quantity * o.multiplier, 0);
  const shareNotional = shares * instrument.price;

  const netOptionValue = options.reduce((sum, o) => {
    const v = valuation.byPosition[o.id];
    return sum + (v?.marketValue ?? 0);
  }, 0);

  const worst = expiryLadder.reduce<LadderPoint | null>(
    (acc, p) => (acc === null || p.pnl < acc.pnl ? p : acc),
    null,
  );

  return {
    symbol,
    spot: instrument.price,
    shares,
    shareNotional,
    netDeltaShares: rollup?.deltaShares ?? 0,
    hedgeRatio: shares !== 0 ? (rollup?.deltaShares ?? 0) / shares - 1 : 0,
    netOptionValue,
    optionCount: options.length,
    putContracts: options.filter((o) => o.right === 'PUT').reduce((s, o) => s + o.quantity, 0),
    callContracts: options.filter((o) => o.right === 'CALL').reduce((s, o) => s + o.quantity, 0),
    protectedNotional,
    coverageRatio: shareNotional !== 0 ? protectedNotional / shareNotional : 0,
    worstCase: worst ? { movePct: worst.movePct, pnl: worst.pnl } : null,
    worstCaseUnhedged: worst ? worst.sharesOnlyPnl : null,
    breakevens: findBreakevens(expiryLadder),
    payoffExpiry: lastExpiry(positions),
    vegaDollars: rollup?.vegaDollars ?? 0,
    thetaDollars: rollup?.thetaDollars ?? 0,
  };
}

/** Linear interpolation of zero crossings in a payoff ladder. */
export function findBreakevens(ladder: LadderPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1];
    const b = ladder[i];
    if (a.pnl === 0) out.push(a.price);
    else if ((a.pnl < 0 && b.pnl > 0) || (a.pnl > 0 && b.pnl < 0)) {
      const t = -a.pnl / (b.pnl - a.pnl);
      out.push(a.price + t * (b.price - a.price));
    }
  }
  return out;
}

/** Days until each option leg expires, for the expiry ladder. */
export function daysUntilLastExpiry(positions: Position[], asOf = new Date()): number {
  const expiry = lastExpiry(positions);
  return expiry ? Math.max(0, Math.ceil(daysToExpiry(expiry, asOf))) : 0;
}
