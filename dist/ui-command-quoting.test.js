import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { VAR_PATTERN, expand } from './parser.js';
import { cartesian, zip } from './iterate.js';
import { compileInlineScript } from './ui-harness.js';
/**
 * Regression tests for the shell safety of the command `update()` in
 * ui.html generates (#86): a value with whitespace or shell metacharacters
 * used to be emitted bare, so the `explain` and `fix` presets produced a
 * command whose prompt was silently truncated by the shell.
 *
 * `update()` lives inside ui.html's IIFE, so it is extracted verbatim and
 * evaluated against a stub DOM holding only what the command builder reads.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');
function extractFunction(name) {
    const start = uiHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `function ${name} not found in ui.html`);
    let depth = 0;
    for (let i = uiHtml.indexOf('{', start); i < uiHtml.length; i++) {
        if (uiHtml[i] === '{')
            depth++;
        else if (uiHtml[i] === '}' && --depth === 0)
            return uiHtml.slice(start, i + 1);
    }
    assert.fail(`unbalanced braces extracting ${name} from ui.html`);
}
/** Runs update() for one template + rows and returns the generated command. */
function commandFor(template, rows) {
    const node = () => ({ innerHTML: '', textContent: '', className: '' });
    const cliText = node();
    const varBody = {
        querySelectorAll: () => rows.map(row => ({
            querySelector: (sel) => sel === '.var-name' ? { value: row.name }
                : sel === '.var-values' ? { value: row.values }
                    : { value: row.source ?? 'manual' },
        })),
    };
    const src = ['getRowData', 'splitValues', 'escHtml', 'highlightUnfilled', 'update']
        .map(extractFunction).join('\n');
    const factory = compileInlineScript('ui-update', [
        'tmpl', 'varBody', 'previewBody', 'previewCount', 'cliText', 'mode',
        'sharedCartesian', 'sharedZip', 'sharedExpand', 'VAR_PATTERN',
    ], `${src}\nreturn update;`);
    const update = factory({ value: template }, varBody, node(), node(), cliText, 'zip', cartesian, zip, expand, VAR_PATTERN);
    update();
    return cliText.innerHTML
        .replace(/^<span class="dollar">\$<\/span>/, '')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/** What a POSIX shell would hand to the CLI for the generated command. */
function shellWords(command) {
    const args = command.replace(/^promptargs /, '');
    const r = spawnSync('sh', ['-c', `printf '%s\\n' ${args}`], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.replace(/\n$/, '').split('\n');
}
test('bare values stay unquoted, so the common command is unchanged', () => {
    assert.equal(commandFor('Review {{file}} for {{focus=correctness}}', [{ name: 'file', values: 'api.go' }, { name: 'focus', values: 'security' }]), 'promptargs "Review {{file}} for {{focus=correctness}}" --file=api.go --focus=security');
    assert.equal(commandFor('{{file}} {{src}}', [{ name: 'file', values: 'list.txt', source: 'file' }, { name: 'src', values: 'src/*.go', source: 'glob' }]), 'promptargs "{{file}} {{src}}" --file=@list.txt --src="src/*.go"');
});
test('explain preset: a multi-word audience reaches the CLI as one argument', () => {
    const cmd = commandFor('Explain {{file}} to a {{audience=junior developer}}', [{ name: 'file', values: 'a.ts' }, { name: 'audience', values: 'junior developer' }]);
    assert.equal(cmd, `promptargs "Explain {{file}} to a {{audience=junior developer}}" --file=a.ts --audience='junior developer'`);
    assert.deepEqual(shellWords(cmd), ['Explain {{file}} to a {{audience=junior developer}}', '--file=a.ts', '--audience=junior developer']);
});
test('fix preset: expected/actual sentences are not split into stray positionals', () => {
    const cmd = commandFor('Fix {{file}}: expected {{expected}} but {{actual}}', [
        { name: 'file', values: 'x.go' },
        { name: 'expected', values: 'returns user object' },
        { name: 'actual', values: 'crashes on line 42' },
    ]);
    assert.deepEqual(shellWords(cmd), [
        'Fix {{file}}: expected {{expected}} but {{actual}}', '--file=x.go',
        '--expected=returns user object', '--actual=crashes on line 42',
    ]);
});
test('shell metacharacters in values and the template are literal', () => {
    const cmd = commandFor('Cost is $HOME `whoami` \\ "quoted" {{v}}', [{ name: 'v', values: `it's $x; rm -rf *` }]);
    assert.deepEqual(shellWords(cmd), ['Cost is $HOME `whoami` \\ "quoted" {{v}}', `--v=it's $x; rm -rf *`]);
});
test('a comma-separated array value stays a bare word so arrays still parse', () => {
    assert.equal(commandFor('{{f}}', [{ name: 'f', values: 'a.go,b.go' }]), 'promptargs "{{f}}" --f=a.go,b.go');
});
test('a glob value keeps its double quotes but shell-expandable characters inside are escaped', () => {
    const cmd = commandFor('{{src}}', [{ name: 'src', values: 'src/$HOME/`x`/"q"/*.go', source: 'glob' }]);
    assert.equal(cmd, 'promptargs "{{src}}" --src="src/\\$HOME/\\`x\\`/\\"q\\"/*.go"');
    assert.deepEqual(shellWords(cmd), ['{{src}}', '--src=src/$HOME/`x`/"q"/*.go']);
});
//# sourceMappingURL=ui-command-quoting.test.js.map