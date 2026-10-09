import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderReleaseNotes } from './release-notes.mjs';

test('groups fragments by category and normalises bullets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  writeFileSync(join(dir, 'fixed-b.md'), '- Fixed b (#2)\n');
  writeFileSync(join(dir, 'added-a.md'), 'Added a (#1)\n');
  writeFileSync(join(dir, 'README.md'), 'ignored\n');
  assert.equal(
    renderReleaseNotes(dir),
    '### Added\n\n- Added a (#1)\n\n### Fixed\n\n- Fixed b (#2)\n',
  );
});

test('returns an empty string when there are no fragments', () => {
  assert.equal(renderReleaseNotes(mkdtempSync(join(tmpdir(), 'notes-'))), '');
});

// auto-release.yml never imports renderReleaseNotes: it runs
// `node scripts/release-notes.mjs changelog.d` and tests the output file
// with `[ -s ... ]`. These tests cover that process boundary.
const SCRIPT = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function runScript(args, cwd) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('CLI renders the directory named on the command line to stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  writeFileSync(join(dir, 'changed-c.md'), 'Changed c (#3)\n');
  assert.equal(runScript([dir]), renderReleaseNotes(dir));
  assert.equal(runScript([dir]), '### Changed\n\n- Changed c (#3)\n');
});

test('CLI defaults to ./changelog.d relative to the working directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'notes-'));
  mkdirSync(join(cwd, 'changelog.d'));
  writeFileSync(join(cwd, 'changelog.d', 'added-d.md'), '* Added d (#4)\n');
  assert.equal(runScript([], cwd), '### Added\n\n- Added d (#4)\n');
});

test('CLI writes nothing for an empty directory so auto-release can fall back', () => {
  assert.equal(runScript([mkdtempSync(join(tmpdir(), 'notes-'))]), '');
});

// Contract for the committed fragments, matching CONTRIBUTING.md: a fragment
// the renderer silently skips (unknown category, wrong extension, empty body)
// would vanish from the release notes without any CI signal.
test('every committed changelog.d fragment is rendered', () => {
  const dir = join(REPO_ROOT, 'changelog.d');
  const names = readdirSync(dir).filter((name) => name !== 'README.md');
  assert.ok(names.length > 0, 'expected at least one fragment');
  const rendered = renderReleaseNotes(dir);
  for (const name of names) {
    assert.match(name, /^(added|changed|fixed)-[a-z0-9][a-z0-9-]*\.md$/, name);
    const lines = readFileSync(join(dir, name), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, `${name} must hold a single line`);
    const text = lines[0].replace(/^[-*]\s+/, '');
    assert.ok(text.length > 0, `${name} is empty`);
    assert.ok(rendered.includes(`- ${text}\n`), `${name} missing from rendered notes`);
  }
});
