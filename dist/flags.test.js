import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UsageError, assertKnownFlags, assertNoArgs, parseFlags, parsePort } from './flags.js';
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
    it('rejects a switch given a value, including an empty one', () => {
        for (const name of ['no-interactive', 'cross', 'json', 'status']) {
            for (const value of ['false', '', '0', 'no', 'true']) {
                assert.throws(() => parseFlags([`--${name}=${value}`]), (err) => err instanceof UsageError && err.message === `Invalid --${name}: --${name} takes no value`);
            }
        }
    });
    it('does not consume the next arg after a switch', () => {
        assert.deepStrictEqual(parseFlags(['--json', '--file=a']), { json: 'true', file: 'a' });
    });
    it('rejects any equals value on switches, including an empty value', () => {
        for (const name of ['json', 'cross', 'status', 'no-interactive']) {
            for (const value of ['', 'false', '0', 'no', 'true']) {
                assert.throws(() => parseFlags([`--${name}=${value}`]), {
                    name: 'UsageError',
                    message: `Invalid --${name}: --${name} takes no value`,
                });
            }
        }
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
describe('assertNoArgs', () => {
    it('accepts an empty list', () => {
        assert.doesNotThrow(() => assertNoArgs([]));
    });
    it('rejects the first leftover argument', () => {
        assert.throws(() => assertNoArgs(['--json', 'x']), (e) => e instanceof UsageError && e.message === 'Unexpected argument: --json');
    });
});
describe('assertKnownFlags', () => {
    it('accepts declared variables and switches', () => {
        assert.doesNotThrow(() => assertKnownFlags({ file: 'a', json: 'true' }, [{ name: 'file' }], 'review'));
    });
    it('rejects a flag that names no blank', () => {
        assert.throws(() => assertKnownFlags({ fiel: 'a' }, [{ name: 'file' }], 'review'), (err) => err instanceof UsageError &&
            err.message ===
                'Unknown flag --fiel: template "review" has no {{fiel}} blank. Run "promptargs show review" to see its variables.');
    });
    it('omits the show hint for inline templates', () => {
        assert.throws(() => assertKnownFlags({ fiel: 'a' }, [{ name: 'file' }], 'inline'), (err) => err instanceof UsageError && err.message === 'Unknown flag --fiel: template "inline" has no {{fiel}} blank.');
    });
    it('rejects --__proto__ instead of dropping it', () => {
        const flags = parseFlags(['--__proto__=x']);
        assert.ok(Object.keys(flags).includes('__proto__'));
        assert.throws(() => assertKnownFlags(flags, [{ name: 'file' }], 'review'), (err) => err instanceof UsageError && /^Unknown flag --__proto__:/.test(err.message));
    });
});
//# sourceMappingURL=flags.test.js.map