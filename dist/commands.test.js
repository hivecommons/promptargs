import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, lstatSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Isolate HOME before importing commands.js, which imports loader.js.
// loader.ts evaluates homedir() at import time, so we must set HOME first.
const fakeHome = mkdtempSync(join(process.cwd(), '.pa-home-'));
process.env.HOME = fakeHome;
mkdirSync(join(fakeHome, '.prompts'));
const { doShow, doList, doInit } = await import('./commands.js');
const { UsageError } = await import('./flags.js');
function captureShowNamed(name, content) {
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-show-'));
    mkdirSync(join(dir, '.prompts'));
    writeFileSync(join(dir, '.prompts', `${name}.md`), content);
    const prevCwd = process.cwd();
    const origLog = console.log;
    const origErr = console.error;
    const out = [];
    const err = [];
    process.chdir(dir);
    console.log = (...args) => { out.push(args.map(String).join(' ')); };
    console.error = (...args) => { err.push(args.map(String).join(' ')); };
    try {
        doShow(name);
    }
    finally {
        console.log = origLog;
        console.error = origErr;
        process.chdir(prevCwd);
        rmSync(dir, { recursive: true, force: true });
    }
    return { out: out.join('\n'), err: err.join('\n') };
}
function captureShow(templateContent) {
    return captureShowNamed('demo', templateContent).out;
}
function captureList(templateContent, templateName = 'demo.md') {
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-list-'));
    mkdirSync(join(dir, '.prompts'));
    writeFileSync(join(dir, '.prompts', templateName), templateContent);
    const prevCwd = process.cwd();
    const origLog = console.log;
    const lines = [];
    process.chdir(dir);
    console.log = (...args) => {
        lines.push(args.map(String).join(' '));
    };
    try {
        doList();
    }
    finally {
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
        assert.throws(() => doShow('no-such-template-198'), (e) => {
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
describe('doInit with a symlinked project .prompts', () => {
    for (const [label, dangling] of [['a symlink to a directory', false], ['a dangling symlink', true]]) {
        it(`refuses ${label} without writing through it`, (t) => {
            const root = mkdtempSync(join(process.cwd(), '.pa-initlink-'));
            const target = join(root, 'elsewhere');
            if (!dangling)
                mkdirSync(target);
            mkdirSync(join(root, 'proj'));
            symlinkSync(target, join(root, 'proj', '.prompts'));
            const errs = t.mock.method(console, 'error', () => { });
            const logs = t.mock.method(console, 'log', () => { });
            const prevCwd = process.cwd();
            const prevExit = process.exitCode;
            process.chdir(join(root, 'proj'));
            try {
                doInit();
                assert.strictEqual(process.exitCode, 1);
                assert.ok(errs.mock.calls.some(c => /is a symlink/.test(String(c.arguments[0]))));
                assert.ok(!logs.mock.calls.some(c => /already exists/.test(String(c.arguments[0]))));
                assert.ok(lstatSync(join(root, 'proj', '.prompts')).isSymbolicLink());
                assert.strictEqual(existsSync(join(target, 'review.md')), false);
            }
            finally {
                process.exitCode = prevExit;
                process.chdir(prevCwd);
                rmSync(root, { recursive: true, force: true });
            }
        });
    }
});
// doInit swallows only ENOENT from the pre-flight lstat (no entry yet is the
// normal case). Any other failure must surface instead of being masked by
// existsSync, which would then either report "already exists" or create the
// directory behind a permission or I/O error. No filesystem layout makes
// lstat of <cwd>/.prompts fail with anything but ENOENT for a non-root user
// in a writable scratch dir, so swap the builtin and re-sync the ESM binding
// commands.js imported.
describe('doInit when the .prompts pre-flight lstat fails', () => {
    it('rethrows a non-ENOENT error and leaves the project untouched', (t) => {
        const root = mkdtempSync(join(process.cwd(), '.pa-initlstat-'));
        const dir = join(root, '.prompts');
        const realLstat = fs.lstatSync;
        const lstat = t.mock.method(fs, 'lstatSync', ((p, ...rest) => {
            if (p === dir) {
                const err = new Error(`EIO: i/o error, lstat '${dir}'`);
                err.code = 'EIO';
                throw err;
            }
            return realLstat(p, ...rest);
        }));
        syncBuiltinESMExports();
        const errs = t.mock.method(console, 'error', () => { });
        const logs = t.mock.method(console, 'log', () => { });
        const prevCwd = process.cwd();
        const prevExit = process.exitCode;
        process.chdir(root);
        try {
            assert.throws(() => doInit(), (e) => e.code === 'EIO' && e.message.includes(dir));
            assert.strictEqual(process.exitCode, prevExit);
            assert.strictEqual(errs.mock.callCount(), 0);
            assert.strictEqual(logs.mock.callCount(), 0);
            assert.strictEqual(existsSync(dir), false);
        }
        finally {
            process.exitCode = prevExit;
            process.chdir(prevCwd);
            lstat.mock.restore();
            syncBuiltinESMExports();
            rmSync(root, { recursive: true, force: true });
        }
        // The restored binding must take the ENOENT path and scaffold again.
        const root2 = mkdtempSync(join(process.cwd(), '.pa-initlstat2-'));
        const logs2 = t.mock.method(console, 'log', () => { });
        process.chdir(root2);
        try {
            doInit();
            assert.ok(existsSync(join(root2, '.prompts', 'review.md')));
            assert.ok(logs2.mock.calls.some(c => /Created/.test(String(c.arguments[0]))));
        }
        finally {
            process.chdir(prevCwd);
            rmSync(root2, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=commands.test.js.map