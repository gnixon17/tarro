/**
 * Authenticated Schwab API client.
 *
 * Refreshes the access token before it lapses, rate-limits to stay inside
 * Schwab's per-minute budget, and retries transient failures with backoff. A
 * 401 triggers exactly one forced refresh and retry — more than that means the
 * refresh token is gone and the user has to reconnect.
 */
import { API_BASE, readConfig, refreshTokens, type SchwabConfig } from './oauth';
import { loadTokens, type StoredTokens } from './tokens';

/** Schwab allows roughly 120 requests/minute per app; stay well under. */
const MAX_REQUESTS_PER_MINUTE = 90;
const MIN_INTERVAL_MS = 60_000 / MAX_REQUESTS_PER_MINUTE;
/** Refresh this long before the access token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

export class SchwabAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchwabAuthError';
  }
}

let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Serialise and space out requests so a wide sync cannot trip the rate limit. */
function scheduled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

async function currentTokens(config: SchwabConfig, force = false): Promise<StoredTokens> {
  const tokens = await loadTokens();
  if (!tokens) throw new SchwabAuthError('Not connected to Schwab.');

  if (Date.now() >= tokens.refreshExpiresAt) {
    throw new SchwabAuthError(
      'The Schwab connection expired. Refresh tokens last seven days and cannot be extended — reconnect.',
    );
  }

  if (force || Date.now() >= tokens.accessExpiresAt - REFRESH_MARGIN_MS) {
    return refreshTokens(config, tokens.refreshToken);
  }
  return tokens;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  /** Capture the raw body for the payload inspector. */
  onRaw?: (raw: unknown) => void;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function schwabGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const config = readConfig();
  if (!config) {
    throw new SchwabAuthError('SCHWAB_APP_KEY and SCHWAB_APP_SECRET are not set on the server.');
  }

  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  let forceRefresh = false;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const tokens = await currentTokens(config, forceRefresh);
    forceRefresh = false;

    const res = await scheduled(() =>
      fetch(url.toString(), {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      }),
    );

    if (res.status === 401 && attempt === 0) {
      forceRefresh = true;
      continue;
    }

    if (RETRYABLE.has(res.status) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt + Math.random() * 250;
      lastError = new Error(`Schwab returned ${res.status}`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new SchwabAuthError(
          `Schwab refused the request (${res.status}). Check that the app is approved for both the Accounts and Market Data products.`,
        );
      }
      throw new Error(`Schwab ${res.status} on ${url.pathname}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as T;
    options.onRaw?.(json);
    return json;
  }

  throw lastError ?? new Error('Schwab request failed after retries.');
}

// --- endpoints ------------------------------------------------------------

export interface AccountNumberEntry {
  accountNumber?: string;
  hashValue?: string;
}

export const endpoints = {
  accountNumbers: (onRaw?: RequestOptions['onRaw']) =>
    schwabGet<AccountNumberEntry[]>('/trader/v1/accounts/accountNumbers', { onRaw }),

  accountsWithPositions: (onRaw?: RequestOptions['onRaw']) =>
    schwabGet<unknown[]>('/trader/v1/accounts', { query: { fields: 'positions' }, onRaw }),

  quotes: (symbols: string[], onRaw?: RequestOptions['onRaw']) =>
    schwabGet<Record<string, unknown>>('/marketdata/v1/quotes', {
      query: { symbols: symbols.join(','), fields: 'quote,fundamental' },
      onRaw,
    }),

  chain: (
    symbol: string,
    opts: { fromDate?: string; toDate?: string; strikeCount?: number } = {},
    onRaw?: RequestOptions['onRaw'],
  ) =>
    schwabGet<unknown>('/marketdata/v1/chains', {
      query: {
        symbol,
        contractType: 'ALL',
        fromDate: opts.fromDate,
        toDate: opts.toDate,
        strikeCount: opts.strikeCount,
      },
      onRaw,
    }),
};
