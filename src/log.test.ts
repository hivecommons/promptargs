import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { classifyError, diag, jsonLogEnabled, logRequest } from './log.js';
import { UsageError } from './flags.js';

const original = process.env.PROMPTARGS_LOG;
const origError = console.error;

afterEach(() => {
  if (original === undefined) delete process.env.PROMPTARGS_LOG;
  else process.env.PROMPTARGS_LOG = original;
  console.error = origError;
});

function capture(): string[] {
  const lines: string[] = [];
  console.error = (msg: unknown) => { lines.push(String(msg)); };
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
});
