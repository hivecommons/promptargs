import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// loader.ts resolves the user template dir from homedir() at import time,
// so point HOME at a scratch dir before importing it (each test file runs
// in its own process under node --test).
const fakeHome = mkdtempSync(join(process.cwd(), '.pa-home-'));
process.env.HOME = fakeHome;

const { loadTemplates, findTemplate } = await import('./loader.js');

let projectRoot: string;

before(() => {
  projectRoot = mkdtempSync(join(process.cwd(), '.pa-proj-'));
  mkdirSync(join(projectRoot, '.prompts'));
  writeFileSync(join(projectRoot, '.prompts', 'review.md'), 'Review {{file}}');
  writeFileSync(join(projectRoot, '.prompts', 'notes.txt'), 'not a template');

  mkdirSync(join(fakeHome, '.prompts'));
  writeFileSync(join(fakeHome, '.prompts', 'review.md'), 'User review {{file}}');
  writeFileSync(join(fakeHome, '.prompts', 'global.md'), 'Global {{x}}');
});

after(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('loadTemplates', () => {
  it('loads only .md files from the project .prompts dir', () => {
    const names = loadTemplates(projectRoot).map(t => t.name);
    assert.ok(names.includes('review'));
    assert.ok(!names.includes('notes'));
  });

  it('project templates override user templates with the same name', () => {
    const review = loadTemplates(projectRoot).find(t => t.name === 'review');
    assert.strictEqual(review?.source, 'project');
    assert.strictEqual(review?.content, 'Review {{file}}');
  });

  it('includes user templates not shadowed by the project', () => {
    const global = loadTemplates(projectRoot).find(t => t.name === 'global');
    assert.strictEqual(global?.source, 'user');
    assert.strictEqual(global?.content, 'Global {{x}}');
  });

  it('returns user templates when the project has no .prompts dir', () => {
    const empty = mkdtempSync(join(process.cwd(), '.pa-empty-'));
    try {
      const templates = loadTemplates(empty);
      assert.ok(templates.every(t => t.source === 'user'));
      assert.ok(templates.some(t => t.name === 'review'));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('records the template path', () => {
    const review = findTemplate('review', projectRoot);
    assert.strictEqual(review?.path, join(projectRoot, '.prompts', 'review.md'));
  });
});

describe('findTemplate', () => {
  it('finds a template by name', () => {
    assert.strictEqual(findTemplate('global', projectRoot)?.name, 'global');
  });

  it('returns undefined for unknown names', () => {
    assert.strictEqual(findTemplate('nope', projectRoot), undefined);
  });
});
