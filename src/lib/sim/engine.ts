/**
 * Scenario engine.
 *
 * A scenario is a market move plus a horizon. Running it means:
 *
 *   1. mark everything as it stands today (and remember each contract's IV
 *      anchor so the user's own marks survive the shock);
 *   2. propagate the market move to every ticker through beta, with per-ticker
 *      overrides;
 *   3. move the vol surface - up on selloffs, harder on short-dated, harder on
 *      high-vol names, with the skew still attached;
 *   4. roll the clock forward and re-mark.
 *
 * The difference between the two marks is the answer.
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
  emptyRollup,
  valuePortfolio,
  type MarketState,
  type PortfolioValuation,
  type Rollup,
} from '../portfolio/valuation';
import type { Instrument, PortfolioStore, Position, Scenario, VolModelParams } from '../types';

export interface TickerOutcome {
  symbol: string;
  basePrice: number;
  newPrice: number;
  returnPct: number;
  /** Where the move came from, for the UI to explain itself. */
  source: 'MARKET_PROXY' | 'BETA' | 'OVERRIDE' | 'PINNED';
  betaUsed: number;
  baseIv30: number;
  newIv30: number;
  ivPointsChange: number;
}

export interface LineDelta extends Rollup {
  key: string;
  basePnl: number;
  baseMarketValue: number;
  shockedMarketValue: number;
  pnl: number;
}

export interface PositionOutcome {
  positionId: string;
  symbol: string;
  accountId: string;
  groupId?: string | null;
  kind: Position['kind'];
  quantity: number;
  baseValue: number;
  shockedValue: number;
  pnl: number;
  baseUnitPrice: number;
  shockedUnitPrice: number;
  baseIv?: number;
  shockedIv?: number;
  baseDeltaDollars: number;
  shockedDeltaDollars: number;
  expiresInHorizon: boolean;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  asOf: string;
  horizonDate: string;
  base: PortfolioValuation;
  shocked: PortfolioValuation;
  tickers: TickerOutcome[];
  positions: PositionOutcome[];
  bySymbol: LineDelta[];
  byAccount: LineDelta[];
  byGroup: LineDelta[];
  total: {
    baseNetLiquidation: number;
    shockedNetLiquidation: number;
    pnl: number;
    pnlPct: number;
    /** What the same move would have done with no options at all. */
    unhedgedPnl: number;
    unhedgedPnlPct: number;
    /** unhedgedPnl - pnl: dollars the hedges saved (positive) or cost. */
    hedgeContribution: number;
  };
  curve: { movePct: number; pnl: number; pnlPct: number; unhedgedPnl: number }[];
}

/** Merge a scenario's vol-model overrides over the global defaults. */
export function effectiveVolModel(base: VolModelParams, override?: Partial<VolModelParams>): VolModelParams {
  return { ...base, ...(override ?? {}) };
}

function activePositions(store: PortfolioStore, scenario: Scenario): Position[] {
  const ids = scenario.accountIds;
  if (!ids || ids.length === 0) return store.positions;
  const set = new Set(ids);
  return store.positions.filter((p) => set.has(p.accountId));
}

function activeAccounts(store: PortfolioStore, scenario: Scenario) {
  const ids = scenario.accountIds;
  if (!ids || ids.length === 0) return store.accounts;
  const set = new Set(ids);
  return store.accounts.filter((a) => set.has(a.id));
}

/** Resolve every ticker's price and vol response for a given market move. */
export function shockTickers(
  instruments: Instrument[],
  scenario: Scenario,
  marketSymbol: string,
  volModel: VolModelParams,
  marketMovePct: number,
): TickerOutcome[] {
  const marketReturn = marketMovePct / 100;
  const marketInstrument = instruments.find((i) => i.symbol === marketSymbol);
  const marketIv30 = marketInstrument?.ivAtm30 ?? 0.18;
  const marketVolShock = marketAtmVolShock(marketReturn, volModel);

  return instruments.map((inst) => {
    const shock = scenario.tickerShocks[inst.symbol];
    const betaUsed = shock?.beta ?? inst.beta;

    let ret: number;
    let source: TickerOutcome['source'];
    if (shock?.pinned) {
      ret = 0;
      source = 'PINNED';
    } else if (shock?.movePct !== undefined) {
      ret = shock.movePct / 100;
      source = 'OVERRIDE';
    } else if (inst.symbol === marketSymbol) {
      ret = marketReturn;
      source = 'MARKET_PROXY';
    } else {
      ret = betaUsed * marketReturn + (shock?.alphaPct ?? 0) / 100;
      source = 'BETA';
    }

    const newPrice = Math.max(0.01, inst.price * (1 + ret));

    // Vol response: the market's ATM move, scaled to this name, plus any
    // explicit override. Quoted at the 30-day tenor.
    const modelShift = shock?.pinned
      ? 0
      : instrumentAtmVolShock(inst, marketVolShock, marketIv30, volModel);
    const explicitShift = (shock?.ivPointsDelta ?? 0) / 100;
    const multiplier = shock?.ivMultiplier ?? 1;

    const params = surfaceParamsFor(inst, volModel);
    const baseIv30 = atmVol(params, 30 / 365, 0);
    const newIv30 = clamp(
      (atmVol(params, 30 / 365, modelShift) + explicitShift) * multiplier,
      volModel.minVol,
      volModel.maxVol,
    );

    return {
      symbol: inst.symbol,
      basePrice: inst.price,
      newPrice,
      returnPct: ret * 100,
      source,
      betaUsed,
      baseIv30,
      newIv30,
      ivPointsChange: (newIv30 - baseIv30) * 100,
    };
  });
}

/** Build the post-shock market state for a given market move. */
function shockedState(
  store: PortfolioStore,
  scenario: Scenario,
  volModel: VolModelParams,
  marketMovePct: number,
  asOf: Date,
): { state: MarketState; tickers: TickerOutcome[] } {
  const marketSymbol = store.settings.marketSymbol;
  const tickers = shockTickers(store.instruments, scenario, marketSymbol, volModel, marketMovePct);
  const marketReturn = marketMovePct / 100;
  const marketInstrument = store.instruments.find((i) => i.symbol === marketSymbol);
  const marketIv30 = marketInstrument?.ivAtm30 ?? 0.18;
  const marketVolShock = marketAtmVolShock(marketReturn, volModel);

  const prices: Record<string, number> = {};
  const atmShifts: Record<string, number> = {};
  const atmShiftsFlat: Record<string, number> = {};
  const ivMultipliers: Record<string, number> = {};
  const moneynessSpots: Record<string, number> = {};
  const instruments: Record<string, Instrument> = {};

  for (const inst of store.instruments) instruments[inst.symbol] = inst;

  for (const outcome of tickers) {
    const inst = instruments[outcome.symbol];
    const shock = scenario.tickerShocks[outcome.symbol];
    prices[outcome.symbol] = outcome.newPrice;
    atmShifts[outcome.symbol] = shock?.pinned
      ? 0
      : instrumentAtmVolShock(inst, marketVolShock, marketIv30, volModel);
    atmShiftsFlat[outcome.symbol] = (shock?.ivPointsDelta ?? 0) / 100;
    ivMultipliers[outcome.symbol] = shock?.ivMultiplier ?? 1;
    // Sticky moneyness: the smile travels with spot. Sticky strike: it stays
    // pinned to absolute strikes, so a selloff walks the portfolio down the
    // existing skew instead of re-centring it.
    moneynessSpots[outcome.symbol] =
      volModel.stickiness === 'STICKY_MONEYNESS' ? outcome.newPrice : inst.price;
  }

  const horizon = new Date(asOf.getTime() + scenario.daysForward * 86400000);

  return {
    tickers,
    state: {
      prices,
      atmShifts,
      atmShiftsFlat,
      ivMultipliers,
      moneynessSpots,
      rate: store.settings.riskFreeRate + scenario.rateShiftBps / 10000,
      asOf: horizon,
      instruments,
      volModel,
    },
  };
}

function toLineDeltas(
  base: Record<string, Rollup>,
  shocked: Record<string, Rollup>,
): LineDelta[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(shocked)]);
  return [...keys].map((key) => {
    const b = base[key] ?? emptyRollup();
    const s = shocked[key] ?? emptyRollup();
    return {
      ...s,
      key,
      basePnl: b.unrealizedPnl,
      baseMarketValue: b.marketValue,
      shockedMarketValue: s.marketValue,
      pnl: s.marketValue - b.marketValue,
    };
  });
}

/** Value the portfolio as if every option leg had been closed: shares only. */
function unhedgedPnlFor(positions: Position[], tickers: TickerOutcome[]): number {
  const moves: Record<string, number> = {};
  for (const t of tickers) moves[t.symbol] = t.newPrice - t.basePrice;
  let pnl = 0;
  for (const p of positions) {
    if (p.kind !== 'EQUITY') continue;
    pnl += p.quantity * (moves[p.symbol] ?? 0);
  }
  return pnl;
}

export function runScenario(store: PortfolioStore, scenario: Scenario, asOf = new Date()): ScenarioResult {
  const volModel = effectiveVolModel(store.settings.volModel, scenario.volModel);
  const positions = activePositions(store, scenario);
  const accounts = activeAccounts(store, scenario);
  const instrumentMap: Record<string, Instrument> = Object.fromEntries(
    store.instruments.map((i) => [i.symbol, i]),
  );

  const anchors = captureAnchors(positions, instrumentMap, store.settings, asOf);
  const opts = { anchors, betaWeightSymbol: store.settings.betaWeightSymbol };

  const baseState = buildMarketState(store, { asOf, volModel });
  const base = valuePortfolio(positions, accounts, baseState, opts);

  const { state, tickers } = shockedState(store, scenario, volModel, scenario.marketMovePct, asOf);
  const shocked = valuePortfolio(positions, accounts, state, opts);

  const positionOutcomes: PositionOutcome[] = positions.flatMap((p) => {
    const b = base.byPosition[p.id];
    const s = shocked.byPosition[p.id];
    if (!b || !s) return [];
    return [
      {
        positionId: p.id,
        symbol: p.symbol,
        accountId: p.accountId,
        groupId: p.groupId ?? null,
        kind: p.kind,
        quantity: p.quantity,
        baseValue: b.marketValue,
        shockedValue: s.marketValue,
        pnl: s.marketValue - b.marketValue,
        baseUnitPrice: b.unitPrice,
        shockedUnitPrice: s.unitPrice,
        baseIv: b.iv,
        shockedIv: s.iv,
        baseDeltaDollars: b.deltaDollars,
        shockedDeltaDollars: s.deltaDollars,
        expiresInHorizon: p.kind === 'OPTION' && (s.timeYears ?? 1) <= 0,
      },
    ];
  });

  const baseNet = base.total.netLiquidation;
  const shockedNet = shocked.total.netLiquidation;
  const pnl = shockedNet - baseNet;
  const unhedgedPnl = unhedgedPnlFor(positions, tickers);

  const curve = buildCurve(store, scenario, volModel, positions, accounts, opts, asOf, baseNet);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    asOf: asOf.toISOString(),
    horizonDate: state.asOf.toISOString(),
    base,
    shocked,
    tickers,
    positions: positionOutcomes,
    bySymbol: toLineDeltas(base.bySymbol, shocked.bySymbol),
    byAccount: toLineDeltas(base.byAccount, shocked.byAccount),
    byGroup: toLineDeltas(base.byGroup, shocked.byGroup),
    total: {
      baseNetLiquidation: baseNet,
      shockedNetLiquidation: shockedNet,
      pnl,
      pnlPct: baseNet !== 0 ? (pnl / Math.abs(baseNet)) * 100 : 0,
      unhedgedPnl,
      unhedgedPnlPct: baseNet !== 0 ? (unhedgedPnl / Math.abs(baseNet)) * 100 : 0,
      hedgeContribution: pnl - unhedgedPnl,
    },
    curve,
  };
}

function buildCurve(
  store: PortfolioStore,
  scenario: Scenario,
  volModel: VolModelParams,
  positions: Position[],
  accounts: ReturnType<typeof activeAccounts>,
  opts: { anchors: Record<string, number>; betaWeightSymbol: string },
  asOf: Date,
  baseNet: number,
): ScenarioResult['curve'] {
  const { from, to, steps } = scenario.sweep;
  const n = Math.max(2, Math.min(201, Math.round(steps)));
  const out: ScenarioResult['curve'] = [];

  for (let i = 0; i < n; i++) {
    const movePct = from + ((to - from) * i) / (n - 1);
    const { state, tickers } = shockedState(store, scenario, volModel, movePct, asOf);
    const valuation = valuePortfolio(positions, accounts, state, opts);
    const pnl = valuation.total.netLiquidation - baseNet;
    out.push({
      movePct,
      pnl,
      pnlPct: baseNet !== 0 ? (pnl / Math.abs(baseNet)) * 100 : 0,
      unhedgedPnl: unhedgedPnlFor(positions, tickers),
    });
  }
  return out;
}
