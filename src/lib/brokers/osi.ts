/**
 * OSI option symbols — the 21-character format Schwab uses.
 *
 *   AAPL  270115C00190000
 *   |     |     |        |
 *   root  YYMMDD C/P     strike x 1000, 8 digits
 *   (6, space-padded)
 *
 * Schwab's position payload gives `putCall` and `underlyingSymbol` but not the
 * strike or expiry as fields, so they have to come out of the symbol. Parsing
 * is strict: a symbol that does not match returns null rather than a guess,
 * because a mis-parsed strike silently corrupts a position.
 */
import type { OptionRight } from '../types';

export interface ParsedOptionSymbol {
  underlying: string;
  /** ISO date, e.g. "2027-01-15". */
  expiry: string;
  right: OptionRight;
  strike: number;
}

const OSI = /^([A-Z0-9.$^/-]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  if (typeof symbol !== 'string') return null;
  const match = OSI.exec(symbol.trim().toUpperCase());
  if (!match) return null;

  const [, root, yy, mm, dd, right, strikeDigits] = match;

  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject dates the calendar does not have (Feb 30, say) rather than letting
  // Date roll them forward into a different expiry.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  const strike = Number(strikeDigits) / 1000;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  return {
    underlying: root,
    expiry: date.toISOString().slice(0, 10),
    right: right === 'C' ? 'CALL' : 'PUT',
    strike,
  };
}

export function formatOptionSymbol(p: ParsedOptionSymbol): string {
  const [year, month, day] = p.expiry.split('-');
  const strike = String(Math.round(p.strike * 1000)).padStart(8, '0');
  return `${p.underlying.padEnd(6, ' ')}${year.slice(2)}${month}${day}${p.right === 'CALL' ? 'C' : 'P'}${strike}`;
}

export function isOptionSymbol(symbol: string): boolean {
  return parseOptionSymbol(symbol) !== null;
}
