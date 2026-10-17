import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doShow } from './commands.js';
import { UsageError } from './flags.js';
function captureShow(templateContent) {
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-show-'));
    mkdirSync(join(dir, '.prompts'));
    writeFileSync(join(dir, '.prompts', 'demo.md'), templateContent);
    const prevCwd = process.cwd();
    const origLog = console.log;
    const lines = [];
    process.chdir(dir);
    console.log = (...args) => {
        lines.push(args.map(String).join(' '));
    };
    try {
        doShow('demo');
    }
    finally {
        console.log = origLog;
        process.chdir(prevCwd);
        rmSync(dir, { recursive: true, force: true });
    }
    return lines.join('\n');
}
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
//# sourceMappingURL=commands.test.js.map