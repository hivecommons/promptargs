import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVars, expand as parserExpand, VAR_PATTERN } from './parser.js';
import { resolve } from './resolver.js';
/**
 * Parity tests for the inline <script> in ui.html.
 *
 * The browser builder re-implements the {{var}} grammar, expansion, and
 * array-iteration logic from parser.ts/resolver.ts as plain functions inside
 * ui.html. Nothing type-checks that copy, so it can silently drift from the
 * CLI. These tests extract the inline functions by source and assert they
 * behave like their CLI counterparts.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');
/** Extract a `function name(...) { ... }` declaration via brace matching. */
function extractFunction(name) {
    const start = uiHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `function ${name} not found in ui.html`);
    const bodyStart = uiHtml.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < uiHtml.length; i++) {
        if (uiHtml[i] === '{')
            depth++;
        else if (uiHtml[i] === '}') {
            depth--;
            if (depth === 0)
                return uiHtml.slice(start, i + 1);
        }
    }
    assert.fail(`unbalanced braces extracting ${name} from ui.html`);
}
function extractVarRe() {
    const m = uiHtml.match(/const VAR_RE = (\/.*?\/g);/);
    assert.ok(m, 'VAR_RE literal not found in ui.html');
    // eslint-disable-next-line no-new-func
    return new Function(`return ${m[1]};`)();
}
function instantiate(name) {
    const src = extractFunction(name);
    // eslint-disable-next-line no-new-func
    return new Function('VAR_RE', `return ${src};`)(extractVarRe());
}
const uiParseVars = instantiate('parseVarsFromTemplate');
const uiExpand = instantiate('expand');
const uiSplitValues = instantiate('splitValues');
const uiCartesian = instantiate('cartesian');
const uiZip = instantiate('zip');
const uiEsc = instantiate('esc');
const uiEscHtml = instantiate('escHtml');
test('ui.html VAR_RE matches parser VAR_PATTERN exactly', () => {
    const uiRe = extractVarRe();
    assert.equal(uiRe.source, VAR_PATTERN.source);
    assert.equal(uiRe.flags, VAR_PATTERN.flags);
});
test('parseVarsFromTemplate agrees with parser.parseVars', () => {
    const templates = [
        'Review {{file}} for {{focus=correctness}} issues.',
        'no vars here',
        '{{a}}{{a}}{{b=x,y}} dedupe {{a=ignored-second-default}}',
        'empty default {{name=}} and word chars {{v_1}}',
        'not vars: {{ spaced }} {{has-dash}} {{}}',
    ];
    for (const tpl of templates) {
        const cli = parseVars(tpl).map(v => ({ name: v.name, defaultValue: v.defaultValue }));
        const ui = uiParseVars(tpl).map(v => ({ name: v.name, defaultValue: v.defaultValue }));
        assert.deepEqual(ui, cli, `parseVars drift for template: ${tpl}`);
    }
});
test('ui expand agrees with parser.expand', () => {
    const cases = [
        { tpl: 'Review {{file}} for {{focus=correctness}}.', values: { file: 'api.go' } },
        { tpl: '{{a}} {{b}} {{a}}', values: { a: '1', b: '2' } },
        { tpl: 'unfilled {{missing}} stays', values: {} },
        { tpl: 'default used {{tone=concise}}', values: {} },
        { tpl: 'value beats default {{tone=concise}}', values: { tone: 'verbose' } },
        { tpl: 'special chars {{v}}', values: { v: 'a&b <c> "d"' } },
        { tpl: 'value with braces {{v}}', values: { v: 'literal {{x}} kept' } },
    ];
    for (const { tpl, values } of cases) {
        assert.equal(uiExpand(tpl, values), parserExpand(tpl, values), `expand drift for: ${tpl}`);
    }
});
test('ui splitValues mirrors CLI comma-separated handling', () => {
    assert.deepEqual(uiSplitValues('a.go, b.go ,c.go', 'manual'), ['a.go', 'b.go', 'c.go']);
    assert.deepEqual(uiSplitValues('a,,b,', 'manual'), ['a', 'b']);
    assert.deepEqual(uiSplitValues('', 'manual'), []);
    // @file values are opaque single entries in the UI (server has no file access)
    assert.deepEqual(uiSplitValues('one,two', 'file'), ['one,two']);
});
test('ui cartesian agrees with resolver --cross iteration order', async () => {
    const vars = [
        { name: 'file', raw: '{{file}}' },
        { name: 'focus', raw: '{{focus}}' },
    ];
    const { iterations } = await resolve(vars, { file: 'a.go,b.go,c.go', focus: 'security,perf' }, false, true);
    const cli = iterations.map(it => [it['file'], it['focus']]);
    const ui = uiCartesian([
        ['a.go', 'b.go', 'c.go'],
        ['security', 'perf'],
    ]);
    assert.deepEqual(ui, cli);
    assert.deepEqual(uiCartesian([]), [[]]);
});
test('ui zip agrees with resolver zip for equal-length arrays', async () => {
    const vars = [
        { name: 'file', raw: '{{file}}' },
        { name: 'focus', raw: '{{focus}}' },
    ];
    const { iterations } = await resolve(vars, { file: 'a.go,b.go,c.go', focus: 'security,perf,correctness' }, false, false);
    const cli = iterations.map(it => [it['file'], it['focus']]);
    const ui = uiZip([
        ['a.go', 'b.go', 'c.go'],
        ['security', 'perf', 'correctness'],
    ]);
    assert.deepEqual(ui, cli);
    // NOTE: for UNEVEN-length arrays the two implementations currently
    // disagree: resolver.ts wraps (arr[i % arr.length]) while ui.html clamps
    // to the last element (a[Math.min(i, a.length - 1)]). Tracked in issue #62;
    // extend this test to uneven lengths once ui.html adopts wrap semantics.
});
test('ui esc/escHtml escape injection-relevant characters', () => {
    // esc feeds attribute values built with innerHTML
    assert.equal(uiEsc('a&b "c" <d>'), 'a&amp;b &quot;c&quot; &lt;d>');
    // escHtml feeds text content
    assert.equal(uiEscHtml('a&b <script>'), 'a&amp;b &lt;script&gt;');
});
//# sourceMappingURL=ui-inline.test.js.map