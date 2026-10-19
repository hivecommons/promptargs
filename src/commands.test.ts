import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate HOME before importing commands.js, which imports loader.js.
// loader.ts evaluates homedir() at import time, so we must set HOME first.
const fakeHome = mkdtempSync(join(process.cwd(), '.pa-home-'));
process.env.HOME = fakeHome;
mkdirSync(join(fakeHome, '.prompts'));

const { doShow, doList } = await import('./commands.js');
const { UsageError } = await import('./flags.js');

function captureShowNamed(name: string, content: string): { out: string; err: string } {
  const dir = mkdtempSync(join(tmpdir(), 'promptargs-show-'));
  mkdirSync(join(dir, '.prompts'));
  writeFileSync(join(dir, '.prompts', `${name}.md`), content);
  const prevCwd = process.cwd();
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  process.chdir(dir);
  console.log = (...args: unknown[]) => { out.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { err.push(args.map(String).join(' ')); };
  try {
    doShow(name);
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
  return { out: out.join('\n'), err: err.join('\n') };
}

function captureShow(templateContent: string): string {
  return captureShowNamed('demo', templateContent).out;
}

function captureList(templateContent: string, templateName: string = 'demo.md'): string {
  const dir = mkdtempSync(join(tmpdir(), 'promptargs-list-'));
  mkdirSync(join(dir, '.prompts'));
  writeFileSync(join(dir, '.prompts', templateName), templateContent);
  const prevCwd = process.cwd();
  const origLog = console.log;
  const lines: string[] = [];
  process.chdir(dir);
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    doList();
  } finally {
    console.log = origLog;
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
  return lines.join('\n');
}

after(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('doShow', () => {
  it('throws UsageError when no template name is given', () => {
    assert.throws(() => doShow(undefined), {
      name: 'UsageError',
      message: 'Usage: promptargs show <template>',
    });
  });

  it('throws UsageError for an unknown template', () => {
    assert.throws(() => doShow('no-such-template-198'), (e: unknown) => {
      assert.ok(e instanceof UsageError);
      assert.strictEqual(e.message, 'Template "no-such-template-198" not found.');
      return true;
    });
  });

  it('colours every occurrence of a blank as having a default when any occurrence declares one', () => {
    const out = captureShow('Hi {{name}}, again {{name=World}}; {{other}}');
    assert.ok(out.includes('\x1b[33m{{name}}\x1b[0m'), 'first occurrence should be yellow');
    assert.ok(out.includes('\x1b[33m{{name=World}}\x1b[0m'), 'declaring occurrence should be yellow');
    assert.ok(out.includes('\x1b[31m{{other}}\x1b[0m'), 'blank without default stays red');
  });
});

describe('doList', () => {
  it('prints vars: (none) for a template with no variables', () => {
    const out = captureList('Just a static prompt.\n');
    assert.ok(out.includes('vars: (none)'), 'should print vars: (none)');
    assert.ok(!out.includes('vars: {{}}'), 'should not print vars: {{}}');
  });

  it('prints vars: {{name}}  {{focus=x}} for templates with variables', () => {
    const out = captureList('Review {{file}} for {{focus=correctness}} issues.\n');
    assert.ok(out.includes('vars:'), 'should have vars line');
    assert.ok(out.includes('{{file}}'), 'should include {{file}}');
    assert.ok(out.includes('{{focus=correctness}}'), 'should include {{focus=correctness}}');
  });

  it('marks a template named after a subcommand as unreachable instead of listing its vars', () => {
    const out = captureList('List {{dir}}.\n', 'list.md');
    assert.ok(out.includes('(unreachable: name collides with the "list" subcommand; rename the file)'));
    assert.ok(!out.includes('vars:'), 'should not print a vars line');
  });

  it('does not mark a normally named template as unreachable', () => {
    const out = captureList('Hello {{who}}.\n', 'greet.md');
    assert.ok(!out.includes('unreachable'));
    assert.ok(out.includes('vars: {{who}}'));
  });
});

describe('doShow subcommand collisions', () => {
  it('warns on stderr before previewing a template named after a subcommand', () => {
    const { out, err } = captureShowNamed('list', 'List {{dir}}.\n');
    assert.ok(err.includes('(unreachable: name collides with the "list" subcommand; rename the file)'));
    assert.ok(out.includes('List'));
  });

  it('prints no warning for a normally named template', () => {
    const { err } = captureShowNamed('greet', 'Hello.\n');
    assert.strictEqual(err, '');
  });
});
