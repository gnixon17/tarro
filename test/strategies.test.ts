import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STRATEGY_TEMPLATES, buildLegsFromTemplate, classifyStrategy, roundStrike } from '../src/lib/options/strategies';
import type { Position } from '../src/lib/types';

let seq = 0;
function opt(right: 'CALL' | 'PUT', strike: number, quantity: number, expiry = '2027-01-15'): Position {
  return {
    id: `p${seq++}`, kind: 'OPTION', accountId: 'a', symbol: 'X',
    right, strike, expiry, quantity, multiplier: 100, costBasis: 1,
  };
}
function stock(quantity: number): Position {
  return { id: `p${seq++}`, kind: 'EQUITY', accountId: 'a', symbol: 'X', quantity, costBasis: 100 };
}

test('stock-only positions', () => {
  assert.equal(classifyStrategy([stock(100)]), 'LONG_STOCK');
  assert.equal(classifyStrategy([stock(-100)]), 'SHORT_STOCK');
});

test('structures built on shares', () => {
  assert.equal(classifyStrategy([stock(100), opt('CALL', 110, -1)]), 'COVERED_CALL');
  assert.equal(classifyStrategy([stock(100), opt('PUT', 90, 1)]), 'PROTECTIVE_PUT');
  assert.equal(classifyStrategy([stock(100), opt('PUT', 90, 1), opt('CALL', 115, -1)]), 'COLLAR');
  assert.equal(
    classifyStrategy([stock(100), opt('PUT', 92, 1), opt('PUT', 75, -1), opt('CALL', 115, -1)]),
    'PUT_SPREAD_COLLAR',
  );
});

test('vertical spreads', () => {
  assert.equal(classifyStrategy([opt('CALL', 100, 1), opt('CALL', 110, -1)]), 'BULL_CALL_SPREAD');
  assert.equal(classifyStrategy([opt('CALL', 100, -1), opt('CALL', 110, 1)]), 'BEAR_CALL_SPREAD');
  assert.equal(classifyStrategy([opt('PUT', 100, 1), opt('PUT', 90, -1)]), 'BEAR_PUT_SPREAD');
  assert.equal(classifyStrategy([opt('PUT', 100, -1), opt('PUT', 90, 1)]), 'BULL_PUT_SPREAD');
});

test('straddles, strangles and synthetics', () => {
  assert.equal(classifyStrategy([opt('CALL', 100, 1), opt('PUT', 100, 1)]), 'LONG_STRADDLE');
  assert.equal(classifyStrategy([opt('CALL', 100, -1), opt('PUT', 100, -1)]), 'SHORT_STRADDLE');
  assert.equal(classifyStrategy([opt('CALL', 110, 1), opt('PUT', 90, 1)]), 'LONG_STRANGLE');
  assert.equal(classifyStrategy([opt('CALL', 110, -1), opt('PUT', 90, -1)]), 'SHORT_STRANGLE');
  assert.equal(classifyStrategy([opt('CALL', 100, 1), opt('PUT', 100, -1)]), 'SYNTHETIC_LONG');
  assert.equal(classifyStrategy([opt('CALL', 110, 1), opt('PUT', 90, -1)]), 'RISK_REVERSAL');
});

test('time spreads', () => {
  assert.equal(classifyStrategy([opt('CALL', 100, -1, '2026-11-20'), opt('CALL', 100, 1, '2027-03-19')]), 'CALENDAR');
  assert.equal(classifyStrategy([opt('CALL', 80, 1, '2028-01-21'), opt('CALL', 120, -1, '2026-11-20')]), 'PMCC');
  assert.equal(classifyStrategy([opt('PUT', 95, -1, '2026-11-20'), opt('PUT', 105, 1, '2027-03-19')]), 'DIAGONAL');
});

test('four-leg neutral structures', () => {
  assert.equal(
    classifyStrategy([opt('PUT', 85, 1), opt('PUT', 92, -1), opt('CALL', 108, -1), opt('CALL', 115, 1)]),
    'IRON_CONDOR',
  );
  assert.equal(
    classifyStrategy([opt('PUT', 90, 1), opt('PUT', 100, -1), opt('CALL', 100, -1), opt('CALL', 110, 1)]),
    'IRON_BUTTERFLY',
  );
  assert.equal(
    classifyStrategy([opt('CALL', 95, 1), opt('PUT', 95, -1), opt('CALL', 105, -1), opt('PUT', 105, 1)]),
    'BOX_SPREAD',
  );
});

test('butterflies and ratios', () => {
  assert.equal(classifyStrategy([opt('CALL', 95, 1), opt('CALL', 100, -2), opt('CALL', 105, 1)]), 'CALL_BUTTERFLY');
  assert.equal(classifyStrategy([opt('PUT', 95, 1), opt('PUT', 100, -2), opt('PUT', 105, 1)]), 'PUT_BUTTERFLY');
  assert.equal(classifyStrategy([opt('PUT', 80, 1), opt('PUT', 93, -2), opt('PUT', 100, 1)]), 'BROKEN_WING_BUTTERFLY');
  assert.equal(classifyStrategy([opt('CALL', 100, 1), opt('CALL', 110, -2)]), 'CALL_RATIO_SPREAD');
  assert.equal(classifyStrategy([opt('CALL', 100, -1), opt('CALL', 110, 2)]), 'CALL_BACKSPREAD');
  assert.equal(classifyStrategy([opt('PUT', 95, -1), opt('PUT', 82, 2)]), 'MARRIED_PUT_RATIO');
  assert.equal(classifyStrategy([opt('PUT', 92, -1), opt('CALL', 107, -1), opt('CALL', 112, 1)]), 'JADE_LIZARD');
});

test('single legs and unknown shapes', () => {
  assert.equal(classifyStrategy([opt('PUT', 90, -1)]), 'CASH_SECURED_PUT');
  assert.equal(classifyStrategy([]), 'CUSTOM');
  assert.equal(
    classifyStrategy([opt('CALL', 100, 3), opt('PUT', 80, -7), opt('CALL', 130, 2), opt('PUT', 60, 5)]),
    'CUSTOM',
  );
});

test('every template has a unique id and a description', () => {
  const ids = new Set<string>();
  for (const t of STRATEGY_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate template id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.description.length > 0, `${t.id} needs a description`);
    assert.ok(t.hedgeNote.length > 0, `${t.id} needs a hedge note`);
  }
  assert.ok(ids.has('CUSTOM'));
});

test('templates build into legs that classify back to themselves', () => {
  const roundTrippable = [
    'COVERED_CALL', 'PROTECTIVE_PUT', 'COLLAR', 'BULL_CALL_SPREAD', 'BEAR_PUT_SPREAD',
    'BULL_PUT_SPREAD', 'BEAR_CALL_SPREAD', 'LONG_STRADDLE', 'SHORT_STRADDLE',
    'LONG_STRANGLE', 'SHORT_STRANGLE', 'IRON_CONDOR', 'RISK_REVERSAL', 'CASH_SECURED_PUT',
  ];
  for (const id of roundTrippable) {
    const template = STRATEGY_TEMPLATES.find((t) => t.id === id)!;
    const legs = buildLegsFromTemplate(template, 100, 1, new Date('2026-09-21T00:00:00Z'));
    const positions: Position[] = legs.map((leg, n) =>
      leg.kind === 'EQUITY'
        ? { id: `b${n}`, kind: 'EQUITY', accountId: 'a', symbol: 'X', quantity: leg.quantity, costBasis: 100 }
        : {
            id: `b${n}`, kind: 'OPTION', accountId: 'a', symbol: 'X', right: leg.right!,
            strike: leg.strike!, expiry: leg.expiry!, quantity: leg.quantity, multiplier: 100, costBasis: 1,
          },
    );
    assert.equal(classifyStrategy(positions), id, `${id} did not round-trip`);
  }
});

test('strikes round to plausible listed increments', () => {
  assert.equal(roundStrike(12.3), 12.5);
  assert.equal(roundStrike(47.2), 47);
  assert.equal(roundStrike(178.9), 180);
  assert.equal(roundStrike(643.1), 645);
  assert.equal(roundStrike(4271), 4270);
});
