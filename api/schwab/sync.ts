/**
 * Sync orchestration: fetch, map, and turn into a reviewable plan.
 *
 * Nothing here mutates the portfolio. Positions come back as a plan the user
 * approves; market data comes back as a list of proposed instrument updates.
 * The routes layer applies whatever is accepted.
 */
import { endpoints } from './client';
import {
  mapAccount,
  mapChain,
  mapQuotes,
  type ChainContract,
  type MappedAccount,
  type RawAccountEnvelope,
  type RawOptionChain,
  type RawQuote,
} from '../../src/lib/brokers/schwabMap';
import { fitSurface } from '../../src/lib/brokers/surfaceFit';
import { buildSyncPlan, type SyncPlan } from '../../src/lib/brokers/reconcile';
import { yearsToExpiry } from '../../src/lib/portfolio/valuation';
import type { Instrument, OptionPosition, PortfolioStore } from '../../src/lib/types';

/** Raw payloads from the last call, for the inspector. Capped so it cannot grow. */
const rawSamples = new Map<string, unknown>();
const MAX_SAMPLES = 12;

function recordRaw(label: string, payload: unknown): void {
  if (rawSamples.size >= MAX_SAMPLES && !rawSamples.has(label)) {
    rawSamples.delete(rawSamples.keys().next().value as string);
  }
  rawSamples.set(label, payload);
}

/**
 * The shapes seen on the last sync, with values stripped.
 *
 * Schwab's schemas are published but not guaranteed, and a renamed field would
 * otherwise show up as a silently missing number. This reports the keys that
 * actually arrived so a mismatch is visible rather than inferred from a wrong
 * total. Values are dropped so the inspector cannot leak holdings.
 */
export function rawShapes(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [label, payload] of rawSamples) out[label] = shapeOf(payload, 0);
  return out;
}

function shapeOf(value: unknown, depth: number): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.length === 0 ? [] : [shapeOf(value[0], depth + 1)];
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
    return Object.fromEntries(entries.map(([k, v]) => [k, shapeOf(v, depth + 1)]));
  }
  return typeof value;
}

export interface AccountFetchResult {
  accounts: MappedAccount[];
  warnings: string[];
}

/**
 * Fetch every linked account with its positions.
 *
 * `/accounts` does not return the encrypted hash, and `/accounts/accountNumbers`
 * does, so both are needed: one for the data, one for the stable id to link
 * against. They are matched on the plain account number, which never leaves the
 * server — only the masked last four is stored.
 */
export async function fetchAccounts(): Promise<AccountFetchResult> {
  const numbers = await endpoints.accountNumbers((raw) => recordRaw('accountNumbers', raw));
  const hashByNumber = new Map<string, string>();
  for (const entry of numbers ?? []) {
    if (entry?.accountNumber && entry?.hashValue) hashByNumber.set(entry.accountNumber, entry.hashValue);
  }

  const envelopes = await endpoints.accountsWithPositions((raw) => recordRaw('accounts', raw));

  const accounts: MappedAccount[] = [];
  const warnings: string[] = [];

  for (const envelope of (envelopes ?? []) as RawAccountEnvelope[]) {
    const accountNumber = envelope?.securitiesAccount?.accountNumber ?? '';
    const hash = hashByNumber.get(accountNumber);
    if (!hash) {
      warnings.push(
        `An account came back without a matching hash and was skipped. Reconnect if this persists.`,
      );
      continue;
    }
    const mapped = mapAccount(envelope, hash);
    warnings.push(...mapped.warnings);
    if (mapped.value) accounts.push(mapped.value);
  }

  if (accounts.length === 0 && warnings.length === 0) {
    warnings.push('Schwab returned no accounts. Check that the app is approved for the Accounts and Trading product.');
  }

  return { accounts, warnings };
}

export async function fetchSyncPlan(store: PortfolioStore): Promise<SyncPlan> {
  const { accounts, warnings } = await fetchAccounts();
  return buildSyncPlan({ store, accounts, warnings });
}

// --- market data ----------------------------------------------------------

export interface InstrumentUpdate {
  symbol: string;
  price?: { before: number; after: number };
  dividendYield?: { before: number; after: number };
  surface?: {
    before: Pick<Instrument, 'ivAtm30' | 'skewSlope' | 'skewCurvature' | 'termSlope'>;
    after: Pick<Instrument, 'ivAtm30' | 'skewSlope' | 'skewCurvature' | 'termSlope'>;
    rmseVolPoints: number;
    samples: number;
    expiries: number;
  };
}

export interface ContractMark {
  positionId: string;
  externalSymbol: string;
  iv: number | null;
  mark: number | null;
  before: number | undefined;
}

export interface MarketDataResult {
  instruments: InstrumentUpdate[];
  contracts: ContractMark[];
  warnings: string[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Refresh prices, per-contract implied vols, and the fitted surface.
 *
 * Chain calls are the expensive part, so they are targeted: one window around
 * 2–11 weeks out to calibrate the surface, plus one per held expiry that falls
 * outside that window so every contract actually held gets a real mark.
 */
export async function fetchMarketData(store: PortfolioStore): Promise<MarketDataResult> {
  const warnings: string[] = [];
  const instruments: InstrumentUpdate[] = [];
  const contracts: ContractMark[] = [];

  const symbols = store.instruments.map((i) => i.symbol);
  if (symbols.length === 0) return { instruments, contracts, warnings: ['No tickers to refresh.'] };

  // Quotes: one call covers every ticker.
  try {
    const raw = await endpoints.quotes(symbols, (r) => recordRaw('quotes', r));
    const mapped = mapQuotes(raw as Record<string, RawQuote>);
    warnings.push(...mapped.warnings);

    for (const quote of mapped.value) {
      const instrument = store.instruments.find((i) => i.symbol === quote.symbol);
      if (!instrument) continue;
      const update: InstrumentUpdate = { symbol: quote.symbol };
      if (Math.abs(instrument.price - quote.price) > 0.0001) {
        update.price = { before: instrument.price, after: quote.price };
      }
      if (quote.dividendYield !== null && Math.abs(instrument.dividendYield - quote.dividendYield) > 0.00005) {
        update.dividendYield = { before: instrument.dividendYield, after: quote.dividendYield };
      }
      if (update.price || update.dividendYield) instruments.push(update);
    }
  } catch (err) {
    warnings.push(`Quotes failed: ${(err as Error).message}`);
  }

  // Chains for every ticker holding options, plus the market proxy whether or
  // not anything is held on it: its 30-day IV is what the whole vol-shock model
  // is anchored to, so leaving it as a typed guess would undermine every
  // scenario even when the rest of the book is live.
  const optionsBySymbol = new Map<string, OptionPosition[]>();
  for (const p of store.positions) {
    if (p.kind !== 'OPTION') continue;
    if (!optionsBySymbol.has(p.symbol)) optionsBySymbol.set(p.symbol, []);
    optionsBySymbol.get(p.symbol)!.push(p);
  }
  for (const anchor of [store.settings.marketSymbol, store.settings.betaWeightSymbol]) {
    if (anchor && store.instruments.some((i) => i.symbol === anchor) && !optionsBySymbol.has(anchor)) {
      optionsBySymbol.set(anchor, []);
    }
  }

  const now = new Date();
  const fitFrom = isoDate(new Date(now.getTime() + 14 * 86400000));
  const fitTo = isoDate(new Date(now.getTime() + 75 * 86400000));

  for (const [symbol, held] of optionsBySymbol) {
    const instrument = store.instruments.find((i) => i.symbol === symbol);
    if (!instrument) continue;

    const spot =
      instruments.find((u) => u.symbol === symbol)?.price?.after ?? instrument.price;
    if (!(spot > 0)) {
      warnings.push(`${symbol}: no price, so the surface could not be calibrated.`);
      continue;
    }

    const windows: { fromDate: string; toDate: string; strikeCount?: number }[] = [
      { fromDate: fitFrom, toDate: fitTo, strikeCount: 40 },
    ];
    for (const expiry of new Set(held.map((p) => p.expiry))) {
      if (expiry >= fitFrom && expiry <= fitTo) continue;
      if (yearsToExpiry(expiry, now) <= 0) continue;
      windows.push({ fromDate: expiry, toDate: expiry });
    }

    const allContracts: ChainContract[] = [];
    let interestRate: number | null = null;

    for (const window of windows) {
      try {
        const raw = await endpoints.chain(symbol, window, (r) => recordRaw(`chain:${symbol}`, r));
        const mapped = mapChain(raw as RawOptionChain);
        warnings.push(...mapped.warnings);
        if (!mapped.value) continue;
        allContracts.push(...mapped.value.contracts);
        if (interestRate === null && mapped.value.interestRate !== null) {
          interestRate = mapped.value.interestRate;
        }
      } catch (err) {
        warnings.push(`${symbol} chain (${window.fromDate}…${window.toDate}) failed: ${(err as Error).message}`);
      }
    }

    if (allContracts.length === 0) continue;

    // Per-contract marks for positions actually held.
    const bySymbol = new Map(allContracts.map((c) => [c.symbol.trim().toUpperCase(), c]));
    for (const position of held) {
      const key = (position.externalSymbol ?? '').trim().toUpperCase();
      const match =
        (key && bySymbol.get(key)) ||
        allContracts.find(
          (c) => c.right === position.right && Math.abs(c.strike - position.strike) < 1e-6 && c.expiry === position.expiry,
        );
      if (!match) continue;
      contracts.push({
        positionId: position.id,
        externalSymbol: match.symbol,
        iv: match.iv,
        mark: match.mark,
        before: position.markIv,
      });
    }

    // Calibrate the surface against everything the chain returned.
    const fit = fitSurface(allContracts, {
      spot,
      rate: interestRate !== null && interestRate > 0 ? interestRate / 100 : store.settings.riskFreeRate,
      dividendYield: instrument.dividendYield,
      minOpenInterest: 1,
    });

    if (!fit) {
      warnings.push(`${symbol}: not enough quoted strikes to calibrate a surface — parameters left as they are.`);
      continue;
    }

    const before = {
      ivAtm30: instrument.ivAtm30,
      skewSlope: instrument.skewSlope,
      skewCurvature: instrument.skewCurvature,
      termSlope: instrument.termSlope,
    };
    const after = {
      ivAtm30: fit.ivAtm30,
      skewSlope: fit.skewSlope,
      skewCurvature: fit.skewCurvature,
      termSlope: fit.termSlope,
    };

    let update = instruments.find((u) => u.symbol === symbol);
    if (!update) {
      update = { symbol };
      instruments.push(update);
    }
    update.surface = {
      before,
      after,
      rmseVolPoints: fit.rmseVolPoints,
      samples: fit.samples,
      expiries: fit.expiries,
    };
  }

  return { instruments, contracts, warnings };
}

export interface ApplyMarketDataResult {
  pricesUpdated: number;
  surfacesFitted: number;
  contractsMarked: number;
}

export function applyMarketData(
  store: PortfolioStore,
  data: MarketDataResult,
  accepted?: Set<string>,
): ApplyMarketDataResult {
  const result: ApplyMarketDataResult = { pricesUpdated: 0, surfacesFitted: 0, contractsMarked: 0 };
  const take = (symbol: string) => (accepted ? accepted.has(symbol) : true);

  for (const update of data.instruments) {
    if (!take(update.symbol)) continue;
    const instrument = store.instruments.find((i) => i.symbol === update.symbol);
    if (!instrument) continue;

    if (update.price) {
      instrument.price = update.price.after;
      result.pricesUpdated++;
    }
    if (update.dividendYield) instrument.dividendYield = update.dividendYield.after;

    if (update.surface) {
      Object.assign(instrument, update.surface.after);
      instrument.surfaceFit = {
        rmseVolPoints: update.surface.rmseVolPoints,
        samples: update.surface.samples,
        expiries: update.surface.expiries,
        fittedAt: new Date().toISOString(),
      };
      result.surfacesFitted++;
    }

    instrument.source = 'SCHWAB';
    instrument.updatedAt = new Date().toISOString();
  }

  for (const mark of data.contracts) {
    const position = store.positions.find((p) => p.id === mark.positionId);
    if (!position || position.kind !== 'OPTION') continue;
    if (!take(position.symbol)) continue;
    if (mark.iv !== null) position.markIv = mark.iv;
    if (mark.mark !== null) position.markPrice = mark.mark;
    position.externalSymbol = mark.externalSymbol;
    result.contractsMarked++;
  }

  return result;
}
