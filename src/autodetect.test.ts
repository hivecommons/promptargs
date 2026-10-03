import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { autodetect, autodetectAll, isSensitiveEnvName, isSensitiveEnvValue, AUTODETECT_VARS } from './autodetect.js';

// git-backed detectors read the process cwd, so run them inside a scratch
// repo with a known origin remote (each test file is its own process).
let repo: string;
let prevCwd: string;

before(() => {
  prevCwd = process.cwd();
  repo = mkdtempSync(join(process.cwd(), '.pa-auto-'));
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

  it('returns undefined for branch on a detached HEAD', () => {
    // `git branch --show-current` exits 0 and prints nothing when detached;
    // that must not become an empty value that beats the template default.
    execSync('git checkout -q --detach', { stdio: 'pipe' });
    try {
      assert.strictEqual(autodetect('branch'), undefined);
      assert.ok(!('branch' in autodetectAll(['branch'])));
    } finally {
      execSync('git checkout -q pa-test-branch', { stdio: 'pipe' });
    }
  });

  it('returns undefined for diff on a clean tree and the diff once there is one', () => {
    assert.strictEqual(autodetect('diff'), undefined);
    writeFileSync(join(repo, 'tracked.txt'), 'one\n');
    execSync('git add tracked.txt && git commit -q -m add', { stdio: 'pipe' });
    writeFileSync(join(repo, 'tracked.txt'), 'two\n');
    try {
      assert.match(autodetect('diff') ?? '', /^diff --git a\/tracked\.txt/);
    } finally {
      execSync('git checkout -q -- tracked.txt', { stdio: 'pipe' });
    }
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

  it('never expands credential-looking env vars', () => {
    process.env.PA_TEST_TOKEN = 'sekrit';
    process.env.PA_TEST_API_KEY = 'sekrit';
    try {
      assert.strictEqual(autodetect('PA_TEST_TOKEN'), undefined);
      assert.strictEqual(autodetect('PA_TEST_API_KEY'), undefined);
    } finally {
      delete process.env.PA_TEST_TOKEN;
      delete process.env.PA_TEST_API_KEY;
    }
  });

  it('never expands credential-shaped values under innocuous names', () => {
    process.env.PA_TEST_DATABASE_URL = 'postgres://app:hunter2@db.internal/app';
    process.env.PA_TEST_PLAIN_URL = 'postgres://db.internal/app';
    try {
      assert.strictEqual(autodetect('PA_TEST_DATABASE_URL'), undefined);
      assert.strictEqual(autodetect('PA_TEST_PLAIN_URL'), 'postgres://db.internal/app');
    } finally {
      delete process.env.PA_TEST_DATABASE_URL;
      delete process.env.PA_TEST_PLAIN_URL;
    }
  });
});

describe('isSensitiveEnvName', () => {
  it('flags credential-looking names', () => {
    for (const name of [
      'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'MY_SECRET', 'DB_PASSWORD',
      'PGPASSWD', 'AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY', 'APIKEY',
      'GOOGLE_APPLICATION_CREDENTIALS', 'SSH_PRIVATE_KEY', 'AUTH_HEADER',
      'X_AUTH', 'SESSION_COOKIE', 'BEARER_VALUE', 'gh_token',
      // Suffix conventions outside API_/ACCESS_/PRIVATE_KEY
      'OPENAI_KEY', 'STRIPE_KEY', 'SIGNING_KEY', 'ENCRYPTION_KEY', 'HIVE_HEARTBEAT_KEY',
      'LICENSE_KEY', 'SSH_KEYS', 'KEY', 'MYSQL_PWD', 'ORACLE_PWD', 'GITHUB_PAT', 'AZURE_DEVOPS_PAT',
      'PAT', 'GIT_PASS', 'SSH_PASSPHRASE', 'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK', 'SENTRY_DSN',
      'DB_CONNECTION_STRING', 'AZURE_CONN_STR', 'JWT_SIGNING', 'HMAC_VALUE', 'OAUTH_CLIENT_ID',
    ]) {
      assert.strictEqual(isSensitiveEnvName(name), true, `should flag ${name}`);
    }
  });

  it('does not flag ordinary names', () => {
    for (const name of [
      'EDITOR', 'PATH', 'GOPATH', 'AUTHOR', 'AUTHORIZED_USERS_FILE', 'branch', 'KEYBOARD',
      'PWD', 'OLDPWD', 'PATTERN', 'PATCH_LEVEL', 'PASSENGER_COUNT', 'MONKEY', 'DSNAME', 'COMPASS',
    ]) {
      assert.strictEqual(isSensitiveEnvName(name), false, `should not flag ${name}`);
    }
  });
});

describe('isSensitiveEnvValue', () => {
  it('flags credential-shaped values regardless of name', () => {
    for (const value of [
      'postgres://app:hunter2@db.internal:5432/app',
      'redis://:p4ss@cache.internal/0',
      'mongodb+srv://user:pw@cluster0.example.net/db',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      'ghp_' + 'A'.repeat(36),
      'github_pat_' + 'A'.repeat(22) + '_' + 'b'.repeat(59),
      'glpat-' + 'x'.repeat(20),
      'sk-' + 'x'.repeat(48),
      'sk_live_' + 'x'.repeat(24),
      'xoxb-' + '1'.repeat(12) + '-abc',
      'AKIA' + 'A'.repeat(16),
      'AIza' + 'a'.repeat(35),
      'npm_' + 'a'.repeat(36),
      'hvs.' + 'a'.repeat(24),
    ]) {
      assert.strictEqual(isSensitiveEnvValue(value), true, `should flag ${value.slice(0, 12)}...`);
    }
  });

  it('does not flag ordinary values', () => {
    for (const value of [
      'main', '/usr/local/bin:/usr/bin', 'https://github.com/hivecommons/promptargs',
      'postgres://db.internal/app', 'https://user@example.com/path', 'user@example.com',
      'skills', 'sk-short', 'eyJ-not-a-jwt', 'AKIA-nope', 'Hello, world', '42',
    ]) {
      assert.strictEqual(isSensitiveEnvValue(value), false, `should not flag ${value}`);
    }
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

describe('pr detector', () => {
  it('returns undefined when gh exits 0 with empty output', t => {
    // A branch with no PR: gh succeeds but prints nothing, so the detector
    // must map '' to undefined rather than returning an empty value.
    if (process.platform === 'win32') return t.skip('POSIX shim script');
    const shim = mkdtempSync(join(tmpdir(), 'pa-gh-shim-'));
    writeFileSync(join(shim, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${shim}${delimiter}${prevPath ?? ''}`;
    try {
      assert.strictEqual(autodetect('pr'), undefined);
    } finally {
      process.env.PATH = prevPath;
      rmSync(shim, { recursive: true, force: true });
    }
  });
});
