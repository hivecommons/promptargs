import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, globSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
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

  it('treats \\, as a literal comma in flag values', async () => {
    const r = await resolve([v('pa_f')], { pa_f: 'returns 200\\, not 500' }, false);
    assert.strictEqual(r.values.pa_f, 'returns 200, not 500');
    assert.strictEqual(r.iterations.length, 1);
  });

  it('splits only on unescaped commas', async () => {
    const r = await resolve([v('pa_f')], { pa_f: 'a\\,b,c' }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['a,b', 'c']);
  });

  it('unescapes \\, in @file lines', async () => {
    const listFile = join(tmp, 'escaped.txt');
    writeFileSync(listFile, 'x\\,y\nz\n');
    const r = await resolve([v('pa_f')], { pa_f: `@${listFile}` }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['x,y', 'z']);
  });

  it('treats \\\\, as a literal backslash followed by a separator', async () => {
    const r = await resolve([v('pa_f')], { pa_f: 'C:\\dir\\\\,D:\\x' }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['C:\\dir\\', 'D:\\x']);
  });

  it('reads backslash runs before a comma in pairs', async () => {
    const r = await resolve([v('pa_f')], { pa_f: 'a\\\\\\,b,c\\\\\\\\,d' }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['a\\,b', 'c\\\\', 'd']);
  });

  it('keeps backslashes that are not before a comma', async () => {
    const r = await resolve([v('pa_f')], { pa_f: 'C:\\a\\\\b,x\\' }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['C:\\a\\\\b', 'x\\']);
  });

  it('unescapes \\\\, in @file lines to a backslash and comma', async () => {
    const listFile = join(tmp, 'escaped-backslash.txt');
    writeFileSync(listFile, 'x\\\\,y\nz\n');
    const r = await resolve([v('pa_f')], { pa_f: `@${listFile}` }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), ['x\\,y', 'z']);
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

  it('falls through to the default for an empty @file', async () => {
    const emptyFile = join(tmp, 'empty.txt');
    writeFileSync(emptyFile, '\n\n');
    const r = await resolve([v('pa_f', 'dflt')], { pa_f: `@${emptyFile}` }, false);
    assert.strictEqual(r.values.pa_f, 'dflt');
  });

  it('leaves the variable absent for a separator-only flag with no default', async () => {
    const r = await resolve([v('pa_f')], { pa_f: ',' }, false);
    assert.strictEqual(Object.hasOwn(r.values, 'pa_f'), false);
  });

  it('treats @nonexistent as a literal value', async () => {
    const r = await resolve([v('pa_f')], { pa_f: '@/no/such/file' }, false);
    assert.strictEqual(r.values.pa_f, '@/no/such/file');
  });

  it('rejects with a UsageError when @path is a directory', async () => {
    const dir = mkdtempSync(join(tmp, 'subdir-'));
    await assert.rejects(
      () => resolve([v('pa_f')], { pa_f: `@${dir}` }, false),
      (err: any) =>
        err.name === 'UsageError' &&
        /Variable "pa_f": @.*is a directory/.test(err.message) &&
        /pass @FILE with one value per line/.test(err.message),
    );
  });

  it('rejects with a UsageError naming the cause when @path exists but cannot be read', async () => {
    // A Unix socket passes existsSync but open(2) refuses it (ENXIO on
    // Linux, EOPNOTSUPP on macOS), so this is the non-EISDIR read-failure
    // arm regardless of the user running the tests. Bound under os.tmpdir()
    // to stay inside sun_path's ~100-byte limit.
    const sockDir = mkdtempSync(join(tmpdir(), 'pa-'));
    const sock = join(sockDir, 's');
    const server = createServer();
    await new Promise<void>((res) => server.listen(sock, res));
    try {
      await assert.rejects(
        () => resolve([v('pa_f')], { pa_f: `@${sock}` }, false),
        (err: any) =>
          err.name === 'UsageError' &&
          err.message.startsWith(`Variable "pa_f": could not read @${sock}: `) &&
          !/is a directory/.test(err.message),
      );
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      rmSync(sockDir, { recursive: true, force: true });
    }
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

  it('** in the middle matches zero or more directory levels', async () => {
    const dir = join(tmp, 'starstar-mid');
    mkdirSync(join(dir, 'x', 'y'), { recursive: true });
    writeFileSync(join(dir, 'a.go'), '');
    writeFileSync(join(dir, 'x', 'b.go'), '');
    writeFileSync(join(dir, 'x', 'y', 'c.go'), '');
    writeFileSync(join(dir, 'x', 'y', 'd.txt'), '');
    const r = await resolve([v('pa_f')], { pa_f: `${dir}/**/*.go` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [join(dir, 'a.go'), join(dir, 'x', 'b.go'), join(dir, 'x', 'y', 'c.go')],
    );
  });

  it('trailing ** matches every descendant file and directory', async () => {
    const dir = join(tmp, 'starstar-end');
    mkdirSync(join(dir, 'x', 'y'), { recursive: true });
    writeFileSync(join(dir, 'top.txt'), '');
    writeFileSync(join(dir, '.hid.txt'), '');
    writeFileSync(join(dir, 'x', 'mid.txt'), '');
    writeFileSync(join(dir, 'x', 'y', 'deep.txt'), '');
    const r = await resolve([v('pa_f')], { pa_f: `${dir}/**` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [
        dir,
        join(dir, 'top.txt'),
        join(dir, 'x'),
        join(dir, 'x', 'mid.txt'),
        join(dir, 'x', 'y'),
        join(dir, 'x', 'y', 'deep.txt'),
      ],
    );
  });

  it('trailing ** with no subdirectories still returns the files', async () => {
    const dir = join(tmp, 'starstar-flat');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.txt'), '');
    writeFileSync(join(dir, 'b.txt'), '');
    const r = await resolve([v('pa_f')], { pa_f: `${dir}/**` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [dir, join(dir, 'a.txt'), join(dir, 'b.txt')],
    );
  });

  it('** skips dot-directories', async () => {
    const dir = join(tmp, 'starstar-dot');
    mkdirSync(join(dir, '.hidden'), { recursive: true });
    mkdirSync(join(dir, 'x'), { recursive: true });
    writeFileSync(join(dir, '.hidden', 'h.go'), '');
    writeFileSync(join(dir, 'x', 'v.go'), '');
    const r = await resolve([v('pa_f')], { pa_f: `${dir}/**/*.go` }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), [join(dir, 'x', 'v.go')]);
  });

  it('trailing ** under a plain file yields just that file (ENOTDIR readdir is swallowed)', async () => {
    // descendantDirs() and filesIn() both readdir their base; when the base
    // is a regular file that throws ENOTDIR, and both must treat it as empty
    // rather than surface the error.
    const dir = join(tmp, 'starstar-file-base');
    mkdirSync(dir);
    const file = join(dir, 'leaf.txt');
    writeFileSync(file, '');
    const r = await resolve([v('pa_f')], { pa_f: `${file}/**` }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), [file]);
  });

  it('keeps a non-matching ** pattern literal', async () => {
    const dir = join(tmp, 'starstar-none');
    mkdirSync(dir);
    const pattern = `${dir}/**/*.go`;
    const r = await resolve([v('pa_f')], { pa_f: pattern }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), [pattern]);
  });

  it('expands globs inside a comma-separated value, keeping piece order', async () => {
    // The .md piece is listed first but sorts after the .ts files, so a
    // global re-sort of the whole expansion would fail this assertion:
    // pieces must keep their written order, with each glob sorted internally.
    const dir = join(tmp, 'commaglob');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    writeFileSync(join(dir, 'c.md'), '');
    const r = await resolve([v('pa_f')], { pa_f: `${join(dir, '*.md')},${join(dir, '*.ts')}` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [join(dir, 'c.md'), join(dir, 'a.ts'), join(dir, 'b.ts')],
    );
  });

  it('keeps a non-matching glob piece literal, in place, inside a comma-separated value', async () => {
    const dir = join(tmp, 'commaglob-miss');
    mkdirSync(dir);
    writeFileSync(join(dir, 'z.ts'), '');
    const miss = join(dir, 'nope', '*.zzz');
    const r = await resolve([v('pa_f')], { pa_f: `${miss},${join(dir, '*.ts')},plain.md` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [miss, join(dir, 'z.ts'), 'plain.md'],
    );
  });

  it('expands glob lines inside an @file list, keeping line order', async () => {
    // 'literal.md' sorts before the matched .txt files; keeping it last
    // proves lines are expanded individually rather than re-sorted as a whole.
    const dir = join(tmp, 'listglob');
    mkdirSync(dir);
    writeFileSync(join(dir, 'x.txt'), '');
    writeFileSync(join(dir, 'y.txt'), '');
    const listFile = join(dir, 'list.lst');
    writeFileSync(listFile, `${join(dir, '*.txt')}\nliteral.md\n`);
    const r = await resolve([v('pa_f')], { pa_f: `@${listFile}` }, false);
    assert.deepStrictEqual(
      r.iterations.map(i => i.pa_f),
      [join(dir, 'x.txt'), join(dir, 'y.txt'), 'literal.md'],
    );
  });

  it('keeps a non-matching glob line literal inside an @file list', async () => {
    const dir = join(tmp, 'listglob-miss');
    mkdirSync(dir);
    writeFileSync(join(dir, 'only.txt'), '');
    const miss = join(dir, 'nope', '*.zzz');
    const listFile = join(dir, 'list.lst');
    writeFileSync(listFile, `${miss}\n${join(dir, '*.txt')}\n`);
    const r = await resolve([v('pa_f')], { pa_f: `@${listFile}` }, false);
    assert.deepStrictEqual(r.iterations.map(i => i.pa_f), [miss, join(dir, 'only.txt')]);
  });

  it('collapses a comma-separated value whose single matching piece expands to one file into a scalar', async () => {
    const dir = join(tmp, 'commaglob-one');
    mkdirSync(dir);
    writeFileSync(join(dir, 'solo.ts'), '');
    // Trailing comma leaves one piece; a one-file glob is not an array.
    const r = await resolve([v('pa_f')], { pa_f: `${join(dir, '*.ts')},` }, false);
    assert.strictEqual(r.values.pa_f, join(dir, 'solo.ts'));
    assert.deepStrictEqual(r.iterations, [bare({ pa_f: join(dir, 'solo.ts') })]);
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

  it('treats \\, in an interactive answer as a literal comma', async () => {
    const r = await withStdin('returns 200\\, not 500\n', () =>
      resolve([v('pa_ask')], {}, true),
    );
    assert.strictEqual(r.values.pa_ask, 'returns 200, not 500');
    assert.strictEqual(r.iterations.length, 1);
  });

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

  it('resolves a separator-only interactive answer to the empty string', async () => {
    // Unlike the flag path, which leaves the variable absent, an answered
    // prompt always produces a value: a ',' with nothing around it is ''.
    const r = await withStdin(',\n', () =>
      resolve([v('pa_ask')], {}, true),
    );
    assert.strictEqual(r.values.pa_ask, '');
    assert.deepStrictEqual(r.iterations, [bare({ pa_ask: '' })]);
  });

  it('rejects with a UsageError when stdin ends before an answer', async () => {
    const fake = new Readable({ read() { this.push(null); } });
    const desc = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
    try {
      await assert.rejects(
        resolve([v('pa_eof')], {}, true),
        (err: Error) =>
          err.name === 'UsageError' && /Variable "pa_eof" has no value and stdin is closed/.test(err.message),
      );
    } finally {
      Object.defineProperty(process, 'stdin', desc);
    }
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

// Regression for the (default) status label: it must follow provenance
// (the value was filled from the template default), not value equality.
describe('resolve default provenance', () => {
  it('records a variable filled from its template default', async () => {
    const r = await resolve([v('pa_x', 'dflt')], {}, false);
    assert.deepStrictEqual([...r.defaulted], ['pa_x']);
  });

  it('does not record an explicit flag that equals the default', async () => {
    const r = await resolve([v('pa_x', 'same')], { pa_x: 'same' }, false);
    assert.strictEqual(r.values.pa_x, 'same');
    assert.strictEqual(r.defaulted.size, 0);
  });

  it('does not record an autodetected value that equals the default', async () => {
    process.env.pa_env_same = 'same';
    try {
      const r = await resolve([v('pa_env_same', 'same')], {}, false);
      assert.strictEqual(r.values.pa_env_same, 'same');
      assert.strictEqual(r.defaulted.size, 0);
    } finally {
      delete process.env.pa_env_same;
    }
  });

  it('records a default reached through an empty @file expansion', async () => {
    const emptyFile = join(tmp, 'empty-prov.txt');
    writeFileSync(emptyFile, '\n');
    const r = await resolve([v('pa_f', 'dflt')], { pa_f: `@${emptyFile}` }, false);
    assert.deepStrictEqual([...r.defaulted], ['pa_f']);
  });

  it('leaves unfilled variables out of the set', async () => {
    const r = await resolve([v('pa_missing')], {}, false);
    assert.ok(!('pa_missing' in r.values));
    assert.strictEqual(r.defaulted.size, 0);
  });

  it('returns the same set alongside array iterations', async () => {
    const r = await resolve([v('pa_f'), v('pa_d', 'dflt')], { pa_f: 'a,b' }, false);
    assert.strictEqual(r.iterations.length, 2);
    assert.deepStrictEqual([...r.defaulted], ['pa_d']);
  });
});

describe('resolve ** glob conformance against fs.globSync', () => {
  let fixture: string;
  const originalCwd = process.cwd();

  before(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'pa-glob-')));
    for (const d of ['sub/.dot', 'sub/deep', 'a/x/b', 'a/b']) {
      mkdirSync(join(fixture, d), { recursive: true });
    }
    for (const f of [
      'a.txt', '.hidden', 'sub/b.ext', 'sub/.dot/c.ext', 'sub/.h.ext',
      'sub/deep/d.ext', 'a/x/b/e.ext', 'a/b/f.ext', 'a/g.ext',
    ]) {
      writeFileSync(join(fixture, f), '');
    }
  });

  after(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  async function expand(pattern: string): Promise<string[]> {
    process.chdir(fixture);
    try {
      const r = await resolve([v('pa_glob')], { pa_glob: pattern }, false);
      return r.iterations.map(i => i.pa_glob).sort();
    } finally {
      process.chdir(originalCwd);
    }
  }

  // Allowed deltas between the resolver and fs.globSync(pattern, { cwd }),
  // applied to the globSync side. Anything else must match exactly:
  //  1. A trailing slash is ignored by the resolver (it does not restrict
  //     matches to directories), so the slash is stripped from the pattern.
  //  2. The relative cwd base ('.' / '') is never a value, even for a
  //     trailing `**` (the base directory is otherwise included: `a/**`
  //     yields `a`, absolute `<dir>/**` yields `<dir>`).
  //  3. Hidden entries are skipped unless the pattern names a dot segment.
  function expected(pattern: string): string[] {
    const stripped = pattern.replace(/\/+$/, '');
    let out = globSync(stripped, { cwd: fixture }) as string[];
    out = out.filter(e => e !== '' && e !== '.');
    const dotPattern = stripped.split('/').some(seg => seg.startsWith('.') && seg !== '.');
    if (!dotPattern) {
      out = out.filter(e =>
        e
          
          .split('/')
          .every(seg => !seg.startsWith('.')),
      );
    }
    return out.sort();
  }

  const relative = [
    '**',
    '**/**',
    './**',
    'a/**',
    './a/**',
    '**/b',
    'a/**/b',
    '**/*.ext',
    'a/**/b/*.ext',
    '*/',
    'a/**/',
    '**/',
    '*',
    '.*',
    './.*',
    '**/.*',
    'sub/.*/*.ext',
    'sub/**/*.ext',
  ];

  for (const pattern of relative) {
    it(`matches globSync for ${JSON.stringify(pattern)}`, async () => {
      const got = await expand(pattern);
      assert.deepStrictEqual(got, expected(pattern));
      assert.ok(!got.includes(''), 'empty-string value leaked');
      assert.ok(!got.includes('.'), 'cwd base leaked');
    });
  }

  const absolute = ['/**', '/a/**', '/a/**/', '/**/*.ext', '/a/**/b', '/.*', '/**/.*'];

  for (const suffix of absolute) {
    it(`matches globSync for absolute <fixture>${suffix}`, async () => {
      const pattern = fixture + suffix;
      const got = await expand(pattern);
      const want = (globSync(pattern.replace(/\/+$/, '')) as string[]);
      const dotPattern = suffix.split('/').some(seg => seg.startsWith('.'));
      const filtered = dotPattern
        ? want
        : want.filter(e =>
            e
              .slice(fixture.length)
              .split('/')
              .every(seg => !seg.startsWith('.')),
          );
      assert.deepStrictEqual(got, filtered.sort());
    });
  }
});
