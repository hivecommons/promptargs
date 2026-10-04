import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function findTestFiles(dir, suffix) {
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
const testFiles = [...findTestFiles('dist', '.test.js'), ...findTestFiles('scripts', '.test.mjs')];

if (testFiles.length === 0) {
  console.error('No compiled test files found in dist/. Run npm run build first.');
  process.exit(1);
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
function supportsCoverageThresholds() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 8);
}

const withCoverage = process.argv.includes('--coverage')
  ? true
  : process.argv.includes('--no-coverage')
    ? false
    : supportsCoverageThresholds();
const coverageArgs = withCoverage
  ? [
      '--experimental-test-coverage',
      '--test-coverage-exclude=dist/**/*.test.js',
      '--test-coverage-exclude=scripts/**/*.test.mjs',
      '--test-coverage-lines=98',
      '--test-coverage-branches=96',
      '--test-coverage-functions=100',
    ]
  : [];

const result = spawnSync(process.execPath, ['--test', ...coverageArgs, ...testFiles], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
