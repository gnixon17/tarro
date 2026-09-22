/**
 * Diff what the broker reports against what Tarro holds, and produce a plan.
 *
 * Nothing is applied here. A sync at this account size must be reviewable
 * before it runs, so this returns a list of proposed changes the user can
 * accept or reject one by one, and `applySyncPlan` only acts on what was
 * accepted.
 *
 * Two rules keep it safe:
 *   - A position entered by hand is never closed by a sync. If the broker
 *     reports the same contract, the existing row is *adopted* rather than
 *     duplicated, keeping its strategy group and notes.
 *   - Only rows previously marked as coming from this broker, in a linked
 *     account, can be proposed for closing.
 */
import { newId } from '../id';
import { optionLabel } from '../format';
import type { MappedPosition } from './schwabMap';
import type { Account, Instrument, PortfolioStore, Position } from '../types';

export type ChangeKind = 'create' | 'update' | 'adopt' | 'close';

export interface PositionChange {
  /** Stable within a plan, used to accept or reject this one change. */
  key: string;
  kind: ChangeKind;
  accountId: string;
  label: string;
  /** Plain-language reason, shown in the review table. */
  detail: string;
  positionId?: string;
  draft?: Position;
  before?: { quantity: number; costBasis: number };
  after?: { quantity: number; costBasis: number };
}

export interface SyncPlan {
  changes: PositionChange[];
  /** Symbols held but absent from Market data; created with defaults on apply. */
  newInstruments: string[];
  /** Accounts at the broker with no Tarro account linked to them. */
  unlinkedAccounts: { externalId: string; externalLabel: string; marginType: string }[];
  /** Cash balances that differ from what Tarro holds. */
  cashUpdates: { accountId: string; before: number; after: number }[];
  warnings: string[];
  unchanged: number;
}

function positionKey(accountId: string, p: MappedPosition | Position): string {
  if (p.kind === 'EQUITY') return `${accountId}|EQUITY|${p.symbol}`;
  return `${accountId}|OPTION|${p.symbol}|${p.right}|${p.strike}|${p.expiry}`;
}

function describe(p: MappedPosition | Position): string {
  return p.kind === 'EQUITY' ? `${p.symbol} shares` : optionLabel(p);
}

const EPSILON = 1e-6;

export interface ReconcileInput {
  store: PortfolioStore;
  /** Broker accounts, already mapped, keyed by their external id. */
  accounts: {
    externalId: string;
    externalLabel: string;
    marginType: string;
    cash: number;
    positions: MappedPosition[];
  }[];
  warnings?: string[];
}

export function buildSyncPlan(input: ReconcileInput): SyncPlan {
  const { store } = input;
  const changes: PositionChange[] = [];
  const newInstruments = new Set<string>();
  const unlinkedAccounts: SyncPlan['unlinkedAccounts'] = [];
  const cashUpdates: SyncPlan['cashUpdates'] = [];
  const warnings = [...(input.warnings ?? [])];
  let unchanged = 0;

  const knownSymbols = new Set(store.instruments.map((i) => i.symbol));
  const accountByExternal = new Map<string, Account>();
  for (const account of store.accounts) {
    if (account.externalId) accountByExternal.set(account.externalId, account);
  }

  for (const incoming of input.accounts) {
    const account = accountByExternal.get(incoming.externalId);
    if (!account) {
      unlinkedAccounts.push({
        externalId: incoming.externalId,
        externalLabel: incoming.externalLabel,
        marginType: incoming.marginType,
      });
      continue;
    }

    if (Math.abs(account.cash - incoming.cash) > 0.005) {
      cashUpdates.push({ accountId: account.id, before: account.cash, after: incoming.cash });
    }

    const existing = store.positions.filter((p) => p.accountId === account.id);
    const existingByKey = new Map<string, Position>();
    for (const p of existing) existingByKey.set(positionKey(account.id, p), p);

    const seen = new Set<string>();

    for (const mapped of incoming.positions) {
      const key = positionKey(account.id, mapped);
      seen.add(key);
      if (!knownSymbols.has(mapped.symbol)) newInstruments.add(mapped.symbol);

      const current = existingByKey.get(key);

      if (!current) {
        changes.push({
          key,
          kind: 'create',
          accountId: account.id,
          label: describe(mapped),
          detail: `New at ${account.name}: ${mapped.quantity > 0 ? 'long' : 'short'} ${Math.abs(mapped.quantity)}`,
          draft: draftFrom(mapped, account.id),
          after: { quantity: mapped.quantity, costBasis: mapped.costBasis },
        });
        continue;
      }

      const quantityChanged = Math.abs(current.quantity - mapped.quantity) > EPSILON;
      const costChanged = Math.abs(current.costBasis - mapped.costBasis) > 0.005;
      const isManual = (current.source ?? 'MANUAL') === 'MANUAL';

      if (!quantityChanged && !costChanged && !isManual) {
        unchanged++;
        continue;
      }

      const before = { quantity: current.quantity, costBasis: current.costBasis };
      const after = { quantity: mapped.quantity, costBasis: mapped.costBasis };

      changes.push({
        key,
        kind: isManual ? 'adopt' : 'update',
        accountId: account.id,
        label: describe(mapped),
        positionId: current.id,
        detail: isManual
          ? 'Entered by hand and also held at the broker — link it and take the broker’s quantity and cost.'
          : changeDetail(before, after),
        draft: { ...current, ...draftFrom(mapped, account.id), id: current.id, groupId: current.groupId ?? null, notes: current.notes, openedAt: current.openedAt },
        before,
        after,
      });
    }

    // Anything the broker no longer reports. Only rows this sync created are
    // eligible: a hand-entered position stays put.
    for (const [key, position] of existingByKey) {
      if (seen.has(key)) continue;
      if ((position.source ?? 'MANUAL') === 'MANUAL') continue;
      changes.push({
        key,
        kind: 'close',
        accountId: account.id,
        label: describe(position),
        positionId: position.id,
        detail: `No longer held at ${account.name}. Closed, expired or assigned.`,
        before: { quantity: position.quantity, costBasis: position.costBasis },
      });
    }
  }

  return {
    changes,
    newInstruments: [...newInstruments].sort(),
    unlinkedAccounts,
    cashUpdates,
    warnings,
    unchanged,
  };
}

function changeDetail(before: { quantity: number }, after: { quantity: number }): string {
  if (before.quantity === after.quantity) return 'Cost basis changed.';
  const delta = after.quantity - before.quantity;
  return `Quantity ${before.quantity} → ${after.quantity} (${delta > 0 ? '+' : ''}${delta}).`;
}

function draftFrom(mapped: MappedPosition, accountId: string): Position {
  const base = {
    id: newId('pos'),
    accountId,
    symbol: mapped.symbol,
    quantity: mapped.quantity,
    costBasis: mapped.costBasis,
    source: 'SCHWAB' as const,
    externalSymbol: mapped.externalSymbol,
    groupId: null,
  };
  if (mapped.kind === 'EQUITY') return { ...base, kind: 'EQUITY' };
  return {
    ...base,
    kind: 'OPTION',
    right: mapped.right,
    strike: mapped.strike,
    expiry: mapped.expiry,
    multiplier: mapped.multiplier,
  };
}

/**
 * Defaults for a ticker we hold but have no market assumptions for.
 *
 * Flagged for review because a broker reports positions and prices but not
 * beta, and beta is what propagates a market shock to this name. A silent 1.0
 * on a high-beta holding understates every stress test with nothing on screen
 * looking wrong.
 */
export function defaultInstrument(symbol: string): Instrument {
  return {
    symbol,
    name: symbol,
    price: 0,
    dividendYield: 0,
    beta: 1,
    ivAtm30: 0.3,
    volBeta: 1,
    skewSlope: -0.06,
    skewCurvature: 0.04,
    termSlope: 0.01,
    source: 'SCHWAB',
    needsReview: true,
  };
}

export interface ApplyResult {
  created: number;
  updated: number;
  adopted: number;
  closed: number;
  instrumentsCreated: number;
  cashUpdated: number;
}

/**
 * Apply the accepted subset of a plan, in place.
 *
 * `acceptedKeys` being undefined means "everything except closes" — the safe
 * default, since a close is the only destructive operation here.
 */
export function applySyncPlan(
  store: PortfolioStore,
  plan: SyncPlan,
  acceptedKeys?: Set<string>,
): ApplyResult {
  const accepted = (change: PositionChange) =>
    acceptedKeys ? acceptedKeys.has(change.key) : change.kind !== 'close';

  const result: ApplyResult = {
    created: 0, updated: 0, adopted: 0, closed: 0, instrumentsCreated: 0, cashUpdated: 0,
  };

  const known = new Set(store.instruments.map((i) => i.symbol));
  for (const symbol of plan.newInstruments) {
    if (known.has(symbol)) continue;
    // Only add a ticker if something referencing it is actually being applied.
    const needed = plan.changes.some(
      (c) => accepted(c) && c.kind !== 'close' && c.draft?.symbol === symbol,
    );
    if (!needed) continue;
    store.instruments.push(defaultInstrument(symbol));
    known.add(symbol);
    result.instrumentsCreated++;
  }

  for (const change of plan.changes) {
    if (!accepted(change)) continue;

    if (change.kind === 'create' && change.draft) {
      store.positions.push(change.draft);
      result.created++;
      continue;
    }

    if ((change.kind === 'update' || change.kind === 'adopt') && change.positionId && change.draft) {
      const index = store.positions.findIndex((p) => p.id === change.positionId);
      if (index === -1) continue;
      store.positions[index] = change.draft;
      if (change.kind === 'adopt') result.adopted++;
      else result.updated++;
      continue;
    }

    if (change.kind === 'close' && change.positionId) {
      const index = store.positions.findIndex((p) => p.id === change.positionId);
      if (index === -1) continue;
      store.positions.splice(index, 1);
      result.closed++;
    }
  }

  for (const update of plan.cashUpdates) {
    const account = store.accounts.find((a) => a.id === update.accountId);
    if (!account) continue;
    account.cash = update.after;
    result.cashUpdated++;
  }

  const syncedAt = new Date().toISOString();
  for (const account of store.accounts) {
    if (account.externalId) account.lastSyncedAt = syncedAt;
  }

  return result;
}
