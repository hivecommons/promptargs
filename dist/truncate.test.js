import { test } from 'node:test';
import assert from 'node:assert';
import { truncateValue } from './truncate.js';
test('returns short values unchanged', () => {
    assert.strictEqual(truncateValue('abc', 3), 'abc');
});
test('truncates long values with an ellipsis', () => {
    assert.strictEqual(truncateValue('abcdef', 3), 'abc...');
});
test('does not split a surrogate pair at the boundary', () => {
    const out = truncateValue('ab😀cd', 3);
    assert.strictEqual(out, 'ab😀...');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out));
});
test('counts an astral character as one character', () => {
    assert.strictEqual(truncateValue('😀😀😀', 3), '😀😀😀');
});
//# sourceMappingURL=truncate.test.js.map