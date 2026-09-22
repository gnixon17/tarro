# Tarro

A portfolio and hedge book for someone who holds the same tickers across several
accounts and hedges them with options. It answers three questions:

1. **What do I actually own?** Positions across taxable, IRA, Roth, 401(k) and
   whatever else, rolled up per ticker, per account and per strategy.
2. **What is each hedge doing?** Every option leg attached to a ticker, grouped
   into the structure it belongs to, with the payoff diagram and the greeks.
3. **What happens if the market drops?** A simulator that moves the market,
   propagates it through beta, moves the volatility surface the way a selloff
   actually moves it, rolls the clock forward, and re-prices everything.

Scenarios can be saved and re-run later against whatever the portfolio looks
like then.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

No configuration, no API keys. On first run the portfolio is seeded with demo
data so the simulator has something to chew on; **replace it from Settings →
Clear everything** before entering anything real.

```bash
npm test             # 103 tests, incl. a full sync against a mock broker
npm run lint         # tsc --noEmit
npm run build        # production bundle into dist/
```

## How the maths works

### Pricing

Black-Scholes-Merton with a continuous dividend yield (`src/lib/math/`). Greeks
are analytic and checked against finite differences in the test suite; implied
vol is solved by Newton-Raphson seeded with Brenner-Subrahmanyam, falling back
to bisection in the wings where vega collapses.

### The volatility surface

Three parameters per ticker (`src/lib/options/surface.ts`):

```
IV(K, T) = atm(T) + skewSlope · m + skewCurvature · m²
atm(T)   = ivAtm30 + termSlope · ln(T_days / 30)
m        = ln(K / F) / √T
```

`m` is normalised by `√T`, so the same skew parameters describe weeklies and
LEAPS and the skew flattens with tenor, as it does in the market.

If you mark a specific contract's IV, the gap between your mark and the model
surface is held constant through every scenario — your mark is respected, and it
still responds to shocks.

### How a drop moves implied vol

This is the part that makes a stress test worth running, so it is calibrated
rather than guessed.

**The index.** ATM vol gains `betaVolToSpot × |move| × (1 + convexity × |move|)`
vol points, damped on the upside because rallies compress vol by less than
selloffs lift it. The defaults (1.25 and 2.0) reproduce the record:

| Index move | Model | What actually happened |
|---|---|---|
| −5% | +7 vol | VIX 15 → 22 |
| −10% | +15 vol | Feb 2018, VIX 15 → 30 |
| −20% | +35 vol | Aug 2015 / Oct 2018, VIX ≈ 15 → 45 |
| −34% | +71 vol | COVID, VIX 14 → 82 |

**Single names.** A high-vol name gains more vol *points* than the index but
multiplies by *less* — the index starts lowest and so has the most room to
triple. The relationship is a damped power of the vol ratio:

```
Δσᵢ = volBetaᵢ · Δσ_market · (σᵢ / σ_market) ^ volLevelExponent
```

Fitting COVID (NVDA 44→95, TSLA 55→110, MSFT 24→58 against SPX 15→45) puts the
exponent between 0.27 and 0.49; the default is 0.45. Using the raw ratio instead
— the obvious-looking choice — sends a 55-vol name to 250 vol on a bad month,
which no crash has ever done.

**Term structure.** Short-dated IV reacts harder: the shock is scaled by
`(30 / days) ^ termDecay`, clamped.

**Skew behaviour.** Switchable between sticky-moneyness (the smile travels with
spot) and sticky-strike (it stays on absolute strikes, so a selloff walks the
book down the existing skew).

Every one of these is a slider, globally in Settings and per-scenario in the
simulator.

### Propagating a market move

`rᵢ = βᵢ · r_market + αᵢ`, with per-ticker overrides for beta, an explicit move,
an extra IV shift, or pinning a name flat. Rates shift in parallel by a
configurable number of basis points, which is where long-dated rho shows up.

## Strategies

27 templates (`src/lib/options/strategies.ts`) — covered calls, protective puts,
collars, put spread collars, all four verticals, calendars, diagonals, PMCC,
straddles, strangles, iron condors and butterflies, broken-wing butterflies,
jade lizards, ratio spreads and backspreads, risk reversals, synthetics, boxes —
plus arbitrary custom structures.

Templates work in both directions. Pick one and it seeds concrete legs off the
current spot, all editable. Or enter legs by hand and the classifier tells you
what you built. Anything it cannot name comes back as "custom structure", which
is not a failure: rolled-into-each-other books genuinely have no textbook name.

## Architecture

```
src/lib/          pure, isomorphic, fully tested — no React
  math/           Black-Scholes, greeks, implied vol, Gaussian helpers
  options/        vol surface + shock model, strategy templates, classifier
  portfolio/      valuation, rollups, payoff ladders, hedge summaries
  sim/            scenario engine and built-in presets
  brokers/        OSI symbols, Schwab mapping, surface fitting, reconciliation
  storeOps.ts     portfolio mutations, shared by the API and the browser
  storage.ts      backend selection: artifact / server / browser
api/schwab/       OAuth, encrypted token store, rate-limited client, sync
src/pages/        dashboard, positions, ticker detail, simulator, library, admin
src/components/   UI primitives and hand-rolled SVG charts
api/              thin REST layer — stores and returns the portfolio document
```

The maths runs **in the browser**, so moving a slider re-prices instantly
instead of round-tripping. The server only persists. Both use the same code in
`src/lib`, so the number on the dashboard and the number in a stress run can
never disagree.

Routing is hash-based, so the one build works from the dev server, from a static
`dist/`, and from a published page — only the first of those can rewrite deep
links back to `index.html`.

## Storage

The portfolio is one JSON document. The same bundle runs in three places, so the
backend is chosen by probing at startup rather than by a build flag
(`src/lib/storage.ts`), and Settings always names the one in use:

| Backend | Where it writes | When it is picked |
|---|---|---|
| `artifact` | the artifact's own document store | a published Artifact page, where the `db` capability is granted |
| `server` | `./data/portfolio.json`, or Postgres when `SUPABASE_URL` and `SUPABASE_KEY` are set (`supabase_schema.sql`) | `npm run dev`, or any host serving the API |
| `browser` | `localStorage` | a static build with no API behind it |

Every mutation goes through the same pure functions in `src/lib/storeOps.ts`
whichever backend is active, so a cascading delete and a protected built-in
scenario behave identically in all three. Only the last one is per-device and
non-durable, and Settings says so in as many words.

Deploying on a host with an ephemeral filesystem — Vercel included — means using
the Postgres backend; the file driver will otherwise lose writes silently.

Export and import the whole document as JSON from Settings, and import positions
from CSV.

## Schwab sync

Positions, prices and implied vols can come from Schwab instead of being typed.

**Setup.** Register an app at developer.schwab.com, request both the *Accounts
and Trading* and *Market Data* products, then set `SCHWAB_APP_KEY`,
`SCHWAB_APP_SECRET` and `SCHWAB_REDIRECT_URI` (see `.env.example`) and restart.
Connections → Connect walks the rest.

Schwab requires an HTTPS callback, which a local HTTP server cannot serve, so
the flow is: authorise in the browser, then paste back the address you were
redirected to — it fails to load, but it carries the code. If you front the app
with HTTPS, `GET /api/schwab/callback` completes it directly instead.

**Refresh tokens last seven days and cannot be extended.** That is Schwab's
design, not a limitation here; the app shows the deadline and says so plainly
rather than pretending the connection is permanent.

**What a sync does.**

| | |
|---|---|
| Positions | Shares and option legs across every linked account. Option strike and expiry are decoded from the OSI symbol; a short is reconstructed from Schwab's split long/short quantities. |
| Prices | One quote call covers every ticker, falling through mark → last → midpoint → prior close. |
| Implied vol | Every contract you hold is marked to its live IV. |
| The surface | Each ticker's skew, smile and term structure are re-fitted to its live chain by least squares, and the residual is reported in vol points so the parameters can be judged. The market proxy is always fitted, held or not, because its 30-day IV anchors the whole vol-shock model. |

**Nothing is written without review.** A sync produces a *plan* — add, update,
link, remove — that you accept row by row. Two rules make it safe to run:

- A position you entered by hand is never removed by a sync. If the broker
  reports the same contract, the existing row is *adopted* rather than
  duplicated, keeping its strategy group, notes and open date.
- Removals are the only destructive change, and they are unchecked by default.

**Security.** The client secret and tokens stay on the server and are never
returned by any endpoint. Tokens are encrypted at rest with AES-256-GCM and
written 0600. Set `TARRO_SECRET_KEY` to keep the key out of the data directory;
without it a key is generated beside the token file, and the UI says which of
the two is in force. Only the last four digits of an account number are ever
stored.

**Working on it without a Schwab account.** `npm run mock-schwab` serves a
stand-in shaped like the published schemas — see the header of
`scripts/mock-schwab.ts`. The integration tests drive the real client, mapper,
surface fit and reconciler against it.

### A caveat on the field shapes

Schwab publishes its schemas but does not guarantee them, and the mapper here
was written against those published shapes rather than verified against a live
account. So it is built to fail loudly instead of quietly: unit-ambiguous
numbers are range-checked rather than assumed (an implied vol over 3.0 can only
be a percentage), anything unmappable is reported as a warning instead of
dropped, and **Connections → What Schwab sent back** prints the field names that
actually arrived, values stripped. If a field has been renamed, that page is
where it shows up — not in a total that is quietly wrong.

## Market data by hand

Everything Schwab fills in can also be typed under **Market data**, which is the
only option on the published build (an OAuth secret cannot live in a browser).
Prices, implied vols, betas and skew parameters all price the book, so update
the marks before drawing a conclusion from a stress test.

## Caveats worth knowing

- **European exercise.** Black-Scholes prices European options; listed US equity
  options are American. The difference only matters for deep-ITM puts and for
  calls with a dividend before expiry, where early exercise has value the model
  does not price.
- **Beta is not a law.** Correlations move toward 1 in a crash. If that is the
  scenario you care about, raise the betas or set explicit per-ticker moves.
- **No assignment, no pin risk, no margin model.** A short leg that would be
  assigned is simply marked at its model value, and buying power is not tracked.
- **Dividends are continuous.** Discrete ex-dates are not modelled.
