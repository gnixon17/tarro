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
npm test             # 46 unit tests: pricing, vol model, classifier, engine
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
src/lib/          pure, isomorphic, fully tested — no React, no I/O
  math/           Black-Scholes, greeks, implied vol, Gaussian helpers
  options/        vol surface + shock model, strategy templates, classifier
  portfolio/      valuation, rollups, payoff ladders, hedge summaries
  sim/            scenario engine and built-in presets
src/pages/        dashboard, positions, ticker detail, simulator, library, admin
src/components/   UI primitives and hand-rolled SVG charts
api/              thin REST layer — stores and returns the portfolio document
```

The maths runs **in the browser**, so moving a slider re-prices instantly
instead of round-tripping. The server only persists. Both use the same code in
`src/lib`, so the number on the dashboard and the number in a stress run can
never disagree.

## Storage

One JSON document, written atomically.

- **Default:** `./data/portfolio.json`. Zero config.
- **Postgres/Supabase:** set `SUPABASE_URL` and `SUPABASE_KEY` and it writes to
  the `app_state` table instead (`supabase_schema.sql`). Use this anywhere with
  an ephemeral filesystem — Vercel included, where the file driver will silently
  lose writes.

Export and import the whole document as JSON from Settings, and import positions
from CSV.

## Market data

There is no live feed. Prices, implied vols, betas and skew parameters are
entered by hand under **Market data**, and everything in the app prices off
them — so update the marks before drawing a conclusion from a stress test.

To wire in a real feed, replace the `price` / `ivAtm30` fields on `Instrument`
from a provider and leave the rest alone: nothing else in the codebase reads
market data, so a quote provider is a single sync job writing to
`PUT /api/instruments/:symbol`.

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
