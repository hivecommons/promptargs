import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { classifyError, diag, jsonLogEnabled, logRequest } from './log.js';
import { UsageError } from './flags.js';
const original = process.env.PROMPTARGS_LOG;
const origError = console.error;
afterEach(() => {
    if (original === undefined)
        delete process.env.PROMPTARGS_LOG;
    else
        process.env.PROMPTARGS_LOG = original;
    console.error = origError;
});
function capture() {
    const lines = [];
    console.error = (msg) => { lines.push(String(msg)); };
    return lines;
}
describe('jsonLogEnabled', () => {
    it('is only true for PROMPTARGS_LOG=json', () => {
        assert.strictEqual(jsonLogEnabled({}), false);
        assert.strictEqual(jsonLogEnabled({ PROMPTARGS_LOG: 'text' }), false);
        assert.strictEqual(jsonLogEnabled({ PROMPTARGS_LOG: 'json' }), true);
    });
});
describe('classifyError', () => {
    it('maps errors to a bounded enum', () => {
        assert.strictEqual(classifyError(Object.assign(new Error('x'), { code: 'ENOENT' })), 'not_found');
        assert.strictEqual(classifyError(Object.assign(new Error('x'), { code: 'EADDRINUSE' })), 'port_in_use');
        assert.strictEqual(classifyError(Object.assign(new Error('x'), { code: 'EACCES' })), 'io');
        // Only errno-style E* codes are io; Node's non-errno codes stay unknown.
        assert.strictEqual(classifyError(Object.assign(new Error('x'), { code: 'ABORT_ERR' })), 'unknown');
        assert.strictEqual(classifyError(new UsageError('secret-value')), 'usage');
        assert.strictEqual(classifyError(new Error('boom')), 'unknown');
        assert.strictEqual(classifyError(undefined), 'unknown');
    });
});
describe('diag', () => {
    it('runs the legacy output unchanged when PROMPTARGS_LOG is unset', () => {
        delete process.env.PROMPTARGS_LOG;
        const lines = capture();
        diag('cli_error', { error_class: 'unknown' }, 'plain message');
        assert.deepStrictEqual(lines, ['plain message']);
    });
    it('prints nothing when disabled and no legacy text is given', () => {
        delete process.env.PROMPTARGS_LOG;
        const lines = capture();
        diag('ui_request', { status: 200 });
        assert.deepStrictEqual(lines, []);
    });
    it('emits one JSON line with only the fixed fields when enabled', () => {
        process.env.PROMPTARGS_LOG = 'json';
        const lines = capture();
        diag('ui_asset_error', { status: 404, error_class: 'not_found' }, 'legacy');
        assert.strictEqual(lines.length, 1);
        assert.deepStrictEqual(JSON.parse(lines[0]), { event: 'ui_asset_error', status: 404, error_class: 'not_found' });
    });
});
describe('logRequest', () => {
    it('is silent when disabled', () => {
        delete process.env.PROMPTARGS_LOG;
        const lines = capture();
        logRequest(200, process.hrtime.bigint());
        assert.deepStrictEqual(lines, []);
    });
    it('logs status and a non-negative duration when enabled', () => {
        process.env.PROMPTARGS_LOG = 'json';
        const lines = capture();
        logRequest(200, process.hrtime.bigint());
        const parsed = JSON.parse(lines[0]);
        assert.deepStrictEqual(Object.keys(parsed), ['event', 'status', 'duration_ms']);
        assert.strictEqual(parsed.event, 'ui_request');
        assert.strictEqual(parsed.status, 200);
        assert.ok(parsed.duration_ms >= 0);
    });
    it('reports the duration in milliseconds', () => {
        process.env.PROMPTARGS_LOG = 'json';
        const lines = capture();
        // hrtime is in nanoseconds: a start 5ms ago must read as >= 5 and not
        // as 5000 (microseconds) or 5e9 (nanoseconds).
        logRequest(200, process.hrtime.bigint() - 5000000n);
        const { duration_ms } = JSON.parse(lines[0]);
        assert.ok(duration_ms >= 5, `expected >= 5ms, got ${duration_ms}`);
        assert.ok(duration_ms < 1000, `expected a sub-second duration, got ${duration_ms}`);
    });
});
//# sourceMappingURL=log.test.js.map