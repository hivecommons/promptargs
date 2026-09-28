import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeForTerminal } from './sanitize.js';

test('passes plain text through unchanged', () => {
  assert.strictEqual(sanitizeForTerminal('hello world'), 'hello world');
});

test('preserves newlines and tabs', () => {
  assert.strictEqual(sanitizeForTerminal('a\n\tb'), 'a\n\tb');
});

test('strips CSI color/cursor sequences', () => {
  assert.strictEqual(sanitizeForTerminal('\x1b[31mred\x1b[0m'), 'red');
  assert.strictEqual(sanitizeForTerminal('up\x1b[2Aover\x1b[10D'), 'upover');
});

test('strips OSC sequences (BEL and ST terminated)', () => {
  // Window retitle
  assert.strictEqual(sanitizeForTerminal('\x1b]0;pwned\x07safe'), 'safe');
  // OSC 52 clipboard write, ST-terminated
  assert.strictEqual(sanitizeForTerminal('\x1b]52;c;ZXZpbA==\x1b\\safe'), 'safe');
});

test('strips unterminated OSC sequence', () => {
  assert.strictEqual(sanitizeForTerminal('a\x1b]0;title'), 'a');
});

test('strips DCS/SOS/PM/APC sequences', () => {
  assert.strictEqual(sanitizeForTerminal('\x1bPq payload\x1b\\ok'), 'ok');
  assert.strictEqual(sanitizeForTerminal('\x1b_apc\x1b\\ok'), 'ok');
});

test('strips single-character escapes', () => {
  assert.strictEqual(sanitizeForTerminal('a\x1bcb'), 'ab');
});

test('strips carriage returns, C0 controls, DEL, and C1 bytes', () => {
  assert.strictEqual(sanitizeForTerminal('fake\rreal'), 'fakereal');
  assert.strictEqual(sanitizeForTerminal('a\x00b\x08c\x7fd'), 'abcd');
  assert.strictEqual(sanitizeForTerminal('a\u009b31mb'), 'a31mb');
});

test('handles empty string', () => {
  assert.strictEqual(sanitizeForTerminal(''), '');
});
