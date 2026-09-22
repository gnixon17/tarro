/**
 * Schwab payloads → Tarro domain.
 *
 * Pure and defensive. Field names here were taken from Schwab's published
 * schemas, but a broker API is not a contract you control: every accessor
 * tolerates a missing field, unit-ambiguous numbers are range-checked rather
 * than assumed, and anything that cannot be mapped is reported as a warning
 * instead of being silently dropped. A position that vanishes quietly is worse
 * than one that shows up with a complaint attached.
 */
import { parseOptionSymbol } from './osi';
import type { OptionRight } from '../types';

// --- raw payload shapes (only the fields we read) -------------------------

export interface RawInstrument {
  assetType?: string;
  symbol?: string;
  description?: string;
  putCall?: string;
  underlyingSymbol?: string;
  optionMultiplier?: number;
  cusip?: string;
}

export interface RawPosition {
  instrument?: RawInstrument;
  longQuantity?: number;
  shortQuantity?: number;
  averagePrice?: number;
  averageLongPrice?: number;
  averageShortPrice?: number;
  marketValue?: number;
}

export interface RawSecuritiesAccount {
  type?: string;
  accountNumber?: string;
  positions?: RawPosition[];
  currentBalances?: { cashBalance?: number; liquidationValue?: number; moneyMarketFund?: number; totalCash?: number };
}

export interface RawAccountEnvelope {
  securitiesAccount?: RawSecuritiesAccount;
}

export interface RawQuote {
  symbol?: string;
  assetMainType?: string;
  quote?: { lastPrice?: number; mark?: number; bidPrice?: number; askPrice?: number; closePrice?: number };
  fundamental?: { divYield?: number; divAmount?: number };
}

export interface RawOptionContract {
  putCall?: string;
  symbol?: string;
  strikePrice?: number;
  expirationDate?: string;
  daysToExpiration?: number;
  multiplier?: number;
  volatility?: number;
  delta?: number;
  bidPrice?: number;
  askPrice?: number;
  lastPrice?: number;
  markPrice?: number;
  openInterest?: number;
  totalVolume?: number;
}

export interface RawOptionChain {
  symbol?: string;
  underlyingPrice?: number;
  interestRate?: number;
  isIndex?: boolean;
  callExpDateMap?: Record<string, Record<string, RawOptionContract[]>>;
  putExpDateMap?: Record<string, Record<string, RawOptionContract[]>>;
}

// --- mapped shapes --------------------------------------------------------

export interface MappedAccount {
  externalId: string;
  externalLabel: string;
  /** Schwab reports MARGIN or CASH. The tax registration is not in the API. */
  marginType: string;
  cash: number;
  liquidationValue: number | null;
  positions: MappedPosition[];
}

export type MappedPosition =
  | {
      kind: 'EQUITY';
      symbol: string;
      quantity: number;
      costBasis: number;
      externalSymbol: string;
      marketValue: number | null;
    }
  | {
      kind: 'OPTION';
      symbol: string;
      right: OptionRight;
      strike: number;
      expiry: string;
      quantity: number;
      multiplier: number;
      costBasis: number;
      externalSymbol: string;
      marketValue: number | null;
    };

export interface MapResult<T> {
  value: T;
  warnings: string[];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Schwab reports implied vol as a percentage (46.2 means 46.2 vol). Tarro works
 * in decimals. Range-check rather than assume: anything above 3.0 can only be a
 * percentage, since a 300% vol decimal is not a market.
 */
export function normalizeVol(raw: unknown): number | null {
  const v = num(raw);
  if (v === null || v <= 0) return null;
  const decimal = v > 3 ? v / 100 : v;
  return decimal > 0 && decimal < 5 ? decimal : null;
}

/** Schwab reports dividend yield as a percentage number, e.g. 1.23 for 1.23%. */
export function normalizeDividendYield(raw: unknown): number | null {
  const v = num(raw);
  if (v === null || v < 0) return null;
  const decimal = v / 100;
  return decimal < 0.5 ? decimal : null;
}

/** Last four digits only — the full account number never needs to be stored. */
export function maskAccountNumber(accountNumber: string | undefined): string {
  if (!accountNumber) return 'account';
  const tail = accountNumber.trim().slice(-4);
  return tail ? `…${tail}` : 'account';
}

const EQUITY_ASSET_TYPES = new Set(['EQUITY', 'COLLECTIVE_INVESTMENT', 'ETF', 'MUTUAL_FUND', 'INDEX']);

/**
 * Net signed quantity.
 *
 * Schwab splits a position into `longQuantity` and `shortQuantity`, both
 * non-negative. A short is reported as a positive `shortQuantity`, so the sign
 * has to be reconstructed.
 */
export function signedQuantity(position: RawPosition): number {
  return (num(position.longQuantity) ?? 0) - (num(position.shortQuantity) ?? 0);
}

/**
 * Per-share cost.
 *
 * `averagePrice` on an option position is per share of the contract, matching
 * how Tarro stores premium. Where Schwab gives a side-specific average, prefer
 * the one matching the position's direction.
 */
export function costPerShare(position: RawPosition, quantity: number): number {
  const sideSpecific = quantity < 0 ? num(position.averageShortPrice) : num(position.averageLongPrice);
  return sideSpecific ?? num(position.averagePrice) ?? 0;
}

export function mapPosition(raw: RawPosition): MapResult<MappedPosition | null> {
  const warnings: string[] = [];
  const instrument = raw.instrument ?? {};
  const symbol = (instrument.symbol ?? '').trim().toUpperCase();

  if (!symbol) {
    return { value: null, warnings: ['A position came back with no symbol and was skipped.'] };
  }

  const quantity = signedQuantity(raw);
  if (quantity === 0) {
    // Fully closed rows are still returned during the settlement window.
    return { value: null, warnings: [] };
  }

  const assetType = (instrument.assetType ?? '').toUpperCase();
  const marketValue = num(raw.marketValue);

  if (assetType === 'OPTION') {
    const parsed = parseOptionSymbol(symbol);
    if (!parsed) {
      return {
        value: null,
        warnings: [`Could not read the option symbol "${symbol}" — skipped. Add it by hand if you hold it.`],
      };
    }

    const underlying = (instrument.underlyingSymbol ?? parsed.underlying).trim().toUpperCase();
    if (instrument.underlyingSymbol && instrument.underlyingSymbol.trim().toUpperCase() !== parsed.underlying) {
      // Trust the explicit field: adjusted contracts carry a mangled root.
      warnings.push(
        `${symbol}: the symbol's root (${parsed.underlying}) disagrees with the reported underlying (${underlying}). Using ${underlying}; check for a split or other adjustment.`,
      );
    }

    const multiplier = num(instrument.optionMultiplier) ?? 100;
    if (multiplier !== 100) {
      warnings.push(`${symbol}: non-standard multiplier of ${multiplier} — likely an adjusted contract. Verify the deliverable.`);
    }

    const right = (instrument.putCall ?? '').toUpperCase();
    if (right === 'PUT' || right === 'CALL') {
      if (right !== parsed.right) {
        warnings.push(`${symbol}: reported ${right} but the symbol says ${parsed.right}. Using ${right}.`);
      }
    }

    return {
      value: {
        kind: 'OPTION',
        symbol: underlying,
        right: (right === 'PUT' || right === 'CALL' ? right : parsed.right) as OptionRight,
        strike: parsed.strike,
        expiry: parsed.expiry,
        quantity,
        multiplier,
        costBasis: costPerShare(raw, quantity),
        externalSymbol: symbol,
        marketValue,
      },
      warnings,
    };
  }

  if (!EQUITY_ASSET_TYPES.has(assetType)) {
    return {
      value: null,
      warnings: [`${symbol}: asset type ${assetType || 'unknown'} is not modelled (only shares, ETFs and options are) — skipped.`],
    };
  }

  return {
    value: {
      kind: 'EQUITY',
      symbol,
      quantity,
      costBasis: costPerShare(raw, quantity),
      externalSymbol: symbol,
      marketValue,
    },
    warnings,
  };
}

export function mapAccount(envelope: RawAccountEnvelope, externalId: string): MapResult<MappedAccount | null> {
  const account = envelope.securitiesAccount;
  if (!account) return { value: null, warnings: ['An account envelope had no securitiesAccount and was skipped.'] };

  const warnings: string[] = [];
  const positions: MappedPosition[] = [];

  for (const raw of account.positions ?? []) {
    const mapped = mapPosition(raw);
    warnings.push(...mapped.warnings);
    if (mapped.value) positions.push(mapped.value);
  }

  const balances = account.currentBalances ?? {};

  return {
    value: {
      externalId,
      externalLabel: maskAccountNumber(account.accountNumber),
      marginType: account.type ?? 'UNKNOWN',
      cash: num(balances.cashBalance) ?? num(balances.totalCash) ?? num(balances.moneyMarketFund) ?? 0,
      liquidationValue: num(balances.liquidationValue),
      positions,
    },
    warnings,
  };
}

export interface MappedQuote {
  symbol: string;
  price: number;
  dividendYield: number | null;
}

/** Quotes come back keyed by symbol. */
export function mapQuotes(raw: Record<string, RawQuote> | null | undefined): MapResult<MappedQuote[]> {
  const warnings: string[] = [];
  const out: MappedQuote[] = [];
  if (!raw || typeof raw !== 'object') return { value: out, warnings: ['The quote response was empty.'] };

  for (const [key, entry] of Object.entries(raw)) {
    const symbol = (entry?.symbol ?? key).trim().toUpperCase();
    const q = entry?.quote ?? {};
    // Prefer the mark, then last, then the midpoint, then the prior close: at
    // 4am the last trade can be stale but the book is still quoted.
    const mid = num(q.bidPrice) !== null && num(q.askPrice) !== null ? (q.bidPrice! + q.askPrice!) / 2 : null;
    const price = num(q.mark) ?? num(q.lastPrice) ?? mid ?? num(q.closePrice);

    if (price === null || price <= 0) {
      warnings.push(`${symbol}: no usable price in the quote — left unchanged.`);
      continue;
    }
    out.push({ symbol, price, dividendYield: normalizeDividendYield(entry?.fundamental?.divYield) });
  }
  return { value: out, warnings };
}

export interface ChainContract {
  right: OptionRight;
  symbol: string;
  strike: number;
  expiry: string;
  timeYears: number;
  iv: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  openInterest: number | null;
  delta: number | null;
}

export interface MappedChain {
  symbol: string;
  underlyingPrice: number | null;
  interestRate: number | null;
  contracts: ChainContract[];
}

/** Flatten `callExpDateMap` / `putExpDateMap` into a plain list. */
export function mapChain(raw: RawOptionChain | null | undefined): MapResult<MappedChain | null> {
  if (!raw || !raw.symbol) return { value: null, warnings: ['An option chain came back empty.'] };

  const warnings: string[] = [];
  const contracts: ChainContract[] = [];

  const walk = (map: Record<string, Record<string, RawOptionContract[]>> | undefined, right: OptionRight) => {
    for (const byStrike of Object.values(map ?? {})) {
      for (const list of Object.values(byStrike ?? {})) {
        for (const c of list ?? []) {
          const strike = num(c.strikePrice);
          const symbol = c.symbol ?? '';
          const parsed = parseOptionSymbol(symbol);
          const expiry = parsed?.expiry ?? (c.expirationDate ? c.expirationDate.slice(0, 10) : null);
          if (strike === null || !expiry) continue;

          // daysToExpiration is whole days and hits 0 on expiry day; keep a
          // floor so the fit does not divide by zero.
          const days = num(c.daysToExpiration);
          contracts.push({
            right,
            symbol,
            strike,
            expiry,
            timeYears: Math.max(days ?? 1, 0.5) / 365,
            iv: normalizeVol(c.volatility),
            mark: num(c.markPrice),
            bid: num(c.bidPrice),
            ask: num(c.askPrice),
            openInterest: num(c.openInterest),
            delta: num(c.delta),
          });
        }
      }
    }
  };

  walk(raw.callExpDateMap, 'CALL');
  walk(raw.putExpDateMap, 'PUT');

  if (contracts.length === 0) warnings.push(`${raw.symbol}: the chain had no readable contracts.`);

  return {
    value: {
      symbol: raw.symbol.trim().toUpperCase(),
      underlyingPrice: num(raw.underlyingPrice),
      interestRate: num(raw.interestRate),
      contracts,
    },
    warnings,
  };
}
