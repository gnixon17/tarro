import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatOptionSymbol, isOptionSymbol, parseOptionSymbol } from '../src/lib/brokers/osi';

test('parses standard OSI symbols', () => {
  assert.deepEqual(parseOptionSymbol('AAPL  270115C00190000'), {
    underlying: 'AAPL', expiry: '2027-01-15', right: 'CALL', strike: 190,
  });
  assert.deepEqual(parseOptionSymbol('SPY   270319P00610000'), {
    underlying: 'SPY', expiry: '2027-03-19', right: 'PUT', strike: 610,
  });
});

test('handles fractional and large strikes', () => {
  assert.equal(parseOptionSymbol('F     261218C00012500')!.strike, 12.5);
  assert.equal(parseOptionSymbol('SPX   270115P06000000')!.strike, 6000);
  assert.equal(parseOptionSymbol('BRKB  270115C00500500')!.strike, 500.5);
});

test('handles six-character roots with no padding', () => {
  const parsed = parseOptionSymbol('GOOGL 270115C00200000');
  assert.equal(parsed!.underlying, 'GOOGL');
  assert.equal(parsed!.strike, 200);
});

test('rejects anything that is not an option symbol', () => {
  for (const bad of ['AAPL', '', 'AAPL 270115X00190000', 'AAPL  2701C00190000', 'not a symbol']) {
    assert.equal(parseOptionSymbol(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(parseOptionSymbol(undefined as unknown as string), null);
});

test('rejects impossible dates instead of rolling them forward', () => {
  // Date would happily turn Feb 30 into Mar 2 and quietly book the wrong expiry.
  assert.equal(parseOptionSymbol('AAPL  270230C00190000'), null);
  assert.equal(parseOptionSymbol('AAPL  271315C00190000'), null);
  assert.equal(parseOptionSymbol('AAPL  270100C00190000'), null);
});

test('round-trips', () => {
  for (const symbol of ['AAPL  270115C00190000', 'SPY   270319P00610000', 'F     261218C00012500']) {
    assert.equal(formatOptionSymbol(parseOptionSymbol(symbol)!), symbol);
  }
});

test('isOptionSymbol distinguishes equity tickers', () => {
  assert.equal(isOptionSymbol('NVDA'), false);
  assert.equal(isOptionSymbol('NVDA  270115P00155000'), true);
});
