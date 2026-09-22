/**
 * Request guard for the API.
 *
 * The API has no login — it is a single-user local tool — so "the browser sent
 * it" is not evidence that the user meant it. Two checks close the gap:
 *
 *   1. A host allowlist, so a DNS-rebinding page cannot point a name it
 *      controls at 127.0.0.1 and talk to the API from its own origin. The
 *      /api routes are mounted ahead of Vite's middleware, so they do not get
 *      Vite's own host checking.
 *   2. An Origin check on anything that changes state. Browsers send `Origin`
 *      on every cross-site POST, including plain HTML form submissions — which
 *      are "simple requests" and so are never preflighted. Without this, a page
 *      the user merely visits can POST to localhost and wipe the portfolio or
 *      spend the broker session.
 */
import type express from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Strip the port and normalise, so "localhost:3000" matches "localhost". */
function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  const colon = value.lastIndexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/** `null` means the allowlist is disabled. */
function allowedHosts(): Set<string> | null {
  const configured = process.env.TARRO_ALLOWED_HOSTS?.trim();
  if (configured === '*') return null;
  const extra = configured ? configured.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : [];
  return new Set([...DEFAULT_HOSTS, ...extra]);
}

export function requestGuard(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const allowed = allowedHosts();
  if (allowed) {
    const host = hostnameOf(req.headers.host);
    if (!host || !allowed.has(host)) {
      res.status(403).json({
        error:
          `This API only answers requests addressed to localhost. Set TARRO_ALLOWED_HOSTS to add another name, or "*" to turn the check off.`,
      });
      return;
    }
  }

  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      res.status(403).json({ error: 'Malformed Origin header.' });
      return;
    }
    if (originHost !== String(req.headers.host ?? '').toLowerCase()) {
      res.status(403).json({ error: 'Cross-site requests are not accepted by this API.' });
      return;
    }
    next();
    return;
  }

  // No Origin at all. A browser always sends one on a cross-site POST, so this
  // is a non-browser client (curl, a script) — allowed. If the browser did tell
  // us the request was cross-site, believe that instead.
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'Cross-site requests are not accepted by this API.' });
    return;
  }

  next();
}
