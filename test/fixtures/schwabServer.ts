/**
 * A stand-in for Schwab, shaped like the published schemas.
 *
 * Lets the integration tests drive the real client, mapper, surface fit and
 * reconciler end to end — including token refresh, a 401 retry, and rate-limit
 * backoff — without credentials.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockOptions {
  /** Fail the first N data requests with this status, to exercise retries. */
  failFirst?: { count: number; status: number };
  /** Reject the access token once, forcing a refresh. */
  expireTokenOnce?: boolean;
  /** Fixed port, for the dev script. Tests use an ephemeral one. */
  port?: number;
}

export interface MockServer {
  origin: string;
  close: () => Promise<void>;
  requests: string[];
  tokenGrants: string[];
}

const ACCOUNTS = [
  { accountNumber: '11112222', hashValue: 'HASH_TAXABLE' },
  { accountNumber: '33334444', hashValue: 'HASH_IRA' },
];

function positionsForTaxable() {
  return [
    {
      instrument: { assetType: 'EQUITY', symbol: 'NVDA', description: 'NVIDIA CORP', cusip: '67066G104' },
      longQuantity: 800, shortQuantity: 0, averagePrice: 61.4, marketValue: 142400,
    },
    {
      instrument: {
        assetType: 'OPTION', symbol: 'NVDA  270115P00155000',
        putCall: 'PUT', underlyingSymbol: 'NVDA', optionMultiplier: 100,
        description: 'NVDA Jan 15 2027 155 Put',
      },
      longQuantity: 8, shortQuantity: 0, averagePrice: 18.4, marketValue: 5887,
    },
    {
      instrument: {
        assetType: 'OPTION', symbol: 'NVDA  270115C00230000',
        putCall: 'CALL', underlyingSymbol: 'NVDA', optionMultiplier: 100,
      },
      longQuantity: 0, shortQuantity: 8, averagePrice: 16.1, marketValue: -3002,
    },
    {
      instrument: { assetType: 'COLLECTIVE_INVESTMENT', symbol: 'VTI' },
      longQuantity: 400, shortQuantity: 0, averagePrice: 244, marketValue: 126000,
    },
    // Deliberately unmodellable, to prove it is reported rather than dropped.
    {
      instrument: { assetType: 'FIXED_INCOME', symbol: '912828YS3' },
      longQuantity: 50, shortQuantity: 0, averagePrice: 98.2,
    },
  ];
}

/** A chain with a real skew, so the surface fit has something to recover. */
function buildChain(symbol: string, spot: number) {
  const callExpDateMap: Record<string, Record<string, unknown[]>> = {};
  const putExpDateMap: Record<string, Record<string, unknown[]>> = {};

  const expiries = [
    { date: '2026-11-20', days: 59 },
    { date: '2027-01-15', days: 115 },
  ];

  for (const { date, days } of expiries) {
    const t = days / 365;
    const key = `${date}:${days}`;
    callExpDateMap[key] = {};
    putExpDateMap[key] = {};

    // Real chains are listed on standard increments, not percentages off spot,
    // so a held 155 strike has to actually exist in the grid.
    const increment = spot < 100 ? 2.5 : 5;
    const low = Math.floor((spot * 0.55) / increment) * increment;
    const high = Math.ceil((spot * 1.45) / increment) * increment;

    for (let strike = low; strike <= high; strike += increment) {
      const m = Math.log(strike / spot) / Math.sqrt(t);
      // 44 vol at the money, negative skew, a little smile.
      const ivPercent = (0.44 - 0.05 * m + 0.06 * m * m) * 100;
      const yy = date.slice(2, 4).replace('-', '');
      const osi = `${symbol.padEnd(6, ' ')}${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
      const strikeCode = String(Math.round(strike * 1000)).padStart(8, '0');

      const base = {
        strikePrice: strike,
        expirationDate: `${date}T21:00:00.000Z`,
        daysToExpiration: days,
        multiplier: 100,
        volatility: ivPercent,
        openInterest: 500,
        totalVolume: 25,
        markPrice: 5,
        bidPrice: 4.9,
        askPrice: 5.1,
      };
      void yy;

      callExpDateMap[key][strike.toFixed(1)] = [
        { ...base, putCall: 'CALL', symbol: `${osi}C${strikeCode}`, delta: 0.4 },
      ];
      putExpDateMap[key][strike.toFixed(1)] = [
        { ...base, putCall: 'PUT', symbol: `${osi}P${strikeCode}`, delta: -0.4 },
      ];
    }
  }

  return {
    symbol,
    status: 'SUCCESS',
    underlyingPrice: spot,
    interestRate: 4.2,
    isIndex: false,
    numberOfContracts: 60,
    callExpDateMap,
    putExpDateMap,
  };
}

const QUOTES: Record<string, { price: number; divYield?: number }> = {
  NVDA: { price: 181.25 },
  VTI: { price: 318.4, divYield: 1.31 },
  SPY: { price: 645.1, divYield: 1.18 },
};

export async function startMockSchwab(options: MockOptions = {}): Promise<MockServer> {
  const requests: string[] = [];
  const tokenGrants: string[] = [];
  let failures = options.failFirst?.count ?? 0;
  let tokenStillExpired = options.expireTokenOnce ?? false;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/v1/oauth/token') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      tokenGrants.push(body.get('grant_type') ?? '');

      if (!(req.headers.authorization ?? '').startsWith('Basic ')) {
        return send(401, { error: 'invalid_client' });
      }
      tokenStillExpired = false;
      return send(200, {
        access_token: `access-${Date.now()}`,
        refresh_token: 'refresh-token',
        expires_in: 1800,
        scope: 'api',
      });
    }

    requests.push(url.pathname);

    if (tokenStillExpired) return send(401, { error: 'expired' });
    if (failures > 0) {
      failures--;
      return send(options.failFirst!.status, { error: 'transient' });
    }
    if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
      return send(401, { error: 'missing token' });
    }

    if (url.pathname === '/trader/v1/accounts/accountNumbers') return send(200, ACCOUNTS);

    if (url.pathname === '/trader/v1/accounts') {
      return send(200, [
        {
          securitiesAccount: {
            type: 'MARGIN',
            accountNumber: '11112222',
            roundTrips: 0,
            positions: positionsForTaxable(),
            currentBalances: { cashBalance: 51234.5, liquidationValue: 423178, totalCash: 51234.5 },
          },
        },
        {
          securitiesAccount: {
            type: 'CASH',
            accountNumber: '33334444',
            positions: [
              {
                instrument: { assetType: 'EQUITY', symbol: 'SPY' },
                longQuantity: 260, shortQuantity: 0, averagePrice: 498.2, marketValue: 167726,
              },
            ],
            currentBalances: { cashBalance: 8500, liquidationValue: 176226 },
          },
        },
      ]);
    }

    if (url.pathname === '/marketdata/v1/quotes') {
      const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
      const out: Record<string, unknown> = {};
      for (const symbol of symbols) {
        const q = QUOTES[symbol];
        if (!q) continue;
        out[symbol] = {
          symbol,
          assetMainType: 'EQUITY',
          quote: { lastPrice: q.price, mark: q.price, bidPrice: q.price - 0.05, askPrice: q.price + 0.05, closePrice: q.price - 1 },
          fundamental: q.divYield !== undefined ? { divYield: q.divYield } : {},
        };
      }
      return send(200, out);
    }

    if (url.pathname === '/marketdata/v1/chains') {
      const symbol = url.searchParams.get('symbol') ?? 'NVDA';
      return send(200, buildChain(symbol, QUOTES[symbol]?.price ?? 100));
    }

    return send(404, { error: `no mock for ${url.pathname}` });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    tokenGrants,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
