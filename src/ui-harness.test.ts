import test from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { SCRATCH_DIR, compileInlineScript } from './ui-harness.js';

test('compileInlineScript returns a callable bound to the given parameters', () => {
  const add = compileInlineScript<number>('harness-self-test', ['a', 'b'], 'return a + b;');
  assert.equal(add(2, 3), 5);
  assert.equal(compileInlineScript<string>('harness-self-test', [], 'return "none";')(), 'none');
});

test('compileInlineScript compiles under a content-hashed scratch file URL', () => {
  const body = 'throw new Error(msg);';
  const thrower = compileInlineScript<never>('harness-self-test', ['msg'], body);
  // Compiling the same source again must reuse the file, not fail on it.
  compileInlineScript<never>('harness-self-test', ['msg'], body);

  let stack = '';
  try { thrower('where'); } catch (e) { stack = (e as Error).stack ?? ''; }

  // The frame inside the script names the file the reporter will key on.
  const match = /file:\/\/[^\s)]+harness-self-test-[0-9a-f]{8}\.js/.exec(stack);
  assert.ok(match, `expected scratch file URL in stack, got:\n${stack}`);
  const path = decodeURIComponent(match[0].replace(/^file:\/\//, ''));
  assert.ok(path.startsWith(SCRATCH_DIR), `${path} should live under ${SCRATCH_DIR}`);
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf-8'), `(function (msg) {\n${body}\n})`);
});
