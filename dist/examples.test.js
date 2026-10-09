import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseVars, expand } from './parser.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, 'cli.js');
const EXAMPLES_DIR = join(__dirname, '..', 'examples');
// The templates `promptargs init` writes are embedded in cli.ts; examples/
// is the human-readable copy of the same files. Both must stay identical or
// the README-linked examples silently diverge from what users actually get.
const INIT_TEMPLATES = ['review.md', 'explain.md', 'fix.md'];
function exampleFiles() {
    return readdirSync(EXAMPLES_DIR)
        .filter((f) => f.endsWith('.md'))
        .sort();
}
test('examples/ contains the templates that init ships, plus any extras', () => {
    const files = exampleFiles();
    for (const f of INIT_TEMPLATES) {
        assert.ok(files.includes(f), `examples/${f} should exist`);
    }
});
test('every example template declares at least one variable', () => {
    for (const f of exampleFiles()) {
        const content = readFileSync(join(EXAMPLES_DIR, f), 'utf-8');
        const vars = parseVars(content);
        assert.ok(vars.length > 0, `${f} should declare at least one {{variable}}`);
        for (const v of vars) {
            assert.match(v.name, /^\w+$/, `${f}: variable name ${v.name} should be a word`);
        }
    }
});
test('every example expands fully once its required variables are supplied', () => {
    for (const f of exampleFiles()) {
        const content = readFileSync(join(EXAMPLES_DIR, f), 'utf-8');
        const vars = parseVars(content);
        const values = {};
        for (const v of vars) {
            if (v.defaultValue === undefined)
                values[v.name] = `<${v.name}>`;
        }
        const out = expand(content, values);
        assert.ok(!out.includes('{{'), `${f} should leave no unfilled {{...}} after expansion:\n${out}`);
        for (const v of vars) {
            const expected = v.defaultValue ?? `<${v.name}>`;
            assert.ok(out.includes(expected), `${f}: expansion should contain ${JSON.stringify(expected)} for ${v.name}`);
        }
    }
});
test('example defaults are reused verbatim when the variable is omitted', () => {
    const review = readFileSync(join(EXAMPLES_DIR, 'review.md'), 'utf-8');
    const out = expand(review, { file: 'src/main.ts' });
    assert.match(out, /Review src\/main\.ts for correctness issues\./);
    assert.match(out, /Be concise in your feedback\./);
});
test('promptargs init writes templates byte-identical to examples/', () => {
    const base = mkdtempSync(join(tmpdir(), 'promptargs-examples-test-'));
    const cwd = join(base, 'work');
    const home = join(base, 'home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(home, { recursive: true });
    try {
        const res = spawnSync(process.execPath, [CLI, 'init'], {
            cwd,
            encoding: 'utf-8',
            env: { ...process.env, HOME: home, USERPROFILE: home },
            timeout: 30_000,
        });
        assert.strictEqual(res.status, 0, res.stderr);
        const written = readdirSync(join(cwd, '.prompts')).sort();
        assert.deepStrictEqual(written, [...INIT_TEMPLATES].sort());
        for (const f of INIT_TEMPLATES) {
            const fromInit = readFileSync(join(cwd, '.prompts', f), 'utf-8');
            const fromExamples = readFileSync(join(EXAMPLES_DIR, f), 'utf-8');
            assert.strictEqual(fromInit, fromExamples, `.prompts/${basename(f)} drifted from examples/${f}`);
        }
    }
    finally {
        rmSync(base, { recursive: true, force: true });
    }
});
//# sourceMappingURL=examples.test.js.map