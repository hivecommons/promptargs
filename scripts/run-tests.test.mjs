import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COVERAGE_ARGS,
  TEST_SOURCES,
  TEST_TIMEOUT_ARGS,
  buildNodeArgs,
  collectTestFiles,
  coverageEnabled,
  findTestFiles,
  runTests,
  supportsCoverageThresholds,
} from './run-tests.mjs';

const scratchRoots = [];
after(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'run-tests-'));
  scratchRoots.push(root);
  mkdirSync(join(root, 'dist'));
  mkdirSync(join(root, 'scripts'));
  return root;
}

test('findTestFiles recurses into subdirectories, filters by suffix and sorts', () => {
  const root = scratchRepo();
  mkdirSync(join(root, 'dist', 'nested'));
  writeFileSync(join(root, 'dist', 'z.test.js'), '');
  writeFileSync(join(root, 'dist', 'a.test.js'), '');
  writeFileSync(join(root, 'dist', 'a.js'), '');
  writeFileSync(join(root, 'dist', 'nested', 'm.test.js'), '');
  writeFileSync(join(root, 'dist', 'nested', 'm.test.js.map'), '');

  assert.deepEqual(findTestFiles(join(root, 'dist'), '.test.js'), [
    join(root, 'dist', 'a.test.js'),
    join(root, 'dist', 'nested', 'm.test.js'),
    join(root, 'dist', 'z.test.js'),
  ]);
});

test('collectTestFiles unions compiled dist tests with scripts/*.test.mjs', () => {
  const root = scratchRepo();
  writeFileSync(join(root, 'dist', 'cli.test.js'), '');
  writeFileSync(join(root, 'dist', 'cli.js'), '');
  writeFileSync(join(root, 'scripts', 'tool.test.mjs'), '');
  writeFileSync(join(root, 'scripts', 'tool.mjs'), '');
  // Plain .mjs tests under dist/ and .js tests under scripts/ are not picked up.
  writeFileSync(join(root, 'dist', 'stray.test.mjs'), '');
  writeFileSync(join(root, 'scripts', 'stray.test.js'), '');

  assert.deepEqual(collectTestFiles(root), [
    join(root, 'dist', 'cli.test.js'),
    join(root, 'scripts', 'tool.test.mjs'),
  ]);
  assert.deepEqual(TEST_SOURCES, [
    ['dist', '.test.js'],
    ['scripts', '.test.mjs'],
  ]);
});

test('collectTestFiles defaults to the current working directory', () => {
  const files = collectTestFiles();
  assert.ok(files.includes(join('scripts', 'run-tests.test.mjs')), files.join('\n'));
  assert.ok(files.some((f) => f.startsWith('dist') && f.endsWith('.test.js')), 'no dist tests found');
});

test('supportsCoverageThresholds requires Node >= 22.8', () => {
  assert.equal(supportsCoverageThresholds('18.20.4'), false);
  assert.equal(supportsCoverageThresholds('20.19.0'), false);
  assert.equal(supportsCoverageThresholds('22.7.9'), false);
  assert.equal(supportsCoverageThresholds('22.8.0'), true);
  assert.equal(supportsCoverageThresholds('22.12.0'), true);
  assert.equal(supportsCoverageThresholds('23.0.0'), true);
  assert.equal(supportsCoverageThresholds('26.10.0'), true);
  assert.equal(typeof supportsCoverageThresholds(), 'boolean');
});

test('coverageEnabled: explicit flags win, --coverage beats --no-coverage, else runtime decides', () => {
  assert.equal(coverageEnabled(['--coverage'], '18.0.0'), true);
  assert.equal(coverageEnabled(['--no-coverage'], '26.0.0'), false);
  assert.equal(coverageEnabled(['--no-coverage', '--coverage'], '18.0.0'), true);
  assert.equal(coverageEnabled([], '22.7.0'), false);
  assert.equal(coverageEnabled([], '22.8.0'), true);
  assert.equal(coverageEnabled([]), supportsCoverageThresholds());
});

test('COVERAGE_ARGS pin the thresholds and exclude only test files', () => {
  assert.ok(COVERAGE_ARGS.includes('--experimental-test-coverage'));
  assert.ok(COVERAGE_ARGS.includes('--test-coverage-lines=98'));
  assert.ok(COVERAGE_ARGS.includes('--test-coverage-branches=96'));
  assert.ok(COVERAGE_ARGS.includes('--test-coverage-functions=100'));
  const excludes = COVERAGE_ARGS.filter((a) => a.startsWith('--test-coverage-exclude='));
  assert.deepEqual(excludes, [
    '--test-coverage-exclude=dist/**/*.test.js',
    '--test-coverage-exclude=scripts/**/*.test.mjs',
  ]);
  // The runner itself must stay measurable: it is not excluded.
  assert.ok(!COVERAGE_ARGS.some((a) => a.includes('run-tests')));
});

test('buildNodeArgs puts --test first, then the per-test timeout, coverage flags, test files last', () => {
  const files = ['dist/a.test.js', 'scripts/b.test.mjs'];
  assert.deepEqual(buildNodeArgs(files, ['--coverage'], '18.0.0'), ['--test', ...TEST_TIMEOUT_ARGS, ...COVERAGE_ARGS, ...files]);
  assert.deepEqual(buildNodeArgs(files, ['--no-coverage'], '26.0.0'), ['--test', ...TEST_TIMEOUT_ARGS, ...files]);
  assert.deepEqual(buildNodeArgs(files, [], '20.0.0'), ['--test', ...TEST_TIMEOUT_ARGS, ...files]);
  assert.deepEqual(buildNodeArgs(files, [], '22.8.0'), ['--test', ...TEST_TIMEOUT_ARGS, ...COVERAGE_ARGS, ...files]);
  assert.deepEqual(buildNodeArgs(files, []), buildNodeArgs(files, [], process.versions.node));
});

test('TEST_TIMEOUT_ARGS pins a per-test ceiling well inside the 10-minute CI job timeout', () => {
  assert.deepEqual(TEST_TIMEOUT_ARGS, ['--test-timeout=60000']);
});

test('runTests reports an empty dist/ and returns 1 without spawning', () => {
  const root = scratchRepo();
  const logged = [];
  const result = runTests([], {
    root,
    log: (msg) => logged.push(msg),
    spawn: () => assert.fail('spawn must not be called'),
  });
  assert.equal(result, 1);
  assert.deepEqual(logged, ['No compiled test files found in dist/. Run npm run build first.']);
});

test('runTests spawns node --test on the discovered files and returns its status', () => {
  const root = scratchRepo();
  writeFileSync(join(root, 'dist', 'a.test.js'), '');
  writeFileSync(join(root, 'scripts', 'b.test.mjs'), '');
  const calls = [];
  const result = runTests(['--no-coverage'], {
    root,
    log: () => assert.fail('nothing to log'),
    spawn: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return { status: 3 };
    },
  });
  assert.equal(result, 3);
  assert.deepEqual(calls, [
    {
      cmd: process.execPath,
      args: ['--test', ...TEST_TIMEOUT_ARGS, join(root, 'dist', 'a.test.js'), join(root, 'scripts', 'b.test.mjs')],
      options: { stdio: 'inherit' },
    },
  ]);
});

test('runTests forwards coverage flags and maps a signal-killed run (null status) to 1', () => {
  const root = scratchRepo();
  writeFileSync(join(root, 'dist', 'a.test.js'), '');
  let seen;
  const result = runTests(['--coverage'], {
    root,
    spawn: (_cmd, args) => {
      seen = args;
      return { status: null, signal: 'SIGKILL' };
    },
  });
  assert.equal(result, 1);
  assert.deepEqual(seen, ['--test', ...TEST_TIMEOUT_ARGS, ...COVERAGE_ARGS, join(root, 'dist', 'a.test.js')]);
});

// package.json `test` runs `node scripts/run-tests.mjs`; these cover the
// process boundary the exported helpers sit behind.
const SCRIPT = fileURLToPath(new URL('./run-tests.mjs', import.meta.url));

// Drop the test runner's own context variables: inherited by the nested
// `node --test`, they would make it behave as a child of this run. The
// coverage directory must be present-but-empty rather than deleted —
// child_process re-injects the parent's value for a missing key — or the
// scratch fixtures' coverage merges into the real report.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST'))),
  NODE_V8_COVERAGE: '',
};

function runScript(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8', timeout: 30000 });
}

test('CLI exits 1 with a build hint when no test files exist', () => {
  const root = scratchRepo();
  const result = runScript([], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No compiled test files found in dist\/\. Run npm run build first\./);
});

test('CLI runs discovered tests and propagates a passing exit code', () => {
  const root = scratchRepo();
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(root, 'dist', 'ok.test.js'),
    "import { after, test } from 'node:test';\ntest('passes', () => {});\n",
  );
  const result = runScript(['--no-coverage'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\bpass 1\b/);
});

test('CLI propagates a failing exit code from the test run', () => {
  const root = scratchRepo();
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(root, 'dist', 'bad.test.js'),
    "import { after, test } from 'node:test';\ntest('fails', () => { throw new Error('boom'); });\n",
  );
  const result = runScript(['--no-coverage'], root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\bfail 1\b/);
});

// Node < 22.8 rejects the --test-coverage-* flags outright, so there is no
// threshold behaviour to observe there; run-tests.mjs only enables them on
// runtimes that support them (see supportsCoverageThresholds).
test('CLI --coverage enforces the thresholds against the measured files', { skip: !supportsCoverageThresholds() }, () => {
  const root = scratchRepo();
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  // One exported function never called: 0% functions, so the 100% gate must trip.
  writeFileSync(join(root, 'dist', 'lib.js'), 'export function unused() { return 1; }\n');
  writeFileSync(
    join(root, 'dist', 'lib.test.js'),
    "import { after, test } from 'node:test';\nimport './lib.js';\ntest('imports only', () => {});\n",
  );
  const result = runScript(['--coverage'], root);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /coverage/i);
});
