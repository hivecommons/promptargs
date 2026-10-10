import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findTestFiles(dir, suffix) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? findTestFiles(path, suffix) : path;
    })
    .filter((path) => path.endsWith(suffix))
    .sort();
}

// Compiled source tests live in dist/; tests for the release tooling itself
// (plain ESM, nothing to compile) live next to it in scripts/.
export const TEST_SOURCES = [
  ['dist', '.test.js'],
  ['scripts', '.test.mjs'],
];

export function collectTestFiles(root = '.') {
  return TEST_SOURCES.flatMap(([dir, suffix]) => findTestFiles(join(root, dir), suffix));
}

// Coverage thresholds require Node >= 22.8 for the --test-coverage-* flags.
// Test files are excluded from the measurement: they contain
// environment-dependent callbacks (e.g. EACCES skip paths vs. privileged-port
// binds) that no single environment can fully execute, so including them makes
// 100% function coverage unreachable. Thresholds sit just below the
// source-only baseline (99.61% lines / 97.50% branches / 100% functions once
// the ui.html script fragments compiled by src/ui-harness.ts — reported under
// .test-scratch/ui-inline/ — joined the measurement) so regressions fail CI
// without making every unreachable-branch judgement call a build break. The
// remaining uncovered ui.js lines are exercised in spawned child processes
// (they call process.exit), which in-process coverage cannot observe.
//
// Enforcement is automatic on runtimes that support it, so plain `npm test`
// (what CI runs) gates coverage on the Node 22+ matrix legs. Pass
// --no-coverage to opt out, or --coverage to force it on older runtimes.
export function supportsCoverageThresholds(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 8);
}

export function coverageEnabled(argv, version = process.versions.node) {
  if (argv.includes('--coverage')) return true;
  if (argv.includes('--no-coverage')) return false;
  return supportsCoverageThresholds(version);
}

export const COVERAGE_ARGS = [
  '--experimental-test-coverage',
  '--test-coverage-exclude=dist/**/*.test.js',
  '--test-coverage-exclude=scripts/**/*.test.mjs',
  '--test-coverage-lines=98',
  '--test-coverage-branches=96',
  '--test-coverage-functions=100',
];

// Per-test ceiling so an async hang (a server never closed, a promise never
// settled) fails with the test's name instead of running to the CI job's
// 10-minute limit. It cannot interrupt a blocking spawnSync: those need their
// own `timeout:` option, which spawn-timeout-guard.test.ts enforces.
export const TEST_TIMEOUT_ARGS = ['--test-timeout=60000'];

export function buildNodeArgs(testFiles, argv, version = process.versions.node) {
  const coverageArgs = coverageEnabled(argv, version) ? COVERAGE_ARGS : [];
  return ['--test', ...TEST_TIMEOUT_ARGS, ...coverageArgs, ...testFiles];
}

// startUI (through collectEnvVars) and autodetect('pr') run the real `gh pr
// view` with no timeout of their own. A slow or hung `gh` — a stalled proxy,
// an auth prompt, no network — then stalls every test that reaches them for
// as long as `gh` takes, and once that passes the 15 s / 30 s spawn guards in
// ui.test.ts and cli.test.ts the suite goes red for reasons unrelated to the
// change under test. No test wants a real PR number, so the whole run gets a
// `gh` that fails instantly, first on PATH; a test that needs a specific `gh`
// behaviour prepends its own shim on top of it (see autodetect.test.ts).
export function writeGhShim(dir) {
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(dir, 'gh.cmd'), '@exit /b 1\r\n');
  return dir;
}

export function hermeticEnv(env, shimDir) {
  // Windows spells the variable `Path`; keep whichever key the caller has.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [pathKey]: `${shimDir}${delimiter}${env[pathKey] ?? ''}` };
}

export function runTests(argv, { root = '.', spawn = spawnSync, log = console.error } = {}) {
  const testFiles = collectTestFiles(root);

  if (testFiles.length === 0) {
    log('No compiled test files found in dist/. Run npm run build first.');
    return 1;
  }

  const shimDir = writeGhShim(mkdtempSync(join(tmpdir(), 'promptargs-gh-shim-')));
  try {
    const result = spawn(process.execPath, buildNodeArgs(testFiles, argv), {
      stdio: 'inherit',
      env: hermeticEnv(process.env, shimDir),
    });
    return result.status ?? 1;
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runTests(process.argv.slice(2)));
}
