import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { resolve } from './resolver.js';
// Variable names are deliberately obscure so the autodetect env-var
// fallback never picks them up from the test environment.
function v(name, defaultValue) {
    return { name, defaultValue, raw: `{{${name}}}` };
}
let tmp;
before(() => {
    tmp = mkdtempSync(join(process.cwd(), '.pa-resolver-'));
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
});
describe('resolve scalar values', () => {
    it('takes values from flags', async () => {
        const r = await resolve([v('pa_x')], { pa_x: 'hello' }, false);
        assert.strictEqual(r.values.pa_x, 'hello');
        assert.deepStrictEqual(r.iterations, [{ pa_x: 'hello' }]);
    });
    it('flags win over defaults', async () => {
        const r = await resolve([v('pa_x', 'dflt')], { pa_x: 'flag' }, false);
        assert.strictEqual(r.values.pa_x, 'flag');
    });
    it('falls back to defaults', async () => {
        const r = await resolve([v('pa_x', 'dflt')], {}, false);
        assert.strictEqual(r.values.pa_x, 'dflt');
    });
    it('leaves unfilled vars unset when non-interactive', async () => {
        const r = await resolve([v('pa_missing')], {}, false);
        assert.ok(!('pa_missing' in r.values));
        assert.deepStrictEqual(r.iterations, [{}]);
    });
    it('autodetect wins over defaults', async () => {
        process.env.pa_env_var = 'from-env';
        try {
            const r = await resolve([v('pa_env_var', 'dflt')], {}, false);
            assert.strictEqual(r.values.pa_env_var, 'from-env');
        }
        finally {
            delete process.env.pa_env_var;
        }
    });
});
describe('resolve array expansion', () => {
    it('splits comma-separated flag values into iterations', async () => {
        const r = await resolve([v('pa_f')], { pa_f: 'a.go, b.go,c.go' }, false);
        assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['a.go', 'b.go', 'c.go']);
    });
    it('reads @file values one per line', async () => {
        const listFile = join(tmp, 'list.txt');
        writeFileSync(listFile, 'one\n two \n\nthree\n');
        const r = await resolve([v('pa_f')], { pa_f: `@${listFile}` }, false);
        assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['one', 'two', 'three']);
    });
    it('treats @nonexistent as a literal value', async () => {
        const r = await resolve([v('pa_f')], { pa_f: '@/no/such/file' }, false);
        assert.strictEqual(r.values.pa_f, '@/no/such/file');
    });
    it('zips arrays of equal length by default', async () => {
        const r = await resolve([v('pa_a'), v('pa_b')], { pa_a: '1,2', pa_b: 'x,y' }, false);
        assert.deepStrictEqual(r.iterations.map(i => [i.pa_a, i.pa_b]), [['1', 'x'], ['2', 'y']]);
    });
    it('recycles shorter arrays when zipping', async () => {
        const r = await resolve([v('pa_a'), v('pa_b')], { pa_a: '1,2,3', pa_b: 'x,y' }, false);
        assert.deepStrictEqual(r.iterations.map(i => [i.pa_a, i.pa_b]), [['1', 'x'], ['2', 'y'], ['3', 'x']]);
    });
    it('builds the cartesian product with cross=true', async () => {
        const r = await resolve([v('pa_a'), v('pa_b')], { pa_a: '1,2', pa_b: 'x,y' }, false, true);
        assert.strictEqual(r.iterations.length, 4);
        assert.deepStrictEqual(r.iterations.map(i => `${i.pa_a}${i.pa_b}`).sort(), ['1x', '1y', '2x', '2y']);
    });
    it('carries scalar values into every iteration', async () => {
        const r = await resolve([v('pa_a'), v('pa_s', 'fixed')], { pa_a: '1,2' }, false);
        assert.deepStrictEqual(r.iterations.map(i => [i.pa_a, i.pa_s]), [['1', 'fixed'], ['2', 'fixed']]);
    });
    it('keeps "-" (stdin placeholder) as a single literal', async () => {
        const r = await resolve([v('pa_f')], { pa_f: '-' }, false);
        assert.strictEqual(r.values.pa_f, '-');
        assert.strictEqual(r.iterations.length, 1);
    });
});
describe('resolve glob expansion', () => {
    it('expands a matching glob into sorted file iterations', async () => {
        const dir = join(tmp, 'glob');
        mkdirSync(dir);
        writeFileSync(join(dir, 'b.txt'), '');
        writeFileSync(join(dir, 'a.txt'), '');
        writeFileSync(join(dir, 'c.md'), '');
        const r = await resolve([v('pa_f')], { pa_f: join(dir, '*.txt') }, false);
        assert.deepStrictEqual(r.iterations.map(i => i.pa_f), [join(dir, 'a.txt'), join(dir, 'b.txt')]);
    });
    it('skips hidden files unless the segment starts with a dot', async () => {
        const dir = join(tmp, 'hidden');
        mkdirSync(dir);
        writeFileSync(join(dir, '.secret.txt'), '');
        writeFileSync(join(dir, 'plain.txt'), '');
        const r = await resolve([v('pa_f')], { pa_f: join(dir, '*.txt') }, false);
        assert.deepStrictEqual(r.iterations.map(i => i.pa_f), [join(dir, 'plain.txt')]);
    });
    it('treats a non-matching glob as a literal', async () => {
        const pattern = join(tmp, 'nope', '*.zzz');
        const r = await resolve([v('pa_f')], { pa_f: pattern }, false);
        assert.strictEqual(r.values.pa_f, pattern);
    });
    it('survives an unreadable glob base (file used as directory)', async () => {
        // "plain-file/*.md": the base exists but readdirSync throws ENOTDIR;
        // the expander must skip it instead of crashing, leaving a literal.
        const file = join(tmp, 'plain-file');
        writeFileSync(file, 'not a dir');
        const pattern = join(file, '*.md');
        const r = await resolve([v('pa_f')], { pa_f: pattern }, false);
        assert.strictEqual(r.values.pa_f, pattern);
        assert.strictEqual(r.iterations.length, 1);
    });
});
describe('resolve interactive prompting', () => {
    // resolve()'s ask() reads from process.stdin via readline; swap in a
    // PassThrough so answers can be scripted without a child process.
    async function withStdin(input, fn) {
        const fake = new PassThrough();
        const desc = Object.getOwnPropertyDescriptor(process, 'stdin');
        Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
        try {
            fake.write(input);
            return await fn();
        }
        finally {
            Object.defineProperty(process, 'stdin', desc);
        }
    }
    it('asks for missing values and trims the answer', async () => {
        const r = await withStdin('  spaced answer  \n', () => resolve([v('pa_ask')], {}, true));
        assert.strictEqual(r.values.pa_ask, 'spaced answer');
        assert.deepStrictEqual(r.iterations, [{ pa_ask: 'spaced answer' }]);
    });
    it('expands a comma-separated interactive answer into iterations', async () => {
        const r = await withStdin('one,two,three\n', () => resolve([v('pa_ask')], {}, true));
        assert.deepStrictEqual(r.iterations.map(i => i.pa_ask), ['one', 'two', 'three']);
    });
    it('prefers flags and defaults over prompting', async () => {
        // A sentinel answer is queued: if resolve prompted for either var it
        // would consume it and the assertions below would fail.
        const r = await withStdin('SENTINEL_NOT_CONSUMED\n', () => resolve([v('pa_flag'), v('pa_dflt', 'd')], { pa_flag: 'f' }, true));
        assert.strictEqual(r.values.pa_flag, 'f');
        assert.strictEqual(r.values.pa_dflt, 'd');
    });
});
//# sourceMappingURL=resolver.test.js.map