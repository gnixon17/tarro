/**
 * Demo portfolio.
 *
 * Every mark here is a placeholder so the app has something to show on first
 * run - prices, IVs and betas are plausible, not live. Replace them from
 * Instruments before drawing any conclusion from a simulation.
 */
import { BUILTIN_SCENARIOS, makeScenario } from './sim/presets';
import { DEFAULT_SETTINGS, type Instrument, type PortfolioStore, type Position, type StrategyGroup } from './types';

function inst(
  symbol: string,
  name: string,
  price: number,
  beta: number,
  ivAtm30: number,
  overrides: Partial<Instrument> = {},
): Instrument {
  return {
    symbol,
    name,
    price,
    dividendYield: 0,
    beta,
    ivAtm30,
    volBeta: 1,
    // Index skew is steeper than single-name skew; both are negative.
    skewSlope: -0.06,
    skewCurvature: 0.04,
    termSlope: 0.01,
    ...overrides,
  };
}

export function demoStore(): PortfolioStore {
  const accounts = [
    { id: 'acc_taxable', name: 'Main brokerage', broker: 'Schwab', kind: 'TAXABLE' as const, cash: 42000, optionsLevel: 3 as const },
    { id: 'acc_roth', name: 'Roth IRA', broker: 'Fidelity', kind: 'ROTH_IRA' as const, cash: 8500, optionsLevel: 2 as const },
    { id: 'acc_401k', name: 'Company 401(k)', broker: 'Vanguard', kind: '401K' as const, cash: 3000, optionsLevel: 0 as const },
    { id: 'acc_rollover', name: 'Rollover IRA', broker: 'Interactive Brokers', kind: 'ROLLOVER_IRA' as const, cash: 15000, optionsLevel: 4 as const },
  ];

  const instruments: Instrument[] = [
    inst('SPY', 'SPDR S&P 500 ETF', 640, 1.0, 0.15, {
      dividendYield: 0.012,
      skewSlope: -0.085,
      skewCurvature: 0.05,
      termSlope: 0.012,
      volBeta: 1,
    }),
    inst('QQQ', 'Invesco QQQ Trust', 570, 1.15, 0.19, { dividendYield: 0.006, skewSlope: -0.075, volBeta: 1 }),
    inst('NVDA', 'NVIDIA', 178, 1.9, 0.44, { skewSlope: -0.05, skewCurvature: 0.07, volBeta: 1.1, sector: 'Semiconductors' }),
    inst('AAPL', 'Apple', 245, 1.1, 0.26, { dividendYield: 0.004, volBeta: 1, sector: 'Hardware' }),
    inst('MSFT', 'Microsoft', 505, 1.05, 0.24, { dividendYield: 0.007, volBeta: 1, sector: 'Software' }),
    inst('TSLA', 'Tesla', 395, 2.1, 0.55, { skewSlope: -0.03, skewCurvature: 0.09, volBeta: 1.15, sector: 'Autos' }),
    inst('VTI', 'Vanguard Total Market', 315, 1.02, 0.14, { dividendYield: 0.013, volBeta: 1 }),
  ];

  const groups: StrategyGroup[] = [
    {
      id: 'grp_nvda_collar',
      accountId: 'acc_taxable',
      symbol: 'NVDA',
      name: 'NVDA Jan-27 collar',
      template: 'COLLAR',
      thesis: 'Large concentrated position with a big embedded gain. Floor the downside, accept a cap.',
      openedAt: '2026-04-10',
      tags: ['concentration', 'tax-aware'],
    },
    {
      id: 'grp_spy_puts',
      accountId: 'acc_roth',
      symbol: 'SPY',
      name: 'SPY portfolio hedge',
      template: 'BEAR_PUT_SPREAD',
      thesis: 'Index-level tail hedge sized to roughly a quarter of total equity notional.',
      openedAt: '2026-07-01',
      tags: ['tail-hedge'],
    },
    {
      id: 'grp_tsla_cc',
      accountId: 'acc_taxable',
      symbol: 'TSLA',
      name: 'TSLA covered call',
      template: 'COVERED_CALL',
      thesis: 'Harvest the elevated IV while holding the shares.',
      openedAt: '2026-09-02',
    },
    {
      id: 'grp_aapl_pmcc',
      accountId: 'acc_rollover',
      symbol: 'AAPL',
      name: 'AAPL PMCC',
      template: 'PMCC',
      thesis: 'Synthetic long via LEAPS, financed by a rolling short call.',
      openedAt: '2026-06-18',
    },
    {
      id: 'grp_qqq_crash',
      accountId: 'acc_rollover',
      symbol: 'QQQ',
      name: 'QQQ crash convexity',
      template: 'MARRIED_PUT_RATIO',
      thesis: 'Near-costless until a moderate drop, convex in a real crash.',
      openedAt: '2026-08-14',
      tags: ['tail-hedge'],
    },
  ];

  const positions: Position[] = [
    // --- Taxable -----------------------------------------------------------
    { id: 'pos_nvda_shares', kind: 'EQUITY', accountId: 'acc_taxable', symbol: 'NVDA', quantity: 800, costBasis: 61.4, groupId: 'grp_nvda_collar', openedAt: '2024-02-20' },
    { id: 'pos_nvda_put', kind: 'OPTION', accountId: 'acc_taxable', symbol: 'NVDA', right: 'PUT', strike: 155, expiry: '2027-01-15', quantity: 8, multiplier: 100, costBasis: 18.4, groupId: 'grp_nvda_collar', markIv: 0.46 },
    { id: 'pos_nvda_call', kind: 'OPTION', accountId: 'acc_taxable', symbol: 'NVDA', right: 'CALL', strike: 230, expiry: '2027-01-15', quantity: -8, multiplier: 100, costBasis: 16.1, groupId: 'grp_nvda_collar', markIv: 0.42 },

    { id: 'pos_tsla_shares', kind: 'EQUITY', accountId: 'acc_taxable', symbol: 'TSLA', quantity: 300, costBasis: 210.5, groupId: 'grp_tsla_cc', openedAt: '2025-03-11' },
    { id: 'pos_tsla_call', kind: 'OPTION', accountId: 'acc_taxable', symbol: 'TSLA', right: 'CALL', strike: 440, expiry: '2026-12-18', quantity: -3, multiplier: 100, costBasis: 29.8, groupId: 'grp_tsla_cc', markIv: 0.57 },

    { id: 'pos_vti_taxable', kind: 'EQUITY', accountId: 'acc_taxable', symbol: 'VTI', quantity: 400, costBasis: 244.0, openedAt: '2023-09-05' },

    // --- Roth IRA ----------------------------------------------------------
    { id: 'pos_spy_shares', kind: 'EQUITY', accountId: 'acc_roth', symbol: 'SPY', quantity: 260, costBasis: 498.2, openedAt: '2024-06-14' },
    { id: 'pos_spy_put_long', kind: 'OPTION', accountId: 'acc_roth', symbol: 'SPY', right: 'PUT', strike: 610, expiry: '2027-03-19', quantity: 6, multiplier: 100, costBasis: 27.9, groupId: 'grp_spy_puts', markIv: 0.175 },
    { id: 'pos_spy_put_short', kind: 'OPTION', accountId: 'acc_roth', symbol: 'SPY', right: 'PUT', strike: 500, expiry: '2027-03-19', quantity: -6, multiplier: 100, costBasis: 9.4, groupId: 'grp_spy_puts', markIv: 0.225 },

    // --- 401(k): no options approval --------------------------------------
    { id: 'pos_401k_vti', kind: 'EQUITY', accountId: 'acc_401k', symbol: 'VTI', quantity: 950, costBasis: 201.3, openedAt: '2021-01-04' },
    { id: 'pos_401k_msft', kind: 'EQUITY', accountId: 'acc_401k', symbol: 'MSFT', quantity: 180, costBasis: 342.1, openedAt: '2022-11-30' },

    // --- Rollover IRA ------------------------------------------------------
    { id: 'pos_aapl_leaps', kind: 'OPTION', accountId: 'acc_rollover', symbol: 'AAPL', right: 'CALL', strike: 180, expiry: '2028-01-21', quantity: 5, multiplier: 100, costBasis: 78.5, groupId: 'grp_aapl_pmcc', markIv: 0.245 },
    { id: 'pos_aapl_short_call', kind: 'OPTION', accountId: 'acc_rollover', symbol: 'AAPL', right: 'CALL', strike: 265, expiry: '2026-11-20', quantity: -5, multiplier: 100, costBasis: 6.2, groupId: 'grp_aapl_pmcc', markIv: 0.255 },

    { id: 'pos_qqq_short_put', kind: 'OPTION', accountId: 'acc_rollover', symbol: 'QQQ', right: 'PUT', strike: 540, expiry: '2027-01-15', quantity: -4, multiplier: 100, costBasis: 21.7, groupId: 'grp_qqq_crash', markIv: 0.205 },
    { id: 'pos_qqq_long_puts', kind: 'OPTION', accountId: 'acc_rollover', symbol: 'QQQ', right: 'PUT', strike: 450, expiry: '2027-01-15', quantity: 9, multiplier: 100, costBasis: 9.3, groupId: 'grp_qqq_crash', markIv: 0.265 },

    { id: 'pos_rollover_msft', kind: 'EQUITY', accountId: 'acc_rollover', symbol: 'MSFT', quantity: 120, costBasis: 415.0, openedAt: '2024-01-22' },
  ];

  return {
    accounts,
    instruments,
    positions,
    groups,
    scenarios: BUILTIN_SCENARIOS.map(makeScenario),
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function emptyStore(): PortfolioStore {
  return {
    accounts: [],
    instruments: [],
    positions: [],
    groups: [],
    scenarios: BUILTIN_SCENARIOS.map(makeScenario),
    settings: { ...DEFAULT_SETTINGS },
  };
}
