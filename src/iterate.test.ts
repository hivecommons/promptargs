import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cartesian, zip } from './iterate.js';

describe('cartesian', () => {
  it('returns a single empty combo for no arrays', () => {
    assert.deepStrictEqual(cartesian([]), [[]]);
  });

  it('builds every combination across arrays', () => {
    assert.deepStrictEqual(
      cartesian([['a', 'b'], ['1', '2']]),
      [['a', '1'], ['a', '2'], ['b', '1'], ['b', '2']],
    );
  });
});

describe('zip', () => {
  it('pairs equal-length arrays 1:1', () => {
    assert.deepStrictEqual(
      zip([['a', 'b', 'c'], ['1', '2', '3']]),
      [['a', '1'], ['b', '2'], ['c', '3']],
    );
  });

  it('wraps shorter arrays around to match the longest one', () => {
    assert.deepStrictEqual(
      zip([['a', 'b', 'c'], ['1', '2']]),
      [['a', '1'], ['b', '2'], ['c', '1']],
    );
  });
});
