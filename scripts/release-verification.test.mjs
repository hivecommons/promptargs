import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Exercise the actual inline workflow step without publishing or sleeping.
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const marker = '      - name: Verify the version is live on npm\n        run: |\n';
assert.ok(workflow.includes(marker));
const script = workflow.split(marker)[1].split('\n      - ')[0]
  .split('\n').map((line) => line.replace(/^          /, '')).join('\n');

for (const [scenario, expectedStatus, expectedCalls, expectedSleeps] of [
  ['immediate', 0, 1, 0],
  ['delayed', 0, 3, 2],
  ['missing', 1, 6, 5],
  ['wrong', 1, 6, 5],
]) {
  test(`npm verification: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-release-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@hivecommons/promptargs' }));
      writeFileSync(join(dir, 'npm'), `#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_DIR/calls"
n=$(wc -l < "$MOCK_DIR/calls")
case "$SCENARIO" in
  immediate) echo 0.7.0 ;;
  delayed) if [ "$n" -ge 3 ]; then echo 0.7.0; else exit 1; fi ;;
  missing) exit 1 ;;
  wrong) echo 0.6.0 ;;
esac
`, { mode: 0o755 });
      writeFileSync(join(dir, 'sleep'), '#!/bin/bash\necho "$*" >> "$MOCK_DIR/sleeps"\n', { mode: 0o755 });
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: dir,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_DIR: dir, SCENARIO: scenario, RELEASE_TAG: 'v0.7.0' },
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(result.status, expectedStatus, result.stderr);
      const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
      assert.equal(calls.length, expectedCalls);
      for (const call of calls) {
        assert.equal(call, 'view @hivecommons/promptargs@0.7.0 version --registry=https://registry.npmjs.org');
      }
      if (expectedSleeps) {
        assert.deepEqual(readFileSync(join(dir, 'sleeps'), 'utf8').trim().split('\n'), Array(expectedSleeps).fill('10'));
      }
      if (expectedStatus) assert.match(result.stdout, /::error::npm does not serve @hivecommons\/promptargs@0\.7\.0 after publish/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
