import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Exercise the inline `run:` scripts of the release pipeline the same way
// release-verification.test.mjs does for the npm check: lift the script text
// out of the workflow YAML, substitute the `${{ }}` expressions the runner
// would, and run it under bash against mocked `gh` and `git` binaries. These
// steps only ever execute on a push to main or against a published release,
// so a typo here is otherwise found by a broken release.

const root = new URL('../', import.meta.url);
const REPO = 'hivecommons/promptargs';
const SHA = '0123456789abcdef0123456789abcdef01234567';

function readWorkflow(file) {
  return readFileSync(new URL(`.github/workflows/${file}`, root), 'utf8');
}

// Returns the dedented `run: |` block of the named step, with every
// `${{ expr }}` in `substitutions` replaced. Any expression left over is a
// test bug (the script would be run with a literal `${{`), so it fails loudly.
function stepScript(file, stepName, substitutions = {}) {
  const workflow = readWorkflow(file);
  const marker = `      - name: ${stepName}\n`;
  assert.ok(workflow.includes(marker), `${file} has no step named "${stepName}"`);
  const step = workflow.split(marker)[1].split('\n      - ')[0];
  const runMarker = '        run: |\n';
  assert.ok(step.includes(runMarker), `step "${stepName}" has no block-style run:`);
  let script = step.split(runMarker)[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  for (const [expr, value] of Object.entries(substitutions)) {
    script = script.replaceAll(`\${{ ${expr} }}`, value);
  }
  assert.doesNotMatch(script, /\$\{\{/, `unexpanded workflow expression in "${stepName}":\n${script}`);
  return script;
}

// GitHub runs an unspecified-shell `run:` block as `bash -e {0}`; mirror that
// so a failing command aborts the step exactly as it would on the runner.
function runStep(script, { cwd, env = {} }) {
  return spawnSync('bash', ['-e', '-c', script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function withSandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'promptargs-release-wf-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'runner-temp'));
    writeFileSync(join(dir, 'calls'), '');
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A `gh` that records its argv one call per line and exits with MOCK_GH_STATUS.
// For `release create` it also keeps a copy of the --notes-file contents, since
// the real step writes those into $RUNNER_TEMP which the test owns anyway.
function installGhMock(dir, status = 0) {
  writeFileSync(join(dir, 'bin', 'gh'), `#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_DIR/calls"
exit ${status}
`, { mode: 0o755 });
}

function calls(dir) {
  const text = readFileSync(join(dir, 'calls'), 'utf8').trim();
  return text ? text.split('\n') : [];
}

function sandboxEnv(dir, extra = {}) {
  return {
    PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    MOCK_DIR: dir,
    GITHUB_OUTPUT: join(dir, 'output'),
    RUNNER_TEMP: join(dir, 'runner-temp'),
    GH_TOKEN: 'test-token',
    ...extra,
  };
}

// --- auto-release.yml --------------------------------------------------------

const detectScript = stepScript('auto-release.yml', 'Determine whether current version needs a release', {
  'github.repository': REPO,
});

for (const [scenario, ghStatus, exists] of [
  ['release already exists', 0, 'true'],
  ['release is missing', 1, 'false'],
]) {
  test(`auto-release: version detection when the ${scenario}`, () => {
    withSandbox((dir) => {
      installGhMock(dir, ghStatus);
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      const result = runStep(detectScript, { cwd: dir, env: sandboxEnv(dir) });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(dir, 'output'), 'utf8'), `tag=v1.2.3\nexists=${exists}\n`);
      assert.deepEqual(calls(dir), [`release view v1.2.3 --repo ${REPO}`]);
    });
  });
}

test('auto-release: version detection fails instead of releasing when package.json is unreadable', () => {
  withSandbox((dir) => {
    installGhMock(dir, 1);
    const result = runStep(detectScript, { cwd: dir, env: sandboxEnv(dir) });
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls(dir), []);
    assert.ok(!existsSync(join(dir, 'output')), 'no step output should be written');
  });
});

const createScript = stepScript('auto-release.yml', 'Create GitHub release', {
  'github.repository': REPO,
  'github.sha': SHA,
  'steps.version.outputs.tag': 'v1.2.3',
});

// The step runs `node scripts/release-notes.mjs changelog.d` relative to the
// checkout, so the sandbox gets the real renderer and its own fragments dir.
function installReleaseNotes(dir, fragments) {
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(new URL('release-notes.mjs', import.meta.url), join(dir, 'scripts', 'release-notes.mjs'));
  if (fragments) {
    mkdirSync(join(dir, 'changelog.d'));
    for (const [name, text] of Object.entries(fragments)) {
      writeFileSync(join(dir, 'changelog.d', name), text);
    }
  }
}

function releaseCreateCall(dir) {
  const [call, ...rest] = calls(dir);
  assert.deepEqual(rest, [], 'expected exactly one gh call');
  const match = /^release create v1\.2\.3 --repo (\S+) --title (\S+) --target (\S+) --notes-file (\S+)$/.exec(call);
  assert.ok(match, `unexpected gh invocation: ${call}`);
  const [, repo, title, target, notesFile] = match;
  assert.equal(repo, REPO);
  assert.equal(title, 'v1.2.3');
  assert.equal(target, SHA);
  return readFileSync(notesFile, 'utf8');
}

test('auto-release: release notes are rendered from changelog.d fragments', () => {
  withSandbox((dir) => {
    installGhMock(dir);
    installReleaseNotes(dir, {
      'README.md': 'not a fragment',
      'fixed-7.md': 'Stop doing the wrong thing (#7)',
      'added-feature.md': '- Do a new thing (#8)\n',
    });
    const result = runStep(createScript, { cwd: dir, env: sandboxEnv(dir) });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /minimal release note/);
    assert.equal(
      releaseCreateCall(dir),
      '### Added\n\n- Do a new thing (#8)\n\n### Fixed\n\n- Stop doing the wrong thing (#7)\n',
    );
  });
});

test('auto-release: an empty changelog.d falls back to a minimal release note', () => {
  withSandbox((dir) => {
    installGhMock(dir);
    installReleaseNotes(dir, { 'README.md': 'how fragments work' });
    const result = runStep(createScript, { cwd: dir, env: sandboxEnv(dir) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No changelog\.d fragments; using a minimal release note\./);
    assert.equal(releaseCreateCall(dir), 'Release v1.2.3\n');
  });
});

test('auto-release: a failing release-notes renderer aborts before any release is created', () => {
  withSandbox((dir) => {
    installGhMock(dir);
    // The step stages fragments into $RUNNER_TEMP, so a missing changelog.d no
    // longer reaches the renderer; break the renderer itself instead.
    installReleaseNotes(dir, { 'fixed-x.md': 'x' });
    writeFileSync(join(dir, 'scripts', 'release-notes.mjs'), "throw new Error('renderer exploded');\n");
    const result = runStep(createScript, { cwd: dir, env: sandboxEnv(dir) });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /minimal release note/);
    assert.deepEqual(calls(dir), []);
  });
});

test('auto-release: npm publication is dispatched to release.yml on main with the new tag', () => {
  const script = stepScript('auto-release.yml', 'Start npm publication', { 'github.repository': REPO });
  withSandbox((dir) => {
    installGhMock(dir);
    const result = runStep(script, { cwd: dir, env: sandboxEnv(dir, { RELEASE_TAG: 'v1.2.3' }) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(dir), [`workflow run release.yml --repo ${REPO} --ref main -f tag=v1.2.3`]);
  });
});

test('auto-release: release creation and publication are both gated on the tag being new', () => {
  const workflow = readWorkflow('auto-release.yml');
  for (const step of ['Create GitHub release', 'Start npm publication']) {
    const block = workflow.split(`      - name: ${step}\n`)[1].split('\n      - ')[0];
    assert.match(block, /^        if: steps\.version\.outputs\.exists == 'false'$/m, `${step} is not gated`);
  }
});

// --- release.yml -------------------------------------------------------------

const tagCheckScript = stepScript('release.yml', 'Check tag matches package.json version');

for (const [scenario, tag, status] of [
  ['matches', 'v1.2.3', 0],
  ['differs', 'v1.2.4', 1],
  ['is missing its v prefix but matches', '1.2.3', 0],
]) {
  test(`release: tag check when the tag ${scenario}`, () => {
    withSandbox((dir) => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      const result = runStep(tagCheckScript, { cwd: dir, env: sandboxEnv(dir, { RELEASE_TAG: tag }) });
      assert.equal(result.status, status, result.stderr);
      if (status) {
        assert.match(result.stdout, /::error::tag v1\.2\.4 does not match package\.json version 1\.2\.3/);
      } else {
        assert.doesNotMatch(result.stdout, /::error::/);
      }
    });
  });
}

// --- dist/ sync guard (shared by ci.yml and release.yml) ---------------------

const DIST_SYNC_STEP = 'Check committed dist/ is in sync with src/';

test('dist sync guard: ci.yml and release.yml run the identical script', () => {
  assert.equal(stepScript('ci.yml', DIST_SYNC_STEP), stepScript('release.yml', DIST_SYNC_STEP));
});

function gitRepoWithDist(dir) {
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export const built = 1;\n');
  writeFileSync(join(dir, 'src.ts'), 'export const built = 1;\n');
  git('init', '-q');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
}

test('dist sync guard: passes when dist/ matches the commit', () => {
  const script = stepScript('ci.yml', DIST_SYNC_STEP);
  withSandbox((dir) => {
    gitRepoWithDist(dir);
    const result = runStep(script, { cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /::error::/);
  });
});

test('dist sync guard: fails and names the stale file when dist/ drifts', () => {
  const script = stepScript('ci.yml', DIST_SYNC_STEP);
  withSandbox((dir) => {
    gitRepoWithDist(dir);
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const built = 2;\n');
    const result = runStep(script, { cwd: dir });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, / M dist\/index\.js/);
    assert.match(result.stdout, /::error::dist\/ is stale/);
  });
});

test('dist sync guard: ignores changes outside dist/', () => {
  const script = stepScript('ci.yml', DIST_SYNC_STEP);
  withSandbox((dir) => {
    gitRepoWithDist(dir);
    writeFileSync(join(dir, 'src.ts'), 'export const built = 2;\n');
    const result = runStep(script, { cwd: dir });
    assert.equal(result.status, 0, result.stderr);
  });
});

// --- release.yml: npm Trusted Publishing (OIDC) ------------------------------

// A `npm` that reports the given version for `--version` and records every
// other invocation, so the test can prove the gate never installs anything.
function installNpmMock(dir, version) {
  writeFileSync(join(dir, 'bin', 'npm'), `#!/bin/bash
if [ "$1" = "--version" ]; then
  echo "${version}"
  exit 0
fi
printf '%s\\n' "$*" >> "$MOCK_DIR/calls"
`, { mode: 0o755 });
}

const npmGateScript = stepScript('release.yml', 'Ensure npm supports Trusted Publishing');

for (const [version, tooOld] of [
  ['11.5.1', false],
  ['11.6.0', false],
  // Lexically "11.10.2" < "11.5.1"; the gate must compare as versions.
  ['11.10.2', false],
  ['12.0.0', false],
  ['11.4.9', true],
  ['10.9.4', true],
]) {
  test(`release: npm ${version} ${tooOld ? 'fails the' : 'passes the'} Trusted Publishing gate`, () => {
    withSandbox((dir) => {
      installNpmMock(dir, version);
      const result = runStep(npmGateScript, { cwd: dir, env: sandboxEnv(dir) });
      // The gate must never self-upgrade npm inside the id-token:write job.
      assert.deepEqual(calls(dir), []);
      if (tooOld) {
        assert.notEqual(result.status, 0, 'gate must fail for an npm that cannot do Trusted Publishing');
        assert.match(result.stdout, new RegExp(`::error::npm ${version.replaceAll('.', '\\.')} is too old for Trusted Publishing`));
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /too old/);
      }
    });
  });
}

test('release: publish job is scoped to the npm-publish environment', () => {
  const publish = readWorkflow('release.yml').split('\n  publish:\n')[1];
  assert.ok(publish, 'release.yml has no publish job');
  assert.match(publish, /^    environment: npm-publish$/m);
  assert.match(publish, /^      id-token: write/m);
  assert.doesNotMatch(publish, /npm install -g npm/);
});

const oidcGuardScript = stepScript('release.yml', 'Require OIDC token for npm Trusted Publishing');

test('release: OIDC guard passes when the runner exposes an id-token request URL', () => {
  withSandbox((dir) => {
    const result = runStep(oidcGuardScript, {
      cwd: dir,
      env: sandboxEnv(dir, { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token' }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /::error::/);
  });
});

test('release: OIDC guard fails before publishing when the job has no id-token permission', () => {
  withSandbox((dir) => {
    const result = runStep(oidcGuardScript, { cwd: dir, env: sandboxEnv(dir, { ACTIONS_ID_TOKEN_REQUEST_URL: '' }) });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::ACTIONS_ID_TOKEN_REQUEST_URL is not set; the job needs 'id-token: write'/);
    assert.match(result.stdout, /runbooks\/release-rollback\.md/);
  });
});

test('release: publish job is wired for Trusted Publishing, not an npm token', () => {
  const workflow = readWorkflow('release.yml');
  const job = workflow.split('\n  publish:\n')[1];
  assert.ok(job, 'release.yml has no publish job');
  assert.match(job, /^    permissions:\n(?:      .*\n)*?      id-token: write/m, 'publish job does not grant id-token: write');
  // The header comment may mention NPM_TOKEN to say it is gone; only an actual
  // secret reference or NODE_AUTH_TOKEN env entry is a regression.
  assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN|NODE_AUTH_TOKEN\s*:/, 'release.yml still wires an npm token secret');

  const publishStep = '      - name: Publish to npm (Trusted Publishing)\n';
  assert.ok(workflow.includes(publishStep), 'release.yml has no Trusted Publishing publish step');
  const publishBlock = workflow.split(publishStep)[1].split('\n      - ')[0];
  assert.match(publishBlock, /^        run: npm publish --provenance --access public$/m);

  const guardAt = workflow.indexOf('      - name: Require OIDC token for npm Trusted Publishing\n');
  const gateAt = workflow.indexOf('      - name: Ensure npm supports Trusted Publishing\n');
  const publishAt = workflow.indexOf(publishStep);
  assert.ok(gateAt !== -1 && gateAt < publishAt, 'npm version gate must run before publishing');
  assert.ok(guardAt !== -1 && guardAt < publishAt, 'OIDC guard must run before publishing');
});
