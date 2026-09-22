/** Core domain model for the portfolio + hedge tracker. */

export type OptionRight = 'CALL' | 'PUT';

export type AccountKind =
  | 'TAXABLE'
  | 'TRADITIONAL_IRA'
  | 'ROTH_IRA'
  | 'SEP_IRA'
  | 'ROLLOVER_IRA'
  | '401K'
  | 'ROTH_401K'
  | 'HSA'
  | 'CUSTODIAL'
  | 'TRUST'
  | 'OTHER';

export type TaxTreatment = 'TAXABLE' | 'TAX_DEFERRED' | 'TAX_FREE';

export const ACCOUNT_KINDS: { id: AccountKind; label: string; tax: TaxTreatment }[] = [
  { id: 'TAXABLE', label: 'Taxable brokerage', tax: 'TAXABLE' },
  { id: 'TRADITIONAL_IRA', label: 'Traditional IRA', tax: 'TAX_DEFERRED' },
  { id: 'ROLLOVER_IRA', label: 'Rollover IRA', tax: 'TAX_DEFERRED' },
  { id: 'SEP_IRA', label: 'SEP IRA', tax: 'TAX_DEFERRED' },
  { id: 'ROTH_IRA', label: 'Roth IRA', tax: 'TAX_FREE' },
  { id: '401K', label: '401(k)', tax: 'TAX_DEFERRED' },
  { id: 'ROTH_401K', label: 'Roth 401(k)', tax: 'TAX_FREE' },
  { id: 'HSA', label: 'HSA', tax: 'TAX_FREE' },
  { id: 'CUSTODIAL', label: 'Custodial / UTMA', tax: 'TAXABLE' },
  { id: 'TRUST', label: 'Trust', tax: 'TAXABLE' },
  { id: 'OTHER', label: 'Other', tax: 'TAXABLE' },
];

/** Where a record came from. Synced records are reconciled; manual ones are never touched. */
export type RecordSource = 'MANUAL' | 'SCHWAB';

export interface Account {
  id: string;
  name: string;
  broker: string;
  kind: AccountKind;
  /**
   * The broker's own identifier for this account — Schwab's encrypted account
   * hash. Present only on linked accounts; its presence is what makes an
   * account eligible for sync.
   */
  externalId?: string;
  /** Masked account number for display, e.g. "…4821". Never the full number. */
  externalLabel?: string;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt?: string;
  /** Uninvested cash. Counts toward portfolio value but carries no market risk. */
  cash: number;
  /** Options approval level, informational only. */
  optionsLevel?: 0 | 1 | 2 | 3 | 4;
  notes?: string;
}

/**
 * Ticker-level market assumptions. This is the "what do I believe about this
 * name" record: its mark, its dividend, how it moves with the market, and the
 * shape of its vol surface.
 */
export interface Instrument {
  symbol: string;
  name: string;
  /** Last mark for the underlying. */
  price: number;
  /** Continuous dividend yield as a decimal. */
  dividendYield: number;
  /** Beta to the market proxy. Drives the SPY-shock propagation. */
  beta: number;
  /** 30-day at-the-money implied vol, as a decimal. */
  ivAtm30: number;
  /**
   * Idiosyncratic multiplier on this name's vol response, on top of the
   * level-scaling the model already applies. Leave at 1.0 unless a name is
   * genuinely more or less vol-reactive than its vol level implies - an
   * upcoming binary event, say, or a name whose IV is already event-inflated.
   */
  volBeta: number;
  /**
   * Skew: change in IV per unit of standardised log-moneyness
   * (ln(K/F) / sqrt(T)). Negative for the usual equity put skew.
   */
  skewSlope: number;
  /** Smile curvature on the same standardised axis. */
  skewCurvature: number;
  /** Term structure slope: IV(T) = IV30 + termSlope * ln(T_days / 30). */
  termSlope: number;
  sector?: string;
  updatedAt?: string;
  /** Where price/IV last came from, so the UI can show what is live and what is typed. */
  source?: RecordSource;
  /**
   * Set when a ticker was created automatically with placeholder assumptions.
   *
   * A broker reports positions and prices but not beta, and a silent beta of
   * 1.0 on a high-beta name understates every stress test without anything
   * looking wrong. This makes that visible until a human has looked at it.
   * Cleared the first time the ticker is edited by hand.
   */
  needsReview?: boolean;
  /** Goodness of fit from the last surface calibration, for judging the parameters. */
  surfaceFit?: {
    /** Root-mean-square error in vol points between the fit and the chain. */
    rmseVolPoints: number;
    /** Contracts used. */
    samples: number;
    expiries: number;
    fittedAt: string;
  };
}

export type PositionKind = 'EQUITY' | 'OPTION';

interface PositionBase {
  id: string;
  accountId: string;
  symbol: string;
  /** Links this position into a named multi-leg strategy. */
  groupId?: string | null;
  openedAt?: string;
  notes?: string;
  /** Defaults to MANUAL when absent. Only SCHWAB rows are reconciled by a sync. */
  source?: RecordSource;
  /** The broker's symbol for this position, used to match it on the next sync. */
  externalSymbol?: string;
}

export interface EquityPosition extends PositionBase {
  kind: 'EQUITY';
  /** Shares. Negative for a short. */
  quantity: number;
  /** Average cost per share. */
  costBasis: number;
}

export interface OptionPosition extends PositionBase {
  kind: 'OPTION';
  right: OptionRight;
  strike: number;
  /** ISO date, e.g. "2027-01-15". */
  expiry: string;
  /** Contracts. Negative for a short. */
  quantity: number;
  /** Shares per contract; 100 unless the contract was adjusted. */
  multiplier: number;
  /** Premium paid/received per share (not per contract). */
  costBasis: number;
  /**
   * Marked implied vol for this specific contract, as a decimal. When present
   * the surface is anchored to it: the difference between this and the model
   * surface is held constant through a scenario, so the user's own mark is
   * respected but still responds to shocks.
   */
  markIv?: number;
  /** Optional last traded price per share, used to back out markIv. */
  markPrice?: number;
}

export type Position = EquityPosition | OptionPosition;

/** A named bundle of legs: a collar, an iron condor, a PMCC, whatever. */
export interface StrategyGroup {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  /** Template id from `strategies.ts`, or 'CUSTOM'. */
  template: string;
  /** What this structure is for, in the user's own words. */
  thesis?: string;
  openedAt?: string;
  closedAt?: string | null;
  tags?: string[];
}

/** Global pricing + display settings. */
export interface Settings {
  /** Continuously compounded risk-free rate as a decimal. */
  riskFreeRate: number;
  /** Symbol used as the market factor for beta propagation. */
  marketSymbol: string;
  /** Baseline for "beta-weighted delta" reporting. */
  betaWeightSymbol: string;
  /** Default vol-shock parameters used when a scenario does not override them. */
  volModel: VolModelParams;
  currency: string;
}

export interface VolModelParams {
  /**
   * Vol points of index IV change per 1% index move, before convexity.
   * Calibrated so the defaults reproduce the historical record: -5% lifts VIX
   * about 7 points, -10% about 15, -34% (COVID) about 68.
   */
  betaVolToSpot: number;
  /** Extra kick for large moves: multiplier is (1 + convexity * |move|). */
  convexity: number;
  /**
   * How a single name's vol response scales with its own vol level:
   *   dSigma_i = volBeta_i * dSigma_market * (sigma_i / sigma_market) ^ exponent
   *
   * A high-vol name gains more vol POINTS than the index but multiplies by
   * less, so the exponent belongs strictly between 0 and 1. Fitting COVID
   * (NVDA 44->95, TSLA 55->110, MSFT 24->58 against SPX 15->45) puts it
   * between 0.27 and 0.49; 0.45 is the default. Setting it to 1 would say a
   * 55-vol name gains 3.7x the index's points, which no crash has ever done.
   */
  volLevelExponent: number;
  /** Rallies compress vol less than selloffs lift it. 0.5 = half as much. */
  upsideDamping: number;
  /**
   * Term-structure response. Short-dated vol reacts more:
   * factor = (30 / days) ^ termDecay, clamped.
   */
  termDecay: number;
  /** Absolute floor on any shocked IV. */
  minVol: number;
  /** Absolute cap on any shocked IV. */
  maxVol: number;
  /** Whether the surface follows spot (sticky moneyness) or stays put (sticky strike). */
  stickiness: 'STICKY_MONEYNESS' | 'STICKY_STRIKE';
}

export interface TickerShock {
  /** Explicit move for this ticker in percent, overriding beta propagation. */
  movePct?: number;
  /** Beta override for this scenario only. */
  beta?: number;
  /** Additive idiosyncratic move in percent, applied on top of the beta move. */
  alphaPct?: number;
  /** Additive IV shock in vol points, on top of the model's response. */
  ivPointsDelta?: number;
  /** Multiplier applied to the resulting IV (1.0 = no change). */
  ivMultiplier?: number;
  /** Set to true to hold this name flat regardless of the market move. */
  pinned?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  /** Market proxy move in percent. -20 means SPY down 20%. */
  marketMovePct: number;
  /** Trading days forward; drives theta and the loss of extrinsic value. */
  daysForward: number;
  /** Parallel shift in the risk-free rate, in basis points. */
  rateShiftBps: number;
  /** Per-ticker overrides. */
  tickerShocks: Record<string, TickerShock>;
  /** Vol-model overrides for this scenario; merged over `Settings.volModel`. */
  volModel?: Partial<VolModelParams>;
  /** Range for the stress curve, in percent. */
  sweep: { from: number; to: number; steps: number };
  /** Restrict the run to a subset of accounts; empty means all. */
  accountIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  /** Built-in presets are not editable or deletable. */
  builtIn?: boolean;
}

export interface PortfolioStore {
  accounts: Account[];
  instruments: Instrument[];
  positions: Position[];
  groups: StrategyGroup[];
  scenarios: Scenario[];
  settings: Settings;
}

export const DEFAULT_VOL_MODEL: VolModelParams = {
  betaVolToSpot: 1.25,
  convexity: 2,
  volLevelExponent: 0.45,
  upsideDamping: 0.45,
  termDecay: 0.45,
  minVol: 0.05,
  maxVol: 3.0,
  stickiness: 'STICKY_MONEYNESS',
};

export const DEFAULT_SETTINGS: Settings = {
  riskFreeRate: 0.042,
  marketSymbol: 'SPY',
  betaWeightSymbol: 'SPY',
  volModel: DEFAULT_VOL_MODEL,
  currency: 'USD',
};

export function taxTreatmentOf(kind: AccountKind): TaxTreatment {
  return ACCOUNT_KINDS.find((k) => k.id === kind)?.tax ?? 'TAXABLE';
}

export function accountKindLabel(kind: AccountKind): string {
  return ACCOUNT_KINDS.find((k) => k.id === kind)?.label ?? kind;
}
