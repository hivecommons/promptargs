import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UsageError, parseFlags, parsePort } from './flags.js';
describe('parseFlags', () => {
    it('parses --key=value', () => {
        assert.deepStrictEqual(parseFlags(['--file=a.go']), { file: 'a.go' });
    });
    it('parses --key value', () => {
        assert.deepStrictEqual(parseFlags(['--file', 'a.go']), { file: 'a.go' });
    });
    it('treats switches as valueless', () => {
        assert.deepStrictEqual(parseFlags(['--json', '--cross', '--status', '--no-interactive']), {
            json: 'true',
            cross: 'true',
            status: 'true',
            'no-interactive': 'true',
        });
    });
    it('does not consume the next arg after a switch', () => {
        assert.deepStrictEqual(parseFlags(['--json', '--file=a']), { json: 'true', file: 'a' });
    });
    it('keeps an empty --key= value', () => {
        assert.deepStrictEqual(parseFlags(['--file=']), { file: '' });
    });
    it('throws UsageError for positional args', () => {
        assert.throws(() => parseFlags(['oops']), (e) => {
            assert.ok(e instanceof UsageError);
            assert.strictEqual(e.message, 'Unexpected argument: oops');
            return true;
        });
    });
    it('throws UsageError for a bare non-switch flag', () => {
        assert.throws(() => parseFlags(['--file']), {
            name: 'UsageError',
            message: 'Invalid --file: --file requires a value: --file=<value>',
        });
        assert.throws(() => parseFlags(['--file', '--json']), UsageError);
    });
});
describe('parsePort', () => {
    it('returns undefined when --port is absent', () => {
        assert.strictEqual(parsePort({}), undefined);
    });
    it('accepts the 0..65535 range', () => {
        assert.strictEqual(parsePort({ port: '0' }), 0);
        assert.strictEqual(parsePort({ port: '3700' }), 3700);
        assert.strictEqual(parsePort({ port: '65535' }), 65535);
    });
    it('rejects empty, non-integer, and out-of-range values', () => {
        for (const port of ['', 'abc', '1.5', '-1', '65536']) {
            assert.throws(() => parsePort({ port }), {
                name: 'UsageError',
                message: 'Invalid --port: expected an integer from 0 to 65535. Usage: promptargs ui --port=3700',
            });
        }
    });
});
//# sourceMappingURL=flags.test.js.map