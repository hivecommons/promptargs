import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// A blocking child_process call with no `timeout:` is the one hang the test
// runner cannot cut short: spawnSync holds the event loop, so --test-timeout
// never fires, and the suite runs until CI's 10-minute job limit cancels it
// with no test named (#197: `ui --port=` started the UI server inside
// spawnSync and cost three matrix legs ten minutes each). Every sync spawn in
// a test file must therefore carry its own timeout.
const SYNC_SPAWN = /\b(spawnSync|execFileSync|execSync)\s*\(/g;
export function testSourceFiles(root) {
    const src = readdirSync(join(root, 'src'))
        .filter(f => f.endsWith('.test.ts'))
        .map(f => join(root, 'src', f));
    const scripts = readdirSync(join(root, 'scripts'))
        .filter(f => f.endsWith('.test.mjs'))
        .map(f => join(root, 'scripts', f));
    return [...src, ...scripts].sort();
}
/** The full `name(...)` call starting at `start`, found by balancing parens. */
export function callExpressionAt(source, start) {
    const open = source.indexOf('(', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === '(')
            depth++;
        else if (ch === ')' && --depth === 0)
            return source.slice(start, i + 1);
    }
    throw new Error(`unbalanced call expression at offset ${start}`);
}
export function findSyncSpawnCalls(source) {
    const calls = [];
    for (const m of source.matchAll(SYNC_SPAWN)) {
        const call = callExpressionAt(source, m.index);
        calls.push({
            line: source.slice(0, m.index).split('\n').length,
            call,
            hasTimeout: /\btimeout\s*:/.test(call),
        });
    }
    return calls;
}
// Fixture call names are assembled at runtime so this file's own scan does
// not see them as unguarded sync spawns.
const SPAWN_SYNC = ['spawn', 'Sync'].join('');
const EXEC_FILE_SYNC = ['execFile', 'Sync'].join('');
const EXEC_SYNC = ['exec', 'Sync'].join('');
test('callExpressionAt returns the balanced call including nested parens', () => {
    const src = `x; ${SPAWN_SYNC}(a, [f(1), g((2))], { timeout: 5 }); y()`;
    assert.strictEqual(callExpressionAt(src, 3), `${SPAWN_SYNC}(a, [f(1), g((2))], { timeout: 5 })`);
    assert.throws(() => callExpressionAt(`${SPAWN_SYNC}(a, (b`, 0), /unbalanced/);
});
test('findSyncSpawnCalls reports each sync spawn with its line and timeout presence', () => {
    const src = [
        `import { ${SPAWN_SYNC}, ${EXEC_FILE_SYNC} } from 'node:child_process';`,
        `const a = ${SPAWN_SYNC}('x', [], { encoding: 'utf-8' });`,
        `const b = ${EXEC_FILE_SYNC}(bin, args, {`,
        '  cwd,',
        '  timeout: 30_000,',
        '});',
        `const c = ${EXEC_SYNC}('y');`,
        'spawn(x); // async spawn is not in scope',
    ].join('\n');
    assert.deepStrictEqual(findSyncSpawnCalls(src).map(c => [c.line, c.hasTimeout]), [[2, false], [3, true], [7, false]]);
});
test('testSourceFiles lists src/*.test.ts and scripts/*.test.mjs, including this file', () => {
    const files = testSourceFiles(ROOT).map(f => relative(ROOT, f));
    assert.ok(files.includes(join('src', 'spawn-timeout-guard.test.ts')), files.join('\n'));
    assert.ok(files.includes(join('src', 'cli.test.ts')));
    assert.ok(files.some(f => f.startsWith('scripts') && f.endsWith('.test.mjs')));
    assert.ok(files.every(f => /\.test\.(ts|mjs)$/.test(f)));
});
test('every sync child_process call in a test file sets a timeout', () => {
    const offenders = [];
    let seen = 0;
    for (const file of testSourceFiles(ROOT)) {
        for (const c of findSyncSpawnCalls(readFileSync(file, 'utf-8'))) {
            seen++;
            if (!c.hasTimeout)
                offenders.push(`${relative(ROOT, file)}:${c.line}: ${c.call.split('\n')[0]}`);
        }
    }
    assert.ok(seen > 0, 'expected the test suite to contain sync child_process calls');
    assert.deepStrictEqual(offenders, [], 'sync child_process calls without a `timeout:` option (a hang there runs until the CI job limit):\n' +
        offenders.join('\n'));
});
//# sourceMappingURL=spawn-timeout-guard.test.js.map