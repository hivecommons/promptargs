import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function findTestFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? findTestFiles(path) : path;
    })
    .filter((path) => path.endsWith('.test.js'))
    .sort();
}

const testFiles = findTestFiles('dist');

if (testFiles.length === 0) {
  console.error('No compiled test files found in dist/. Run npm run build first.');
  process.exit(1);
}

// Coverage thresholds require Node >= 22.8 for the --test-coverage-* flags.
// Test files are excluded from the measurement: they contain
// environment-dependent callbacks (e.g. EACCES skip paths vs. privileged-port
// binds) that no single environment can fully execute, so including them makes
// 100% function coverage unreachable. Thresholds sit just below the
// source-only baseline (99.59% lines / 99.45% branches / 100% functions) so
// regressions fail CI without making every unreachable-branch judgement call
// a build break.
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
      '--test-coverage-lines=97',
      '--test-coverage-branches=92',
      '--test-coverage-functions=100',
    ]
  : [];

const result = spawnSync(process.execPath, ['--test', ...coverageArgs, ...testFiles], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
