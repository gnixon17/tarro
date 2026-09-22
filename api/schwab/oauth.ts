/**
 * Schwab OAuth 2.0.
 *
 * Endpoints and lifetimes are Schwab's published ones:
 *   authorize  https://api.schwabapi.com/v1/oauth/authorize
 *   token      https://api.schwabapi.com/v1/oauth/token
 *
 * The access token lasts 30 minutes and is refreshed automatically. The refresh
 * token lasts SEVEN DAYS and cannot be extended — there is no way around a
 * weekly re-authorisation, so the app surfaces the deadline rather than
 * pretending the connection is permanent.
 */
import crypto from 'node:crypto';
import { saveTokens, type StoredTokens } from './tokens';

/**
 * Overridable so the integration tests can point the whole client at a local
 * stand-in for Schwab. Unset in normal use.
 */
const ORIGIN = process.env.SCHWAB_API_BASE ?? 'https://api.schwabapi.com';

export const AUTHORIZE_URL = `${ORIGIN}/v1/oauth/authorize`;
export const TOKEN_URL = `${ORIGIN}/v1/oauth/token`;
export const API_BASE = ORIGIN;

const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SchwabConfig {
  appKey: string;
  appSecret: string;
  redirectUri: string;
}

export function readConfig(): SchwabConfig | null {
  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI ?? 'https://127.0.0.1:3000/api/schwab/callback';
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret, redirectUri };
}

/** In-memory CSRF state. A restart invalidates a half-finished login, which is correct. */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 15 * 60 * 1000;

export function createAuthorizeUrl(config: SchwabConfig): { url: string; state: string } {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + STATE_TTL_MS);

  for (const [key, expiry] of pendingStates) {
    if (expiry < Date.now()) pendingStates.delete(key);
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.appKey);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  return { url: url.toString(), state };
}

export function consumeState(state: string | undefined): boolean {
  if (!state) return false;
  const expiry = pendingStates.get(state);
  if (expiry === undefined) return false;
  pendingStates.delete(state);
  return expiry >= Date.now();
}

function basicAuth(config: SchwabConfig): string {
  return Buffer.from(`${config.appKey}:${config.appSecret}`).toString('base64');
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(config: SchwabConfig, body: URLSearchParams): Promise<StoredTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok || !json.access_token || !json.refresh_token) {
    const reason = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    // invalid_client on a refresh almost always means the 7-day window lapsed.
    throw new Error(
      reason === 'invalid_client'
        ? 'Schwab rejected the credentials. If you were connected before, the 7-day refresh token has expired — reconnect.'
        : `Schwab token request failed: ${reason}`,
    );
  }

  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessExpiresAt: now + (json.expires_in ? json.expires_in * 1000 : ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
    createdAt: now,
    scope: json.scope,
  };
}

/** Exchange the authorization code for tokens and persist them. */
export async function exchangeCode(config: SchwabConfig, code: string): Promise<StoredTokens> {
  const tokens = await postToken(
    config,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  );
  await saveTokens(tokens);
  return tokens;
}

export async function refreshTokens(config: SchwabConfig, refreshToken: string): Promise<StoredTokens> {
  const tokens = await postToken(
    config,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  );
  await saveTokens(tokens);
  return tokens;
}

/**
 * Pull `code` and `state` out of whatever the user pasted back.
 *
 * Schwab requires an HTTPS callback, which a local HTTP dev server cannot
 * serve, so the supported path is: authorise in the browser, then copy the
 * address bar — a URL that failed to load but carries the code — and paste it
 * here. Accepts a full URL, a bare query string, or just the code.
 */
export function parseCallbackInput(input: string): { code: string; state?: string } | null {
  const text = input.trim();
  if (!text) return null;

  const fromQuery = (query: string) => {
    const params = new URLSearchParams(query);
    const code = params.get('code');
    return code ? { code, state: params.get('state') ?? undefined } : null;
  };

  // A pasted URL, or a bare query string. Either way the code has to be IN it:
  // falling through to "treat the whole thing as the code" would turn a denied
  // authorization (?error=access_denied) into a nonsense code that only fails
  // later, at the token endpoint, with a confusing message.
  if (/^https?:\/\//i.test(text)) {
    const queryStart = text.indexOf('?');
    return queryStart === -1 ? null : fromQuery(text.slice(queryStart + 1));
  }
  if (text.includes('=') || text.includes('?') || text.includes('&')) {
    return fromQuery(text.replace(/^[?#]/, ''));
  }

  // A bare code, pasted on its own.
  return /^[A-Za-z0-9._~@/+-]+$/.test(text) ? { code: text } : null;
}
