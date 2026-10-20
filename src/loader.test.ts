import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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

  it('warns on stderr when the prompts directory itself cannot be read', (t) => {
    const root = mkdtempSync(join(process.cwd(), '.pa-notdir-'));
    writeFileSync(join(root, '.prompts'), 'not a directory');
    const warn = t.mock.method(console, 'error', () => {});
    try {
      const all = loadTemplates(root);
      assert.ok(all.length > 0 && all.every(x => x.source === 'user'));
      assert.strictEqual(warn.mock.callCount(), 1);
      const msg = String(warn.mock.calls[0].arguments[0]);
      assert.ok(msg.startsWith(`promptargs: cannot read ${join(root, '.prompts')}: `));
      assert.match(msg, /ENOTDIR/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stays silent when the prompts directory does not exist', (t) => {
    const root = mkdtempSync(join(process.cwd(), '.pa-nodir-'));
    const warn = t.mock.method(console, 'error', () => {});
    try {
      loadTemplates(root);
      assert.strictEqual(warn.mock.callCount(), 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The symlink-escape check trusts realpath(dir) as its root. If that
  // resolution fails after readdir succeeded (the directory vanished or became
  // unreachable in between), the loader must drop the whole directory with a
  // "cannot resolve" diagnostic rather than fall through to the per-file check
  // with no root. No filesystem layout makes realpath fail where readdir did
  // not, so swap the builtin and re-sync the ESM binding loader.js imported.
  it('warns and drops the directory when its real path cannot be resolved', (t) => {
    const root = mkdtempSync(join(process.cwd(), '.pa-noreal-'));
    const dir = join(root, '.prompts');
    mkdirSync(dir);
    writeFileSync(join(dir, 'local.md'), 'Local {{x}}');
    const realRealpath = fs.realpathSync;
    const realpath = t.mock.method(fs, 'realpathSync', ((p: fs.PathLike, ...rest: unknown[]) => {
      if (p === dir) {
        const err = new Error(`ENOENT: no such file or directory, realpath '${dir}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return (realRealpath as (...a: unknown[]) => string)(p, ...rest);
    }) as typeof fs.realpathSync);
    syncBuiltinESMExports();
    const warn = t.mock.method(console, 'error', () => {});
    try {
      const all = loadTemplates(root);
      assert.ok(all.length > 0 && all.every(x => x.source === 'user'));
      assert.ok(!all.some(x => x.name === 'local'));
      assert.strictEqual(warn.mock.callCount(), 1);
      const msg = String(warn.mock.calls[0].arguments[0]);
      assert.ok(msg.startsWith(`promptargs: cannot resolve ${dir}: `));
      assert.match(msg, /ENOENT/);
    } finally {
      realpath.mock.restore();
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
    // The restored binding must see the directory again.
    const root2 = mkdtempSync(join(process.cwd(), '.pa-noreal2-'));
    mkdirSync(join(root2, '.prompts'));
    writeFileSync(join(root2, '.prompts', 'back.md'), 'Back');
    try {
      assert.ok(loadTemplates(root2).some(x => x.name === 'back' && x.source === 'project'));
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe('findTemplate', () => {
  it('finds a template by name', () => {
    assert.strictEqual(findTemplate('global', projectRoot)?.name, 'global');
  });

  it('returns undefined for unknown names', () => {
    assert.strictEqual(findTemplate('nope', projectRoot), undefined);
  });

  it('skips directories named like templates', () => {
    const root = mkdtempSync(join(process.cwd(), '.pa-dir-'));
    mkdirSync(join(root, '.prompts', 'foo.md'), { recursive: true });
    writeFileSync(join(root, '.prompts', 'ok.md'), 'ok');
    try {
      const names = loadTemplates(root).map(t => t.name);
      assert.ok(!names.includes('foo'));
      assert.ok(names.includes('ok'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('follows symlinks to files inside .prompts, skips symlinks to directories and dangling symlinks', () => {
    const root = mkdtempSync(join(process.cwd(), '.pa-link-'));
    const prompts = join(root, '.prompts');
    mkdirSync(prompts);
    mkdirSync(join(prompts, 'shared'));
    writeFileSync(join(prompts, 'shared', 'real.txt'), 'Linked {{x}}');
    symlinkSync(join('shared', 'real.txt'), join(prompts, 'linked.md'));
    symlinkSync(join(prompts, 'shared'), join(prompts, 'dir.md'));
    symlinkSync(join(root, 'missing.txt'), join(prompts, 'dangling.md'));
    writeFileSync(join(prompts, 'plain.md'), 'plain');
    try {
      const all = loadTemplates(root).filter(x => x.source === 'project');
      assert.deepStrictEqual(all.map(x => x.name).sort(), ['linked', 'plain']);
      const linked = all.find(x => x.name === 'linked');
      assert.strictEqual(linked?.content, 'Linked {{x}}');
      assert.strictEqual(linked?.path, join(prompts, 'linked.md'));
      assert.strictEqual(linked?.error, undefined);
      assert.strictEqual(findTemplate('dangling', root), undefined);
      assert.strictEqual(findTemplate('dir', root), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses symlinks whose real target escapes the .prompts dir', () => {
    const root = mkdtempSync(join(process.cwd(), '.pa-escape-'));
    const prompts = join(root, '.prompts');
    mkdirSync(prompts);
    mkdirSync(join(root, 'secrets'));
    const secret = join(root, 'secrets', 'id_rsa');
    writeFileSync(secret, 'PRIVATE KEY');
    symlinkSync(secret, join(prompts, 'absolute.md'));
    symlinkSync(join('..', 'secrets', 'id_rsa'), join(prompts, 'relative.md'));
    // A sibling directory whose name merely starts with ".prompts" must not pass the prefix check.
    mkdirSync(join(root, '.prompts-other'));
    writeFileSync(join(root, '.prompts-other', 'x.md'), 'other');
    symlinkSync(join(root, '.prompts-other', 'x.md'), join(prompts, 'sibling.md'));
    // A link to a link that lands inside .prompts is still fine.
    writeFileSync(join(prompts, 'inner.md'), 'inner');
    symlinkSync(join(prompts, 'inner.md'), join(prompts, 'hop.md'));
    try {
      const all = loadTemplates(root).filter(x => x.source === 'project');
      for (const name of ['absolute', 'relative', 'sibling']) {
        const t = all.find(x => x.name === name);
        assert.ok(t, `${name} is listed`);
        assert.strictEqual(t.content, '', `${name} content is never read`);
        assert.match(t.error ?? '', /outside .*\.prompts/);
        assert.throws(() => findTemplate(name, root), (e: Error) =>
          e.name === 'UsageError' && /outside/.test(e.message) && !e.message.includes('PRIVATE KEY'));
      }
      assert.strictEqual(findTemplate('hop', root)?.content, 'inner');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a project .prompts that is itself a symlink', (t) => {
    const root = mkdtempSync(join(process.cwd(), '.pa-dirlink-'));
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'journal.md'), 'private {{note}}');
    symlinkSync(join(root, 'elsewhere'), join(root, '.prompts'));
    const warn = t.mock.method(console, 'error', () => {});
    try {
      const all = loadTemplates(root);
      assert.strictEqual(all.filter(x => x.source === 'project').length, 0);
      // User templates are unaffected by a refused project dir.
      assert.ok(all.some(x => x.source === 'user' && x.name === 'global'));
      assert.strictEqual(findTemplate('journal', root), undefined);
      const errors = warn.mock.calls.map(c => String(c.arguments[0]));
      assert.ok(errors.some(e => /is a symlink/.test(e)), 'explains why the project dir was refused');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('explains a dangling project .prompts symlink instead of skipping it silently', (t) => {
    const root = mkdtempSync(join(process.cwd(), '.pa-dangling-'));
    symlinkSync(join(root, 'missing'), join(root, '.prompts'));
    const warn = t.mock.method(console, 'error', () => {});
    try {
      const all = loadTemplates(root);
      assert.strictEqual(all.filter(x => x.source === 'project').length, 0);
      const errors = warn.mock.calls.map(c => String(c.arguments[0]));
      assert.ok(errors.some(e => /is a symlink/.test(e)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let an unreadable file break its siblings', (t) => {
    if (process.getuid?.() === 0) return t.skip('root bypasses file permissions');
    const root = mkdtempSync(join(process.cwd(), '.pa-perm-'));
    mkdirSync(join(root, '.prompts'));
    const bad = join(root, '.prompts', 'private.md');
    writeFileSync(bad, 'x');
    writeFileSync(join(root, '.prompts', 'ok.md'), 'ok');
    chmodSync(bad, 0o000);
    try {
      const all = loadTemplates(root);
      assert.ok(all.find(x => x.name === 'ok' && !x.error));
      assert.match(all.find(x => x.name === 'private')?.error ?? '', /EACCES/);
      assert.ok(findTemplate('ok', root));
      assert.throws(() => findTemplate('private', root), (e: Error) =>
        e.name === 'UsageError' && e.message.includes(bad) && /EACCES/.test(e.message));
    } finally {
      chmodSync(bad, 0o644);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
