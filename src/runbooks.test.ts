import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonLogEnabled } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI = join(__dirname, 'cli.js');
const RUNBOOKS = join(ROOT, 'runbooks');
const INCIDENT = join(RUNBOOKS, 'incident-response.md');
const ROLLBACK = join(RUNBOOKS, 'release-rollback.md');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

// runbooks/ is what a maintainer follows at 02:00 with a broken release in
// the wild, and CONTRIBUTING.md points there. Nothing compiles or runs the
// runbooks, so every fact they restate about the code — the diagnostics
// env var, its field set and error classes, the workflow a rollback
// dispatches and the inputs it takes — can drift silently. Pin each one to
// its source of truth so the runbook fails CI the moment it starts lying.

const incident = readFileSync(INCIDENT, 'utf-8');
const rollback = readFileSync(ROLLBACK, 'utf-8');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
const logSource = readFileSync(join(ROOT, 'src', 'log.ts'), 'utf-8');

// The ErrorClass union and diag's field whitelist are TypeScript-only facts
// (erased at runtime), so read them from the source the way a reader would.
function errorClassesFromSource(): Set<string> {
  const m = /export type ErrorClass = ([^;]+);/.exec(logSource);
  assert.ok(m, 'src/log.ts lost its ErrorClass union');
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

function diagFieldsFromSource(): Set<string> {
  const m = /for \(const key of \[([^\]]+)\] as const\)/.exec(logSource);
  assert.ok(m, 'src/log.ts lost the diag() field whitelist loop');
  return new Set(['event', ...[...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])]);
}

// Backticked identifiers inside the parenthesised list that follows a
// backticked `error_class` mention, e.g. "`error_class` (`usage`, `io`)".
function documentedErrorClasses(markdown: string, where: string): Set<string> {
  const m = /`error_class`\s*\((`[a-z_]+`(?:,\s*`[a-z_]+`)*)\)/.exec(markdown);
  assert.ok(m, `${where} no longer enumerates the error_class values`);
  return new Set([...m[1].matchAll(/`([a-z_]+)`/g)].map((x) => x[1]));
}

function bashFences(markdown: string): string[] {
  const fences: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) fences.push(m[1]);
  return fences;
}

function workflowDispatchInputs(file: string): Map<string, boolean> {
  const yml = readFileSync(join(WORKFLOWS, file), 'utf-8');
  const block = /workflow_dispatch:\n\s+inputs:\n([\s\S]*?)\n\S/.exec(yml);
  assert.ok(block, `${file} has no workflow_dispatch inputs`);
  const inputs = new Map<string, boolean>();
  let current: string | undefined;
  for (const line of block[1].split('\n')) {
    const name = /^ {6}([A-Za-z_-]+):\s*$/.exec(line);
    if (name) { current = name[1]; inputs.set(current, false); continue; }
    if (current && /^\s+required:\s*true\s*$/.test(line)) inputs.set(current, true);
  }
  return inputs;
}

test('CONTRIBUTING.md links both runbooks and they exist', () => {
  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf-8');
  for (const file of ['release-rollback.md', 'incident-response.md']) {
    assert.ok(contributing.includes(`runbooks/${file}`), `CONTRIBUTING.md no longer points at runbooks/${file}`);
    assert.ok(existsSync(join(RUNBOOKS, file)), `runbooks/${file} is missing`);
  }
});

test('incident runbook names the diagnostics switch exactly as log.ts reads it', () => {
  const m = /`([A-Z_]+)=([a-z]+)`/.exec(incident);
  assert.ok(m && m[1] === 'PROMPTARGS_LOG', 'incident runbook does not tell the reporter to set PROMPTARGS_LOG');
  assert.strictEqual(jsonLogEnabled({ [m[1]]: m[2] }), true, `log.ts does not enable JSON output for ${m[0]}`);
  assert.ok(incident.includes('`release-rollback.md`'), 'incident runbook lost its hand-off to release-rollback.md');
});

test('incident runbook and README list exactly the ErrorClass values from log.ts', () => {
  const source = errorClassesFromSource();
  assert.deepStrictEqual(documentedErrorClasses(incident, 'incident runbook'), source);
  assert.deepStrictEqual(documentedErrorClasses(readme, 'README'), source);
});

test('incident runbook names only fields diag() can emit, and README lists the full field set', () => {
  const source = diagFieldsFromSource();
  const sentence = /It carries ([^.]+)\./.exec(incident);
  assert.ok(sentence, 'incident runbook lost the sentence describing the JSON fields');
  const classes = errorClassesFromSource();
  const fields = [...sentence[1].matchAll(/`([a-z_]+)`/g)].map((x) => x[1]).filter((f) => !classes.has(f));
  assert.ok(fields.length >= 2, 'incident runbook names fewer than two JSON fields');
  for (const f of fields) assert.ok(source.has(f), `incident runbook names a field diag() never emits: ${f}`);

  const readmeFields = /fixed field set: ([^.]+)\./.exec(readme);
  assert.ok(readmeFields, 'README lost its "fixed field set" sentence');
  const listed = new Set([...readmeFields[1].matchAll(/`([a-z_]+)`/g)].map((x) => x[1]).filter((f) => !classes.has(f)));
  assert.deepStrictEqual(listed, source);
});

test('a CLI failure under PROMPTARGS_LOG=json is safe to paste: documented fields only, no names or paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'promptargs-runbook-'));
  try {
    const templateName = 'runbook-secret-template-7f3a';
    const res = spawnSync(process.execPath, [CLI, 'show', templateName], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, PROMPTARGS_LOG: 'json', HOME: dir, USERPROFILE: dir },
      timeout: 30_000,
    });
    assert.strictEqual(res.status, 1, `expected a failing exit:\n${res.stderr}`);
    const lines = res.stderr.trim().split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'no diagnostics on stderr');
    const allowed = diagFieldsFromSource();
    const classes = errorClassesFromSource();
    let sawError = false;
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      assert.strictEqual(typeof obj.event, 'string', `line has no event: ${line}`);
      for (const key of Object.keys(obj)) assert.ok(allowed.has(key), `undocumented field ${key} in ${line}`);
      if (obj.event === 'cli_error') {
        sawError = true;
        assert.ok(classes.has(String(obj.error_class)), `undocumented error_class in ${line}`);
      }
    }
    assert.ok(sawError, `no cli_error line among:\n${res.stderr}`);
    assert.ok(!res.stderr.includes(templateName), 'diagnostics leaked the template name');
    assert.ok(!res.stderr.includes(dir), 'diagnostics leaked a path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the --help probe both runbooks tell responders to run exits 0', () => {
  for (const [name, text] of [['incident', incident], ['rollback', rollback]]) {
    assert.ok(text.includes('--help'), `${name} runbook no longer suggests a --help probe`);
  }
  const res = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf-8', timeout: 30_000 });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('every workflow file the runbooks name exists', () => {
  const named = new Set([...(incident + rollback).matchAll(/`?([a-z-]+\.yml)`?/g)].map((x) => x[1]));
  assert.ok(named.has('release.yml') && named.has('auto-release.yml'), 'rollback runbook lost its workflow references');
  for (const file of named) assert.ok(existsSync(join(WORKFLOWS, file)), `runbook names a workflow that does not exist: ${file}`);
});

test('rollback runbook dispatches release.yml with exactly its declared, required inputs', () => {
  const inputs = workflowDispatchInputs('release.yml');
  const dispatches = bashFences(rollback).flatMap((f) => f.split('\n')).filter((l) => /gh workflow run release\.yml/.test(l));
  assert.ok(dispatches.length > 0, 'rollback runbook has no `gh workflow run release.yml` command');
  for (const cmd of dispatches) {
    assert.match(cmd, /--ref main\b/, `${cmd}: must dispatch from main so the current workflow runs`);
    const given = new Set([...cmd.matchAll(/-f\s+([A-Za-z_-]+)=/g)].map((x) => x[1]));
    for (const name of given) assert.ok(inputs.has(name), `${cmd}: release.yml declares no input "${name}"`);
    for (const [name, required] of inputs) {
      if (required) assert.ok(given.has(name), `${cmd}: omits required input "${name}"`);
    }
  }
});
