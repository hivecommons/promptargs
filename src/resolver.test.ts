import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { resolve } from './resolver.js';
import type { TemplateVar } from './parser.js';

// Variable names are deliberately obscure so the autodetect env-var
// fallback never picks them up from the test environment.
function v(name: string, defaultValue?: string): TemplateVar {
  return { name, defaultValue, raw: `{{${name}}}` };
}

// resolve() returns null-prototype objects so prototype-named variables
// (constructor, __proto__, ...) are ordinary keys; deepStrictEqual compares
// prototypes, so expected iterations must be null-prototype too.
function bare(obj: Record<string, string>): Record<string, string> {
  return Object.assign(Object.create(null) as Record<string, string>, obj);
}

let tmp: string;

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
    assert.deepStrictEqual(r.iterations, [bare({ pa_x: 'hello' })]);
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
    assert.deepStrictEqual(r.iterations, [bare({})]);
  });

  it('autodetect wins over defaults', async () => {
    process.env.pa_env_var = 'from-env';
    try {
      const r = await resolve([v('pa_env_var', 'dflt')], {}, false);
      assert.strictEqual(r.values.pa_env_var, 'from-env');
    } finally {
      delete process.env.pa_env_var;
    }
  });
});

describe('resolve array expansion', () => {
  it('splits comma-separated flag values into iterations', async () => {
    const r = await resolve([v('pa_f')], { pa_f: 'a.go, b.go,c.go' }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      ['a.go', 'b.go', 'c.go'],
    );
  });

  it('reads @file values one per line', async () => {
    const listFile = join(tmp, 'list.txt');
    writeFileSync(listFile, 'one\n two \n\nthree\n');
    const r = await resolve([v('pa_f')], { pa_f: `@${listFile}` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      ['one', 'two', 'three'],
    );
  });

  it('treats @nonexistent as a literal value', async () => {
    const r = await resolve([v('pa_f')], { pa_f: '@/no/such/file' }, false);
    assert.strictEqual(r.values.pa_f, '@/no/such/file');
  });

  it('zips arrays of equal length by default', async () => {
    const r = await resolve(
      [v('pa_a'), v('pa_b')],
      { pa_a: '1,2', pa_b: 'x,y' },
      false,
    );
    assert.deepStrictEqual(
      r.iterations.map(i => [i.pa_a, i.pa_b]),
      [['1', 'x'], ['2', 'y']],
    );
  });

  it('recycles shorter arrays when zipping', async () => {
    const r = await resolve(
      [v('pa_a'), v('pa_b')],
      { pa_a: '1,2,3', pa_b: 'x,y' },
      false,
    );
    assert.deepStrictEqual(
      r.iterations.map(i => [i.pa_a, i.pa_b]),
      [['1', 'x'], ['2', 'y'], ['3', 'x']],
    );
  });

  it('builds the cartesian product with cross=true', async () => {
    const r = await resolve(
      [v('pa_a'), v('pa_b')],
      { pa_a: '1,2', pa_b: 'x,y' },
      false,
      true,
    );
    assert.strictEqual(r.iterations.length, 4);
    assert.deepStrictEqual(
      r.iterations.map(i => `${i.pa_a}${i.pa_b}`).sort(),
      ['1x', '1y', '2x', '2y'],
    );
  });

  it('carries scalar values into every iteration', async () => {
    const r = await resolve(
      [v('pa_a'), v('pa_s', 'fixed')],
      { pa_a: '1,2' },
      false,
    );
    assert.deepStrictEqual(
      r.iterations.map(i => [i.pa_a, i.pa_s]),
      [['1', 'fixed'], ['2', 'fixed']],
    );
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
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [join(dir, 'a.txt'), join(dir, 'b.txt')],
    );
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

  it('expands a relative glob against the current directory', async () => {
    // All other glob tests use absolute patterns; this walks the base === ''
    // branches (readdir of '.', bare-entry results) in expandGlob.
    const dir = join(tmp, 'relative');
    mkdirSync(dir);
    writeFileSync(join(dir, 'one.txt'), '');
    writeFileSync(join(dir, 'two.txt'), '');
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const r = await resolve([v('pa_f')], { pa_f: '*.txt' }, false);
      assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['one.txt', 'two.txt']);
      // A literal leading segment resolved relative to the cwd.
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'three.txt'), '');
      const r2 = await resolve([v('pa_f')], { pa_f: 'sub/*.txt' }, false);
      assert.deepStrictEqual(r2.iterations.map(i => i.pa_f), [join('sub', 'three.txt')]);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('expands a ? wildcard segment without a *', async () => {
    const dir = join(tmp, 'qmark');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a1.txt'), '');
    writeFileSync(join(dir, 'a2.txt'), '');
    writeFileSync(join(dir, 'a12.txt'), '');
    const r = await resolve([v('pa_f')], { pa_f: join(dir, 'a?.txt') }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [join(dir, 'a1.txt'), join(dir, 'a2.txt')],
    );
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
  async function withStdin<T>(input: string, fn: () => Promise<T>): Promise<T> {
    const fake = new PassThrough();
    const desc = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
    try {
      fake.write(input);
      return await fn();
    } finally {
      Object.defineProperty(process, 'stdin', desc);
    }
  }

  it('asks for missing values and trims the answer', async () => {
    const r = await withStdin('  spaced answer  \n', () =>
      resolve([v('pa_ask')], {}, true),
    );
    assert.strictEqual(r.values.pa_ask, 'spaced answer');
    assert.deepStrictEqual(r.iterations, [bare({ pa_ask: 'spaced answer' })]);
  });

  it('expands a comma-separated interactive answer into iterations', async () => {
    const r = await withStdin('one,two,three\n', () =>
      resolve([v('pa_ask')], {}, true),
    );
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_ask),
      ['one', 'two', 'three'],
    );
  });

  it('prefers flags and defaults over prompting', async () => {
    // A sentinel answer is queued: if resolve prompted for either var it
    // would consume it and the assertions below would fail.
    const r = await withStdin('SENTINEL_NOT_CONSUMED\n', () =>
      resolve([v('pa_flag'), v('pa_dflt', 'd')], { pa_flag: 'f' }, true),
    );
    assert.strictEqual(r.values.pa_flag, 'f');
    assert.strictEqual(r.values.pa_dflt, 'd');
  });
});

describe('resolve prototype-named variables', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
    it(`does not treat {{${name}}} as supplied by flags`, async () => {
      const r = await resolve([v(name, 'dflt')], {}, false);
      assert.strictEqual(r.values[name], 'dflt');
    });

    it(`still honours an explicit ${name} flag`, async () => {
      const r = await resolve([v(name)], { [name]: 'given' }, false);
      assert.strictEqual(r.values[name], 'given');
    });
  }

  it('does not treat {{__proto__}} as supplied by flags', async () => {
    const r = await resolve([v('__proto__', 'dflt')], {}, false);
    assert.strictEqual(Object.hasOwn(r.values, '__proto__'), true);
    assert.strictEqual(r.values['__proto__'], 'dflt');
    assert.strictEqual(r.iterations.length, 1);
  });

  it('keeps an explicit __proto__ flag as an ordinary value', async () => {
    const flags = JSON.parse('{"__proto__":"given"}') as Record<string, string>;
    const r = await resolve([v('__proto__')], flags, false);
    assert.strictEqual(Object.hasOwn(r.values, '__proto__'), true);
    assert.strictEqual(r.values['__proto__'], 'given');
  });

  it('leaves unresolved prototype-named variables missing', async () => {
    const r = await resolve([v('constructor')], {}, false);
    assert.strictEqual(Object.hasOwn(r.values, 'constructor'), false);
  });
});
