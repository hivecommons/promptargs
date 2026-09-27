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

// --coverage enforces coverage thresholds (requires Node >= 22.8 for the
// --test-coverage-* flags). Thresholds sit just below the current baseline
// (99.57% lines / 95.00% branches / 100% functions) so regressions fail CI
// without making every unreachable-branch judgement call a build break.
const withCoverage = process.argv.includes('--coverage');
const coverageArgs = withCoverage
  ? [
      '--experimental-test-coverage',
      '--test-coverage-lines=97',
      '--test-coverage-branches=92',
      '--test-coverage-functions=100',
    ]
  : [];

const result = spawnSync(process.execPath, ['--test', ...coverageArgs, ...testFiles], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
