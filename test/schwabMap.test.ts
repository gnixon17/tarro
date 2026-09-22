import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  costPerShare,
  mapAccount,
  mapChain,
  mapPosition,
  mapQuotes,
  maskAccountNumber,
  normalizeDividendYield,
  normalizeVol,
  signedQuantity,
} from '../src/lib/brokers/schwabMap';

test('signed quantity reconstructs shorts from the split fields', () => {
  assert.equal(signedQuantity({ longQuantity: 800, shortQuantity: 0 }), 800);
  assert.equal(signedQuantity({ longQuantity: 0, shortQuantity: 8 }), -8);
  assert.equal(signedQuantity({}), 0);
});

test('cost per share prefers the side-specific average', () => {
  assert.equal(costPerShare({ averagePrice: 10, averageLongPrice: 12 }, 5), 12);
  assert.equal(costPerShare({ averagePrice: 10, averageShortPrice: 9 }, -5), 9);
  assert.equal(costPerShare({ averagePrice: 10 }, 5), 10);
  assert.equal(costPerShare({}, 5), 0);
});

test('volatility is range-checked rather than assumed', () => {
  assert.ok(Math.abs(normalizeVol(46.2)! - 0.462) < 1e-9, 'percent form');
  assert.ok(Math.abs(normalizeVol(0.462)! - 0.462) < 1e-9, 'decimal form');
  assert.equal(normalizeVol(0), null);
  assert.equal(normalizeVol(-5), null);
  assert.equal(normalizeVol(undefined), null);
  assert.equal(normalizeVol(900), null, 'absurd values are rejected, not scaled');
});

test('dividend yield converts from percent', () => {
  assert.ok(Math.abs(normalizeDividendYield(1.23)! - 0.0123) < 1e-12);
  assert.equal(normalizeDividendYield(0), 0);
  assert.equal(normalizeDividendYield(80), null, 'an 80% yield is bad data');
});

test('account numbers are masked to the last four', () => {
  assert.equal(maskAccountNumber('12345678'), '…5678');
  assert.equal(maskAccountNumber(undefined), 'account');
});

test('maps an equity position', () => {
  const { value, warnings } = mapPosition({
    instrument: { assetType: 'EQUITY', symbol: 'nvda', description: 'NVIDIA CORP' },
    longQuantity: 800, shortQuantity: 0, averagePrice: 61.4, marketValue: 142400,
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(value, {
    kind: 'EQUITY', symbol: 'NVDA', quantity: 800, costBasis: 61.4,
    externalSymbol: 'NVDA', marketValue: 142400,
  });
});

test('maps a short option position, deriving strike and expiry from the symbol', () => {
  const { value } = mapPosition({
    instrument: {
      assetType: 'OPTION', symbol: 'NVDA  270115C00230000',
      putCall: 'CALL', underlyingSymbol: 'NVDA', optionMultiplier: 100,
    },
    longQuantity: 0, shortQuantity: 8, averagePrice: 16.1, marketValue: -3002,
  });
  assert.deepEqual(value, {
    kind: 'OPTION', symbol: 'NVDA', right: 'CALL', strike: 230, expiry: '2027-01-15',
    quantity: -8, multiplier: 100, costBasis: 16.1,
    externalSymbol: 'NVDA  270115C00230000', marketValue: -3002,
  });
});

test('ETFs map as equity, unmodelled asset types are reported not dropped silently', () => {
  assert.equal(mapPosition({
    instrument: { assetType: 'COLLECTIVE_INVESTMENT', symbol: 'VTI' },
    longQuantity: 400, averagePrice: 244,
  }).value!.kind, 'EQUITY');

  const bond = mapPosition({ instrument: { assetType: 'FIXED_INCOME', symbol: 'T 4 1/8' }, longQuantity: 10 });
  assert.equal(bond.value, null);
  assert.equal(bond.warnings.length, 1);
  assert.match(bond.warnings[0], /not modelled/);
});

test('an unreadable option symbol warns instead of guessing', () => {
  const r = mapPosition({
    instrument: { assetType: 'OPTION', symbol: 'WEIRD-CONTRACT', putCall: 'PUT' },
    longQuantity: 1,
  });
  assert.equal(r.value, null);
  assert.match(r.warnings[0], /Could not read the option symbol/);
});

test('an adjusted contract is flagged, not silently trusted', () => {
  const r = mapPosition({
    instrument: {
      assetType: 'OPTION', symbol: 'AAPL1 270115C00190000',
      putCall: 'CALL', underlyingSymbol: 'AAPL', optionMultiplier: 137,
    },
    longQuantity: 1, averagePrice: 5,
  });
  assert.equal(r.value!.symbol, 'AAPL', 'the explicit underlying wins over the mangled root');
  assert.equal(r.value!.kind === 'OPTION' && r.value.multiplier, 137);
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings.some((w) => /multiplier/.test(w)));
  assert.ok(r.warnings.some((w) => /disagrees/.test(w)));
});

test('zero-quantity rows are dropped without noise', () => {
  const r = mapPosition({ instrument: { assetType: 'EQUITY', symbol: 'AAPL' }, longQuantity: 0, shortQuantity: 0 });
  assert.equal(r.value, null);
  assert.deepEqual(r.warnings, []);
});

test('maps a whole account', () => {
  const { value, warnings } = mapAccount({
    securitiesAccount: {
      type: 'MARGIN',
      accountNumber: '87654321',
      currentBalances: { cashBalance: 42000, liquidationValue: 423178 },
      positions: [
        { instrument: { assetType: 'EQUITY', symbol: 'NVDA' }, longQuantity: 800, averagePrice: 61.4 },
        { instrument: { assetType: 'OPTION', symbol: 'NVDA  270115P00155000', putCall: 'PUT', underlyingSymbol: 'NVDA' }, longQuantity: 8, averagePrice: 18.4 },
        { instrument: { assetType: 'FIXED_INCOME', symbol: 'BOND' }, longQuantity: 1 },
      ],
    },
  }, 'HASH123');

  assert.equal(value!.externalId, 'HASH123');
  assert.equal(value!.externalLabel, '…4321');
  assert.equal(value!.marginType, 'MARGIN');
  assert.equal(value!.cash, 42000);
  assert.equal(value!.positions.length, 2, 'the bond is excluded');
  assert.equal(warnings.length, 1);
});

test('quotes fall back through mark, last, midpoint, close', () => {
  const { value, warnings } = mapQuotes({
    NVDA: { symbol: 'NVDA', quote: { mark: 178.2, lastPrice: 178.1, closePrice: 175 }, fundamental: { divYield: 0.03 } },
    SPY: { symbol: 'SPY', quote: { lastPrice: 640 } },
    QQQ: { symbol: 'QQQ', quote: { bidPrice: 569, askPrice: 571 } },
    VTI: { symbol: 'VTI', quote: { closePrice: 315 } },
    BAD: { symbol: 'BAD', quote: {} },
  });
  const bySymbol = Object.fromEntries(value.map((q) => [q.symbol, q.price]));
  assert.equal(bySymbol.NVDA, 178.2);
  assert.equal(bySymbol.SPY, 640);
  assert.equal(bySymbol.QQQ, 570, 'midpoint');
  assert.equal(bySymbol.VTI, 315);
  assert.equal(bySymbol.BAD, undefined);
  assert.match(warnings[0], /no usable price/);
});

test('flattens an option chain', () => {
  const { value } = mapChain({
    symbol: 'NVDA',
    underlyingPrice: 178,
    interestRate: 4.2,
    callExpDateMap: {
      '2027-01-15:116': {
        '230.0': [{ putCall: 'CALL', symbol: 'NVDA  270115C00230000', strikePrice: 230, daysToExpiration: 116, volatility: 42.0, markPrice: 3.75, delta: 0.21 }],
      },
    },
    putExpDateMap: {
      '2027-01-15:116': {
        '155.0': [{ putCall: 'PUT', symbol: 'NVDA  270115P00155000', strikePrice: 155, daysToExpiration: 116, volatility: 46.0, markPrice: 7.36 }],
      },
    },
  });

  assert.equal(value!.contracts.length, 2);
  const put = value!.contracts.find((c) => c.right === 'PUT')!;
  assert.equal(put.strike, 155);
  assert.equal(put.expiry, '2027-01-15');
  assert.ok(Math.abs(put.iv! - 0.46) < 1e-9, 'percent converted to decimal');
  assert.ok(Math.abs(put.timeYears - 116 / 365) < 1e-9);
});

test('mapping never throws on junk', () => {
  assert.equal(mapChain(null).value, null);
  assert.equal(mapChain({} as never).value, null);
  assert.equal(mapAccount({}, 'X').value, null);
  assert.equal(mapPosition({}).value, null);
  assert.deepEqual(mapQuotes(undefined).value, []);
});
