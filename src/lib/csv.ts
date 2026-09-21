/**
 * CSV import for positions.
 *
 * Deliberately forgiving about column order and case, and strict about what it
 * will silently accept: an unknown account or ticker is reported, never guessed.
 */
import type { PortfolioStore, Position } from './types';

export const POSITION_CSV_TEMPLATE = `account,symbol,kind,quantity,cost,right,strike,expiry,multiplier,iv
Main brokerage,NVDA,shares,800,61.40,,,,,
Main brokerage,NVDA,option,8,18.40,put,155,2027-01-15,100,46
Main brokerage,NVDA,option,-8,16.10,call,230,2027-01-15,100,42`;

export interface CsvImportResult {
  positions: Partial<Position>[];
  errors: string[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

export function parsePositionsCsv(text: string, store: PortfolioStore): CsvImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { positions: [], errors: ['Need a header row and at least one data row.'] };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ['account', 'symbol', 'kind', 'quantity', 'cost'];
  const missing = required.filter((name) => col(name) === -1);
  if (missing.length) return { positions: [], errors: [`Missing column(s): ${missing.join(', ')}`] };

  const accountsByName = new Map(store.accounts.map((a) => [a.name.toLowerCase(), a.id]));
  const accountIds = new Set(store.accounts.map((a) => a.id));
  const symbols = new Set(store.instruments.map((i) => i.symbol));

  const positions: Partial<Position>[] = [];
  const errors: string[] = [];

  for (let n = 1; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n]);
    const get = (name: string) => (col(name) === -1 ? '' : cells[col(name)] ?? '');
    const where = `row ${n + 1}`;

    const accountRaw = get('account');
    const accountId = accountsByName.get(accountRaw.toLowerCase()) ?? (accountIds.has(accountRaw) ? accountRaw : null);
    if (!accountId) {
      errors.push(`${where}: no account named “${accountRaw}”`);
      continue;
    }

    const symbol = get('symbol').toUpperCase();
    if (!symbols.has(symbol)) {
      errors.push(`${where}: ${symbol} is not in Market data`);
      continue;
    }

    const quantity = Number(get('quantity'));
    const costBasis = Number(get('cost'));
    if (!Number.isFinite(quantity) || quantity === 0) {
      errors.push(`${where}: quantity must be a non-zero number`);
      continue;
    }
    if (!Number.isFinite(costBasis)) {
      errors.push(`${where}: cost must be a number`);
      continue;
    }

    const kind = get('kind').toLowerCase();
    if (kind.startsWith('share') || kind === 'equity' || kind === 'stock') {
      positions.push({ kind: 'EQUITY', accountId, symbol, quantity, costBasis });
      continue;
    }

    if (kind !== 'option' && kind !== 'opt') {
      errors.push(`${where}: kind must be “shares” or “option”, got “${kind}”`);
      continue;
    }

    const rightRaw = get('right').toLowerCase();
    const right = rightRaw.startsWith('c') ? 'CALL' : rightRaw.startsWith('p') ? 'PUT' : null;
    const strike = Number(get('strike'));
    const expiry = get('expiry');
    if (!right) {
      errors.push(`${where}: right must be call or put`);
      continue;
    }
    if (!Number.isFinite(strike) || strike <= 0) {
      errors.push(`${where}: strike must be a positive number`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      errors.push(`${where}: expiry must be YYYY-MM-DD`);
      continue;
    }

    const multiplier = Number(get('multiplier')) || 100;
    const ivRaw = Number(get('iv'));
    // Accept either "46" (vol points) or "0.46" (decimal).
    const markIv = Number.isFinite(ivRaw) && ivRaw > 0 ? (ivRaw > 3 ? ivRaw / 100 : ivRaw) : undefined;

    positions.push({ kind: 'OPTION', accountId, symbol, quantity, costBasis, right, strike, expiry, multiplier, markIv });
  }

  return { positions, errors };
}
