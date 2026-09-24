import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autodetect, autodetectAll, AUTODETECT_VARS } from './autodetect.js';

// git-backed detectors read the process cwd, so run them inside a scratch
// repo with a known origin remote (each test file is its own process).
let repo: string;
let prevCwd: string;

before(() => {
  prevCwd = process.cwd();
  repo = mkdtempSync(join(tmpdir(), 'pa-auto-'));
  process.chdir(repo);
  const run = (cmd: string) => execSync(cmd, { stdio: 'pipe' });
  run('git init -q -b pa-test-branch');
  run('git config user.email pa@test.local');
  run('git config user.name "PA Tester"');
  run('git remote add origin https://github.com/pa-test-org/pa-test-repo.git');
  run('git commit -q --allow-empty -m init');
});

after(() => {
  process.chdir(prevCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe('git detectors', () => {
  it('detects the current branch', () => {
    assert.strictEqual(autodetect('branch'), 'pa-test-branch');
  });

  it('detects repo name from the origin remote, stripping .git', () => {
    assert.strictEqual(autodetect('repo'), 'pa-test-repo');
  });

  it('detects the org from the origin remote', () => {
    assert.strictEqual(autodetect('org'), 'pa-test-org');
  });

  it('detects repo/org from ssh-style remotes', () => {
    execSync('git remote set-url origin git@github.com:ssh-org/ssh-repo.git', { stdio: 'pipe' });
    try {
      assert.strictEqual(autodetect('repo'), 'ssh-repo');
      assert.strictEqual(autodetect('org'), 'ssh-org');
    } finally {
      execSync('git remote set-url origin https://github.com/pa-test-org/pa-test-repo.git', { stdio: 'pipe' });
    }
  });

  it('detects the git user name', () => {
    assert.strictEqual(autodetect('user'), 'PA Tester');
  });
});

describe('date detector', () => {
  it('returns an ISO date (YYYY-MM-DD)', () => {
    assert.match(autodetect('date')!, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('environment fallback', () => {
  it('falls back to environment variables for unknown names', () => {
    process.env.pa_custom_var = 'env-value';
    try {
      assert.strictEqual(autodetect('pa_custom_var'), 'env-value');
    } finally {
      delete process.env.pa_custom_var;
    }
  });

  it('returns undefined for unknown names not in the environment', () => {
    assert.strictEqual(autodetect('pa_definitely_not_set'), undefined);
  });
});

describe('autodetectAll', () => {
  it('collects only detectable values', () => {
    const result = autodetectAll(['branch', 'pa_definitely_not_set', 'date']);
    assert.strictEqual(result.branch, 'pa-test-branch');
    assert.ok('date' in result);
    assert.ok(!('pa_definitely_not_set' in result));
  });

  it('AUTODETECT_VARS lists the built-in detectors', () => {
    for (const name of ['branch', 'repo', 'org', 'diff', 'pr', 'user', 'date']) {
      assert.ok(AUTODETECT_VARS.includes(name), `missing ${name}`);
    }
  });
});
