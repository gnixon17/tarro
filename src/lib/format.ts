/** Display formatting. Kept in one place so tables and charts agree. */

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function money(value: number, decimals: 0 | 2 = 0): string {
  if (!Number.isFinite(value)) return '—';
  return decimals === 0 ? usd0.format(value) : usd2.format(value);
}

export function signedMoney(value: number, decimals: 0 | 2 = 0): string {
  if (!Number.isFinite(value)) return '—';
  const s = money(Math.abs(value), decimals);
  return value < 0 ? `−${s}` : `+${s}`;
}

export function compactMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${num2.format(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${num0.format(abs / 1_000)}k`;
  return `${sign}$${num0.format(abs)}`;
}

export function percent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function signedPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(decimals)}%`;
}

export function volPoints(vol: number): string {
  if (!Number.isFinite(vol)) return '—';
  return `${(vol * 100).toFixed(1)}`;
}

export function number(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function shares(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** "NVDA 2027-01-15 140 P" */
export function optionLabel(o: { symbol: string; expiry: string; strike: number; right: string }): string {
  return `${o.symbol} ${o.expiry} ${o.strike} ${o.right === 'CALL' ? 'C' : 'P'}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dteLabel(days: number): string {
  if (days <= 0) return 'expired';
  if (days < 45) return `${Math.round(days)}d`;
  if (days < 400) return `${Math.round(days)}d (${(days / 30.44).toFixed(1)}mo)`;
  return `${Math.round(days)}d (${(days / 365).toFixed(1)}y)`;
}
