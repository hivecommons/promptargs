import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
