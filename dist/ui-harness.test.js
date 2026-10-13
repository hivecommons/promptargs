import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SCRATCH_DIR, compileInlineScript } from './ui-harness.js';
test('compileInlineScript returns a callable bound to the given parameters', () => {
    const add = compileInlineScript('harness-self-test', ['a', 'b'], 'return a + b;');
    assert.equal(add(2, 3), 5);
    assert.equal(compileInlineScript('harness-self-test', [], 'return "none";')(), 'none');
});
test('compileInlineScript compiles under a content-hashed scratch file URL', () => {
    const body = 'throw new Error(msg);';
    const thrower = compileInlineScript('harness-self-test', ['msg'], body);
    // Compiling the same source again must reuse the file, not fail on it.
    compileInlineScript('harness-self-test', ['msg'], body);
    let stack = '';
    try {
        thrower('where');
    }
    catch (e) {
        stack = e.stack ?? '';
    }
    // The frame inside the script names the file the reporter will key on.
    const match = /file:\/\/[^\s)]+harness-self-test-[0-9a-f]{8}\.js/.exec(stack);
    assert.ok(match, `expected scratch file URL in stack, got:\n${stack}`);
    const path = decodeURIComponent(match[0].replace(/^file:\/\//, ''));
    assert.ok(path.startsWith(SCRATCH_DIR), `${path} should live under ${SCRATCH_DIR}`);
    assert.ok(existsSync(path));
    assert.equal(readFileSync(path, 'utf-8'), `(function (msg) {\n${body}\n})`);
});
test('compileInlineScript writes never-seen source to a new scratch file', () => {
    // The other self-tests reuse content-hashed files, so on a warm
    // .test-scratch the mkdir/write/rename path never runs. Unique source per
    // run forces it; the previous run's file is pruned so only one lingers.
    const label = 'harness-fresh-write';
    if (existsSync(SCRATCH_DIR)) {
        for (const f of readdirSync(SCRATCH_DIR)) {
            if (f.startsWith(`${label}-`))
                rmSync(join(SCRATCH_DIR, f), { force: true });
        }
    }
    const nonce = randomUUID();
    const fn = compileInlineScript(label, [], `return ${JSON.stringify(nonce)};`);
    assert.equal(fn(), nonce);
    const written = readdirSync(SCRATCH_DIR).filter((f) => f.startsWith(`${label}-`));
    assert.equal(written.length, 1, `expected one fresh scratch file, got ${written.join(', ')}`);
    assert.match(written[0], /^harness-fresh-write-[0-9a-f]{8}\.js$/);
    // Written atomically: the rename completed and no temp file was left behind.
    assert.ok(!written[0].endsWith('.tmp'));
    assert.ok(readFileSync(join(SCRATCH_DIR, written[0]), 'utf-8').includes(nonce));
});
//# sourceMappingURL=ui-harness.test.js.map