import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// package.json "files" decides what `npm publish` ships. It has regressed
// before (#151: 51 compiled test files, 65% of the tarball) and the fix was a
// hand-edited glob list with no test behind it. Ask npm itself what it would
// pack and pin the contract from both sides: nothing test-only leaks in, and
// nothing the CLI/UI/API loads at runtime falls out.

interface PackEntry {
  path: string;
}

interface PackReport {
  files: PackEntry[];
}

function npmPackDryRun(): string[] {
  // Under `npm test`, npm_execpath points at the running npm's CLI script, so
  // the check uses the same npm that would publish. Fall back to PATH when the
  // test file is run directly with `node --test`.
  const npmCli = process.env.npm_execpath;
  const res = npmCli
    ? spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: ROOT,
        encoding: 'utf-8',
      })
    : spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: ROOT,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      });
  assert.strictEqual(res.status, 0, `npm pack --dry-run failed:\n${res.stderr}`);
  const report = JSON.parse(res.stdout) as PackReport[];
  assert.strictEqual(report.length, 1, 'expected exactly one packed package');
  return report[0].files.map((f) => f.path).sort();
}

const packed = npmPackDryRun();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
  main: string;
  bin: Record<string, string>;
};

test('tarball ships no compiled test files', () => {
  const leaked = packed.filter((p) => /\.test\.(js|js\.map|d\.ts)$/.test(p));
  assert.deepStrictEqual(leaked, [], `test files leaked into the tarball:\n${leaked.join('\n')}`);
});

test('tarball ships no test scratch output', () => {
  const scratch = packed.filter((p) => p.startsWith('.test-scratch/'));
  assert.deepStrictEqual(scratch, []);
});

test('tarball ships package.json, README and LICENSE', () => {
  for (const f of ['package.json', 'README.md', 'LICENSE']) {
    assert.ok(packed.includes(f), `${f} missing from tarball`);
  }
});

test('"main" and every "bin" target are in the tarball', () => {
  assert.ok(packed.includes(pkg.main), `main ${pkg.main} missing from tarball`);
  for (const [name, target] of Object.entries(pkg.bin)) {
    assert.ok(packed.includes(target), `bin "${name}" -> ${target} missing from tarball`);
  }
});

// Everything dist/cli.js reaches at runtime, directly or transitively, plus
// the two non-TypeScript assets `npm run build` copies into dist/ by hand
// (ui.html is read from disk by startUI; mustache.mjs is served to the
// browser through STATIC_JS_ROUTES).
const RUNTIME_FILES = [
  'dist/autodetect.js',
  'dist/cli.js',
  'dist/index.js',
  'dist/iterate.js',
  'dist/loader.js',
  'dist/mustache.mjs',
  'dist/parser.js',
  'dist/resolver.js',
  'dist/sanitize.js',
  'dist/status.js',
  'dist/ui.html',
  'dist/ui.js',
];

test('every runtime module and asset is in the tarball', () => {
  const missing = RUNTIME_FILES.filter((f) => !packed.includes(f));
  assert.deepStrictEqual(missing, [], `runtime files missing from tarball:\n${missing.join('\n')}`);
});

test('every shipped runtime module has its .d.ts alongside', () => {
  const jsModules = packed.filter((p) => p.startsWith('dist/') && p.endsWith('.js'));
  const missing = jsModules.filter((p) => !packed.includes(p.replace(/\.js$/, '.d.ts')));
  assert.deepStrictEqual(missing, [], `modules shipped without types:\n${missing.join('\n')}`);
});

test('static routes the UI serves to the browser are all in the tarball', () => {
  // Mirror STATIC_JS_ROUTES in src/ui.ts: if a route is added there without
  // the file reaching the tarball, the installed UI 404s on page load.
  const uiSource = readFileSync(join(__dirname, 'ui.js'), 'utf-8');
  const routeBlock = /STATIC_JS_ROUTES\s*=\s*\{([\s\S]*?)\};/.exec(uiSource);
  assert.ok(routeBlock, 'STATIC_JS_ROUTES not found in dist/ui.js');
  const targets = [...routeBlock[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, 'STATIC_JS_ROUTES has no entries');
  for (const t of targets) {
    assert.ok(packed.includes(`dist/${t}`), `UI static route target dist/${t} missing from tarball`);
  }
});
