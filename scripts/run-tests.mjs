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

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
