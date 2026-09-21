/**
 * Built-in scenarios.
 *
 * These are calibrated to what actually happened, not to round numbers: the
 * drawdown size, how long it took, and roughly where VIX went. They are
 * starting points - every parameter is editable, and a copy can be saved.
 */
import { newId } from '../id';
import type { Scenario, TickerShock } from '../types';

export const DEFAULT_SWEEP = { from: -35, to: 20, steps: 56 };

export interface ScenarioInit {
  name: string;
  description?: string;
  marketMovePct: number;
  daysForward?: number;
  rateShiftBps?: number;
  tickerShocks?: Record<string, TickerShock>;
  volModel?: Scenario['volModel'];
  sweep?: Scenario['sweep'];
  accountIds?: string[];
  builtIn?: boolean;
}

export function makeScenario(init: ScenarioInit): Scenario {
  const now = new Date().toISOString();
  return {
    id: newId('scn'),
    name: init.name,
    description: init.description,
    marketMovePct: init.marketMovePct,
    daysForward: init.daysForward ?? 0,
    rateShiftBps: init.rateShiftBps ?? 0,
    tickerShocks: init.tickerShocks ?? {},
    volModel: init.volModel,
    sweep: init.sweep ?? { ...DEFAULT_SWEEP },
    accountIds: init.accountIds ?? [],
    createdAt: now,
    updatedAt: now,
    builtIn: init.builtIn ?? false,
  };
}

export const BUILTIN_SCENARIOS: ScenarioInit[] = [
  {
    name: 'Garden-variety correction',
    description: 'A 10% pullback over six weeks. VIX into the low 20s.',
    marketMovePct: -10,
    daysForward: 42,
    builtIn: true,
  },
  {
    name: 'Sharp 20% drawdown',
    description:
      'The scenario most hedges are actually sized for: a 20% index drop over a month. Index IV roughly triples; single names gain more vol points but multiply by less.',
    marketMovePct: -20,
    daysForward: 30,
    builtIn: true,
  },
  {
    name: 'Flash crash (one day)',
    description: 'Index down 8% intraday with no time decay. Pure gamma and vega event.',
    marketMovePct: -8,
    daysForward: 1,
    volModel: { betaVolToSpot: 2.2, convexity: 3 },
    sweep: { from: -20, to: 10, steps: 61 },
    builtIn: true,
  },
  {
    name: 'COVID-19 crash (Feb–Mar 2020)',
    description:
      'S&P 500 −34% in 33 days, VIX from 14 to 82. The default vol response already reproduces that jump; the override here only inverts the term structure, as it did.',
    marketMovePct: -34,
    daysForward: 33,
    rateShiftBps: -150,
    volModel: { termDecay: 0.25 },
    sweep: { from: -45, to: 15, steps: 61 },
    builtIn: true,
  },
  {
    name: 'GFC bear market (2008)',
    description:
      'S&P 500 −45% over six months. A grind, not a gap: vol rose a long way but nothing like as far per point of drawdown as in a one-month crash, so the vol response is dialled down.',
    marketMovePct: -45,
    daysForward: 180,
    rateShiftBps: -300,
    volModel: { betaVolToSpot: 0.7, convexity: 1 },
    sweep: { from: -55, to: 20, steps: 61 },
    builtIn: true,
  },
  {
    name: 'Black Monday (1987)',
    description: 'Index −22% in a single session. The stress test for anything short gamma.',
    marketMovePct: -22,
    daysForward: 1,
    volModel: { betaVolToSpot: 2.0, convexity: 3, termDecay: 0.2 },
    sweep: { from: -35, to: 10, steps: 61 },
    builtIn: true,
  },
  {
    name: 'Melt-up',
    description: 'Index +15% over a quarter with vol bleeding lower. Where covered calls and collars hurt.',
    marketMovePct: 15,
    daysForward: 90,
    sweep: { from: -10, to: 35, steps: 46 },
    builtIn: true,
  },
  {
    name: 'Grind higher, vol crush',
    description: 'Index +3% over 45 days with IV compressing 20%. The short-premium payday.',
    marketMovePct: 3,
    daysForward: 45,
    volModel: { betaVolToSpot: 0.6, upsideDamping: 1.0 },
    sweep: { from: -15, to: 20, steps: 36 },
    builtIn: true,
  },
  {
    name: 'Nowhere for 60 days',
    description: 'Index unchanged, clock runs. Isolates theta and the cost of carrying protection.',
    marketMovePct: 0,
    daysForward: 60,
    sweep: { from: -15, to: 15, steps: 31 },
    builtIn: true,
  },
  {
    name: 'Rate shock +150bp',
    description: 'Index −7% and the curve repricing. Long-dated options feel the rho.',
    marketMovePct: -7,
    daysForward: 20,
    rateShiftBps: 150,
    builtIn: true,
  },
];
