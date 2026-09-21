/**
 * Strategy templates and a classifier.
 *
 * A template describes a structure in *relative* terms (ratios, moneyness,
 * tenor buckets) so the builder can turn "collar on NVDA" into concrete legs
 * against the current spot. The classifier runs the other way: given a set of
 * legs that already exist, work out what the structure is called.
 */
import type { OptionPosition, OptionRight, Position } from '../types';

export type StrategyCategory =
  | 'STOCK'
  | 'INCOME'
  | 'PROTECTION'
  | 'DIRECTIONAL'
  | 'VOLATILITY'
  | 'NEUTRAL'
  | 'ADVANCED';

export interface LegSpec {
  kind: 'EQUITY' | 'OPTION';
  right?: OptionRight;
  /** Signed ratio. +1 is long one contract (or 100 shares for an equity leg). */
  ratio: number;
  label: string;
  /** Strike as a fraction of spot, used to seed the builder. */
  moneyness?: number;
  /** Days to expiry used to seed the builder. */
  dte?: number;
}

export interface StrategyTemplate {
  id: string;
  label: string;
  category: StrategyCategory;
  description: string;
  /** What this does to the position's exposure, in one line. */
  hedgeNote: string;
  legs: LegSpec[];
}

const T = (t: StrategyTemplate) => t;

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  T({
    id: 'LONG_STOCK',
    label: 'Long stock',
    category: 'STOCK',
    description: 'Plain long shares.',
    hedgeNote: 'Unhedged: full downside exposure.',
    legs: [{ kind: 'EQUITY', ratio: 1, label: 'Shares' }],
  }),
  T({
    id: 'SHORT_STOCK',
    label: 'Short stock',
    category: 'STOCK',
    description: 'Short shares.',
    hedgeNote: 'Unlimited upside risk.',
    legs: [{ kind: 'EQUITY', ratio: -1, label: 'Shares' }],
  }),

  T({
    id: 'COVERED_CALL',
    label: 'Covered call',
    category: 'INCOME',
    description: 'Long 100 shares, short 1 out-of-the-money call.',
    hedgeNote: 'Caps upside at the short strike; premium cushions ~1 short-call width of downside.',
    legs: [
      { kind: 'EQUITY', ratio: 1, label: 'Shares' },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.07, dte: 35 },
    ],
  }),
  T({
    id: 'CASH_SECURED_PUT',
    label: 'Cash-secured put',
    category: 'INCOME',
    description: 'Short put, fully cash collateralised.',
    hedgeNote: 'Synthetic long below the strike; premium is the only cushion.',
    legs: [{ kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.93, dte: 35 }],
  }),
  T({
    id: 'PROTECTIVE_PUT',
    label: 'Protective put',
    category: 'PROTECTION',
    description: 'Long shares plus a long put.',
    hedgeNote: 'Hard floor at the strike, less the premium paid.',
    legs: [
      { kind: 'EQUITY', ratio: 1, label: 'Shares' },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put', moneyness: 0.9, dte: 120 },
    ],
  }),
  T({
    id: 'COLLAR',
    label: 'Collar',
    category: 'PROTECTION',
    description: 'Long shares, long put, short call financing it.',
    hedgeNote: 'Floor at the put strike, ceiling at the call strike, often near zero cost.',
    legs: [
      { kind: 'EQUITY', ratio: 1, label: 'Shares' },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put (floor)', moneyness: 0.9, dte: 120 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call (ceiling)', moneyness: 1.12, dte: 120 },
    ],
  }),
  T({
    id: 'PUT_SPREAD_COLLAR',
    label: 'Put spread collar',
    category: 'PROTECTION',
    description: 'Collar where the floor is a put spread, cheapening the hedge.',
    hedgeNote: 'Protects a defined band of downside; protection stops at the lower put strike.',
    legs: [
      { kind: 'EQUITY', ratio: 1, label: 'Shares' },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put', moneyness: 0.92, dte: 150 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.75, dte: 150 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.15, dte: 150 },
    ],
  }),
  T({
    id: 'MARRIED_PUT_RATIO',
    label: 'Put ratio backspread',
    category: 'PROTECTION',
    description: 'Short one near put, long two further puts. A crash hedge.',
    hedgeNote: 'Cheap or free until a moderate drop; pays convexly in a crash.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.95, dte: 90 },
      { kind: 'OPTION', right: 'PUT', ratio: 2, label: 'Long puts', moneyness: 0.82, dte: 90 },
    ],
  }),

  T({
    id: 'BULL_CALL_SPREAD',
    label: 'Bull call spread',
    category: 'DIRECTIONAL',
    description: 'Long lower-strike call, short higher-strike call.',
    hedgeNote: 'Defined risk long exposure, capped at the short strike.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.0, dte: 60 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.1, dte: 60 },
    ],
  }),
  T({
    id: 'BEAR_PUT_SPREAD',
    label: 'Bear put spread',
    category: 'DIRECTIONAL',
    description: 'Long higher-strike put, short lower-strike put.',
    hedgeNote: 'Defined-cost downside hedge over a fixed band.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put', moneyness: 0.97, dte: 90 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.85, dte: 90 },
    ],
  }),
  T({
    id: 'BULL_PUT_SPREAD',
    label: 'Bull put spread',
    category: 'INCOME',
    description: 'Short higher-strike put, long lower-strike put. Credit.',
    hedgeNote: 'Adds long exposure below the short strike; loss is capped.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.93, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put', moneyness: 0.85, dte: 45 },
    ],
  }),
  T({
    id: 'BEAR_CALL_SPREAD',
    label: 'Bear call spread',
    category: 'INCOME',
    description: 'Short lower-strike call, long higher-strike call. Credit.',
    hedgeNote: 'Caps upside over a band; defined risk.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.07, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.15, dte: 45 },
    ],
  }),
  T({
    id: 'RISK_REVERSAL',
    label: 'Risk reversal',
    category: 'DIRECTIONAL',
    description: 'Short put, long call. Synthetic long financed by the put.',
    hedgeNote: 'Full downside below the put strike; leveraged upside.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.9, dte: 90 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.1, dte: 90 },
    ],
  }),
  T({
    id: 'SYNTHETIC_LONG',
    label: 'Synthetic long',
    category: 'DIRECTIONAL',
    description: 'Long call and short put at the same strike and expiry.',
    hedgeNote: 'Behaves like 100 shares with none of the capital outlay.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.0, dte: 90 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 1.0, dte: 90 },
    ],
  }),
  T({
    id: 'PMCC',
    label: "Poor man's covered call",
    category: 'INCOME',
    description: 'Long deep-ITM LEAPS call, short near-dated OTM call.',
    hedgeNote: 'Covered-call payoff on a fraction of the capital; LEAPS delta is the stock proxy.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long LEAPS call', moneyness: 0.75, dte: 450 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.07, dte: 35 },
    ],
  }),

  T({
    id: 'LONG_STRADDLE',
    label: 'Long straddle',
    category: 'VOLATILITY',
    description: 'Long call and long put at the same strike.',
    hedgeNote: 'Long vol and long gamma; pays for a move in either direction.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put', moneyness: 1.0, dte: 45 },
    ],
  }),
  T({
    id: 'SHORT_STRADDLE',
    label: 'Short straddle',
    category: 'VOLATILITY',
    description: 'Short call and short put at the same strike.',
    hedgeNote: 'Short vol, short gamma. A vol spike is the main risk.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 1.0, dte: 45 },
    ],
  }),
  T({
    id: 'LONG_STRANGLE',
    label: 'Long strangle',
    category: 'VOLATILITY',
    description: 'Long OTM call and long OTM put.',
    hedgeNote: 'Cheaper long-vol structure; needs a bigger move than a straddle.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put', moneyness: 0.92, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.08, dte: 45 },
    ],
  }),
  T({
    id: 'SHORT_STRANGLE',
    label: 'Short strangle',
    category: 'VOLATILITY',
    description: 'Short OTM call and short OTM put.',
    hedgeNote: 'Short vol with undefined risk on both tails.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.92, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.08, dte: 45 },
    ],
  }),
  T({
    id: 'CALENDAR',
    label: 'Calendar spread',
    category: 'VOLATILITY',
    description: 'Short near-dated, long far-dated at the same strike.',
    hedgeNote: 'Long the term structure; hurt by a spot move away from the strike.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short near call', moneyness: 1.0, dte: 30 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long far call', moneyness: 1.0, dte: 90 },
    ],
  }),
  T({
    id: 'DIAGONAL',
    label: 'Diagonal spread',
    category: 'ADVANCED',
    description: 'Different strikes and different expiries.',
    hedgeNote: 'Calendar with a directional tilt.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short near call', moneyness: 1.05, dte: 30 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long far call', moneyness: 0.95, dte: 120 },
    ],
  }),

  T({
    id: 'IRON_CONDOR',
    label: 'Iron condor',
    category: 'NEUTRAL',
    description: 'Short put spread plus short call spread.',
    hedgeNote: 'Defined-risk short vol inside a band.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put wing', moneyness: 0.85, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.92, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.08, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call wing', moneyness: 1.15, dte: 45 },
    ],
  }),
  T({
    id: 'IRON_BUTTERFLY',
    label: 'Iron butterfly',
    category: 'NEUTRAL',
    description: 'Short straddle with long wings.',
    hedgeNote: 'Maximum credit at the body strike; defined risk.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long put wing', moneyness: 0.9, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call wing', moneyness: 1.1, dte: 45 },
    ],
  }),
  T({
    id: 'CALL_BUTTERFLY',
    label: 'Call butterfly',
    category: 'NEUTRAL',
    description: 'Long 1 / short 2 / long 1 calls.',
    hedgeNote: 'Pins a target price; cheap, low probability, high payoff ratio.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Lower call', moneyness: 0.95, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: -2, label: 'Body calls', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Upper call', moneyness: 1.05, dte: 45 },
    ],
  }),
  T({
    id: 'PUT_BUTTERFLY',
    label: 'Put butterfly',
    category: 'NEUTRAL',
    description: 'Long 1 / short 2 / long 1 puts.',
    hedgeNote: 'Targeted downside payoff; protection fades below the lower wing.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Upper put', moneyness: 1.05, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: -2, label: 'Body puts', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Lower put', moneyness: 0.95, dte: 45 },
    ],
  }),
  T({
    id: 'BROKEN_WING_BUTTERFLY',
    label: 'Broken wing butterfly',
    category: 'ADVANCED',
    description: 'Butterfly with an asymmetric wing, often for a credit.',
    hedgeNote: 'No risk on one side; the skipped strike carries the exposure.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Upper put', moneyness: 1.0, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: -2, label: 'Body puts', moneyness: 0.93, dte: 45 },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Far lower put', moneyness: 0.8, dte: 45 },
    ],
  }),
  T({
    id: 'JADE_LIZARD',
    label: 'Jade lizard',
    category: 'ADVANCED',
    description: 'Short put plus short call spread, credit > call width.',
    hedgeNote: 'No upside risk when the credit exceeds the call spread width.',
    legs: [
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short put', moneyness: 0.92, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.07, dte: 45 },
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.12, dte: 45 },
    ],
  }),
  T({
    id: 'CALL_RATIO_SPREAD',
    label: 'Call ratio spread',
    category: 'ADVANCED',
    description: 'Long 1 call, short 2 further calls.',
    hedgeNote: 'Undefined upside risk above the short strikes.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long call', moneyness: 1.0, dte: 60 },
      { kind: 'OPTION', right: 'CALL', ratio: -2, label: 'Short calls', moneyness: 1.1, dte: 60 },
    ],
  }),
  T({
    id: 'CALL_BACKSPREAD',
    label: 'Call backspread',
    category: 'ADVANCED',
    description: 'Short 1 call, long 2 further calls.',
    hedgeNote: 'Convex upside; hedges a short-squeeze scenario.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short call', moneyness: 1.0, dte: 60 },
      { kind: 'OPTION', right: 'CALL', ratio: 2, label: 'Long calls', moneyness: 1.1, dte: 60 },
    ],
  }),
  T({
    id: 'BOX_SPREAD',
    label: 'Box spread',
    category: 'ADVANCED',
    description: 'Synthetic long plus synthetic short at two strikes.',
    hedgeNote: 'A financing trade: fixed payoff equal to the strike width.',
    legs: [
      { kind: 'OPTION', right: 'CALL', ratio: 1, label: 'Long lower call', moneyness: 0.95, dte: 365 },
      { kind: 'OPTION', right: 'PUT', ratio: -1, label: 'Short lower put', moneyness: 0.95, dte: 365 },
      { kind: 'OPTION', right: 'CALL', ratio: -1, label: 'Short upper call', moneyness: 1.05, dte: 365 },
      { kind: 'OPTION', right: 'PUT', ratio: 1, label: 'Long upper put', moneyness: 1.05, dte: 365 },
    ],
  }),
  T({
    id: 'CUSTOM',
    label: 'Custom structure',
    category: 'ADVANCED',
    description: 'Any combination of legs.',
    hedgeNote: 'Exposure is whatever the legs add up to.',
    legs: [],
  }),
];

export const TEMPLATES_BY_ID: Record<string, StrategyTemplate> = Object.fromEntries(
  STRATEGY_TEMPLATES.map((t) => [t.id, t]),
);

export function templateLabel(id: string): string {
  return TEMPLATES_BY_ID[id]?.label ?? id;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface LegShape {
  right: OptionRight;
  strike: number;
  expiry: string;
  qty: number;
}

/**
 * Work out what a set of legs is called.
 *
 * Returns a template id. Falls back to 'CUSTOM' when nothing matches, which is
 * not a failure: exotic and rolled-into-each-other structures genuinely have no
 * textbook name.
 */
export function classifyStrategy(positions: Position[]): string {
  const shares = positions
    .filter((p): p is Extract<Position, { kind: 'EQUITY' }> => p.kind === 'EQUITY')
    .reduce((sum, p) => sum + p.quantity, 0);

  const legs: LegShape[] = positions
    .filter((p): p is OptionPosition => p.kind === 'OPTION' && p.quantity !== 0)
    .map((p) => ({ right: p.right, strike: p.strike, expiry: p.expiry, qty: p.quantity }))
    .sort((a, b) => a.strike - b.strike || a.expiry.localeCompare(b.expiry));

  if (legs.length === 0) {
    if (shares > 0) return 'LONG_STOCK';
    if (shares < 0) return 'SHORT_STOCK';
    return 'CUSTOM';
  }

  const calls = legs.filter((l) => l.right === 'CALL');
  const puts = legs.filter((l) => l.right === 'PUT');
  const expiries = new Set(legs.map((l) => l.expiry));
  const strikes = new Set(legs.map((l) => l.strike));
  const sameExpiry = expiries.size === 1;
  const longCalls = calls.filter((l) => l.qty > 0);
  const shortCalls = calls.filter((l) => l.qty < 0);
  const longPuts = puts.filter((l) => l.qty > 0);
  const shortPuts = puts.filter((l) => l.qty < 0);

  // --- Structures that involve the shares themselves -----------------------
  if (shares > 0) {
    if (legs.length === 1 && shortCalls.length === 1) return 'COVERED_CALL';
    if (legs.length === 1 && longPuts.length === 1) return 'PROTECTIVE_PUT';
    if (legs.length === 2 && longPuts.length === 1 && shortCalls.length === 1) return 'COLLAR';
    if (legs.length === 3 && longPuts.length === 1 && shortPuts.length === 1 && shortCalls.length === 1) {
      return 'PUT_SPREAD_COLLAR';
    }
  }

  // --- Single leg ----------------------------------------------------------
  if (legs.length === 1) {
    const l = legs[0];
    if (l.right === 'PUT' && l.qty < 0) return 'CASH_SECURED_PUT';
    return 'CUSTOM';
  }

  // --- Two legs ------------------------------------------------------------
  if (legs.length === 2) {
    const [a, b] = legs;

    if (calls.length === 2 && sameExpiry && strikes.size === 2) {
      const lower = a.strike < b.strike ? a : b;
      if (lower.qty > 0 && Math.abs(lower.qty) === Math.abs(legs[1].qty)) return 'BULL_CALL_SPREAD';
      if (lower.qty < 0 && Math.abs(lower.qty) === Math.abs(legs[1].qty)) return 'BEAR_CALL_SPREAD';
      if (lower.qty > 0) return 'CALL_RATIO_SPREAD';
      return 'CALL_BACKSPREAD';
    }
    if (puts.length === 2 && sameExpiry && strikes.size === 2) {
      const upper = a.strike > b.strike ? a : b;
      const lower = a.strike > b.strike ? b : a;
      if (Math.abs(a.qty) === Math.abs(b.qty)) {
        return upper.qty > 0 ? 'BEAR_PUT_SPREAD' : 'BULL_PUT_SPREAD';
      }
      if (upper.qty < 0 && Math.abs(lower.qty) > Math.abs(upper.qty)) return 'MARRIED_PUT_RATIO';
      return 'CUSTOM';
    }
    if (!sameExpiry && strikes.size === 1 && a.right === b.right) return 'CALENDAR';
    if (!sameExpiry && a.right === b.right) {
      // Deep-ITM long LEAPS call against a short near OTM call is a PMCC.
      const longLeg = a.qty > 0 ? a : b;
      const shortLeg = a.qty > 0 ? b : a;
      if (a.right === 'CALL' && longLeg.strike < shortLeg.strike && longLeg.expiry > shortLeg.expiry) {
        return 'PMCC';
      }
      return 'DIAGONAL';
    }
    if (sameExpiry && strikes.size === 1 && calls.length === 1 && puts.length === 1) {
      if (calls[0].qty > 0 && puts[0].qty > 0) return 'LONG_STRADDLE';
      if (calls[0].qty < 0 && puts[0].qty < 0) return 'SHORT_STRADDLE';
      if (calls[0].qty > 0 && puts[0].qty < 0) return 'SYNTHETIC_LONG';
      return 'CUSTOM';
    }
    if (sameExpiry && calls.length === 1 && puts.length === 1) {
      if (calls[0].qty > 0 && puts[0].qty > 0) return 'LONG_STRANGLE';
      if (calls[0].qty < 0 && puts[0].qty < 0) return 'SHORT_STRANGLE';
      if (calls[0].qty > 0 && puts[0].qty < 0) return 'RISK_REVERSAL';
      return 'CUSTOM';
    }
    return 'CUSTOM';
  }

  // --- Three legs ----------------------------------------------------------
  if (legs.length === 3 && sameExpiry) {
    if (isButterfly(calls) && puts.length === 0) return 'CALL_BUTTERFLY';
    if (isButterfly(puts) && calls.length === 0) return 'PUT_BUTTERFLY';
    if (puts.length === 3 && isBrokenWing(puts)) return 'BROKEN_WING_BUTTERFLY';
    if (shortPuts.length === 1 && shortCalls.length === 1 && longCalls.length === 1) return 'JADE_LIZARD';
  }

  // --- Four legs -----------------------------------------------------------
  if (legs.length === 4 && sameExpiry) {
    if (longPuts.length === 1 && shortPuts.length === 1 && shortCalls.length === 1 && longCalls.length === 1) {
      const shortPut = shortPuts[0];
      const shortCall = shortCalls[0];
      if (shortPut.strike === shortCall.strike) return 'IRON_BUTTERFLY';
      if (longPuts[0].strike < shortPut.strike && shortCall.strike < longCalls[0].strike) return 'IRON_CONDOR';
    }
    if (longCalls.length === 1 && shortCalls.length === 1 && longPuts.length === 1 && shortPuts.length === 1) {
      const synthLongStrike = longCalls[0].strike;
      if (shortPuts[0].strike === synthLongStrike && shortCalls[0].strike === longPuts[0].strike) {
        return 'BOX_SPREAD';
      }
    }
  }

  return 'CUSTOM';
}

function isButterfly(legs: LegShape[]): boolean {
  if (legs.length !== 3) return false;
  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const [lo, mid, hi] = sorted;
  const equalWidth = Math.abs(hi.strike - mid.strike - (mid.strike - lo.strike)) < 1e-6;
  return (
    equalWidth &&
    lo.qty > 0 &&
    hi.qty > 0 &&
    mid.qty < 0 &&
    Math.abs(mid.qty) === lo.qty + hi.qty
  );
}

function isBrokenWing(legs: LegShape[]): boolean {
  if (legs.length !== 3) return false;
  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const [lo, mid, hi] = sorted;
  const unequalWidth = Math.abs(hi.strike - mid.strike - (mid.strike - lo.strike)) > 1e-6;
  return unequalWidth && lo.qty > 0 && hi.qty > 0 && mid.qty < 0 && Math.abs(mid.qty) === lo.qty + hi.qty;
}

/** Turn a template into concrete legs against a spot price. */
export function buildLegsFromTemplate(
  template: StrategyTemplate,
  spot: number,
  contracts: number,
  today = new Date(),
): { kind: 'EQUITY' | 'OPTION'; right?: OptionRight; strike?: number; expiry?: string; quantity: number; label: string }[] {
  return template.legs.map((leg) => {
    if (leg.kind === 'EQUITY') {
      return { kind: 'EQUITY' as const, quantity: leg.ratio * contracts * 100, label: leg.label };
    }
    const expiry = new Date(today.getTime() + (leg.dte ?? 45) * 86400000);
    return {
      kind: 'OPTION' as const,
      right: leg.right,
      strike: roundStrike(spot * (leg.moneyness ?? 1)),
      expiry: nextFriday(expiry).toISOString().slice(0, 10),
      quantity: leg.ratio * contracts,
      label: leg.label,
    };
  });
}

/** Round to a plausible listed strike increment for the price level. */
export function roundStrike(raw: number): number {
  const increment = raw < 25 ? 0.5 : raw < 100 ? 1 : raw < 250 ? 2.5 : raw < 1000 ? 5 : 10;
  return Math.round(raw / increment) * increment;
}

/** Listed monthlies expire on a Friday; nudge a seeded date to the next one. */
export function nextFriday(date: Date): Date {
  const d = new Date(date.getTime());
  const daysUntilFriday = (5 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilFriday);
  return d;
}
