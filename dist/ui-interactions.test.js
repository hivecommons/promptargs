import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, parseVars, VAR_PATTERN } from './parser.js';
import { cartesian, zip } from './iterate.js';
/**
 * Behavior tests for ui.html's variable-table and preset wiring:
 * `syncVarsFromTemplate`, `addVarRow`, `insertAtCursor`, `loadPreset`,
 * `renderPresets`, `renderEnvChips` and the `scheduleUpdate` debounce.
 *
 * ui-builder.test.ts covers `update()` (preview + command) against a static
 * list of rows. These functions are the ones that *produce* those rows and
 * mutate the template, so they are extracted verbatim from the page (same
 * brace-matching approach) and run against a small stub DOM: `document`
 * creates fake elements, `<tr>.innerHTML` is parsed just far enough to read
 * back the `value="..."` attributes the way a browser would (entities decoded,
 * attribute terminated at the first `"`), and click handlers are captured so
 * tests can fire them.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');
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
function extractPresets() {
    const start = uiHtml.indexOf('const PRESETS = [');
    assert.notEqual(start, -1, 'PRESETS not found in ui.html');
    const end = uiHtml.indexOf('\n  ];', start);
    assert.notEqual(end, -1, 'PRESETS array is not terminated');
    const literal = uiHtml.slice(start + 'const PRESETS = '.length, end + '\n  ];'.length);
    // eslint-disable-next-line no-new-func
    return new Function(`return ${literal}`)();
}
const presets = extractPresets();
class ClassList {
    set = new Set();
    add(c) { this.set.add(c); }
    remove(c) { this.set.delete(c); }
    contains(c) { return this.set.has(c); }
    toggle(c, force) {
        const on = force === undefined ? !this.set.has(c) : force;
        if (on)
            this.set.add(c);
        else
            this.set.delete(c);
        return on;
    }
}
class FakeElement {
    tag;
    className = '';
    type = '';
    title = '';
    _html = '';
    get innerHTML() { return this._html; }
    set innerHTML(html) { this._html = html; }
    textContent = '';
    dataset = {};
    classList = new ClassList();
    style = {};
    children = [];
    handlers = new Map();
    constructor(tag) {
        this.tag = tag;
    }
    addEventListener(event, fn) {
        const list = this.handlers.get(event) ?? [];
        list.push(fn);
        this.handlers.set(event, list);
    }
    fire(event) {
        for (const fn of this.handlers.get(event) ?? [])
            fn();
    }
    appendChild(child) { this.children.push(child); }
}
function decodeEntities(s) {
    return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}
/** Reads `value="..."` from the first element whose class list contains `cls`. */
function attrValue(html, cls) {
    const re = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"\\s+value="([^"]*)"`);
    const m = html.match(re);
    assert.ok(m, `no .${cls} with a value attribute in: ${html}`);
    return decodeEntities(m[1]);
}
class FakeInput extends FakeElement {
    value;
    constructor(value) {
        super('input');
        this.value = value;
    }
}
/**
 * A `<tr>` as addVarRow builds it. Setting innerHTML materialises the two
 * inputs, the source select and the two buttons from the markup so that the
 * page's later querySelector calls see what a browser would have parsed.
 */
class FakeRow extends FakeElement {
    nameInput;
    valuesInput;
    sourceSelect;
    rmBtn = new FakeElement('button');
    insertBtn = new FakeElement('button');
    parent = null;
    constructor() { super('tr'); }
    get innerHTML() { return this._html; }
    set innerHTML(html) {
        this._html = html;
        this.nameInput = new FakeInput(attrValue(html, 'var-name'));
        this.valuesInput = new FakeInput(attrValue(html, 'var-values'));
        const selected = html.match(/<option value="(\w+)" selected>/);
        this.sourceSelect = new FakeInput(selected ? selected[1] : 'manual');
    }
    querySelector(sel) {
        switch (sel) {
            case '.var-name': return this.nameInput;
            case '.var-values': return this.valuesInput;
            case '.var-source': return this.sourceSelect;
            case '.rm-btn': return this.rmBtn;
            case '.insert-btn': return this.insertBtn;
            default: assert.fail(`unexpected row selector ${sel}`);
        }
    }
    querySelectorAll(sel) {
        assert.equal(sel, 'input, select');
        return [this.nameInput, this.valuesInput, this.sourceSelect];
    }
    remove() { this.parent?.detach(this); }
}
class FakeTableBody extends FakeElement {
    rows = [];
    constructor() { super('tbody'); }
    get innerHTML() { return ''; }
    set innerHTML(html) {
        assert.equal(html, '', 'ui.html only ever clears var-body');
        this.rows = [];
    }
    appendChild(child) {
        assert.ok(child instanceof FakeRow);
        child.parent = this;
        this.rows.push(child);
    }
    querySelectorAll(sel) {
        assert.equal(sel, 'tr');
        return [...this.rows];
    }
    detach(row) { this.rows = this.rows.filter(r => r !== row); }
}
class FakeTextarea extends FakeElement {
    value = '';
    selectionStart = 0;
    selectionEnd = 0;
    focused = false;
    constructor() { super('textarea'); }
    setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }
    focus() { this.focused = true; }
}
class FakeGrid extends FakeElement {
    constructor() { super('div'); }
    querySelectorAll(sel) {
        assert.equal(sel, '.preset-chip');
        return [...this.children];
    }
}
function makeHarness(debounceMs = 1) {
    const tmpl = new FakeTextarea();
    const varBody = new FakeTableBody();
    const presetGrid = new FakeGrid();
    const modeDesc = new FakeElement('span');
    const previewBody = new FakeElement('div');
    const previewCount = new FakeElement('span');
    const cliText = new FakeElement('code');
    const modeButtons = ['zip', 'cross'].map(m => {
        const b = new FakeElement('button');
        b.dataset.mode = m;
        if (m === 'zip')
            b.classList.add('active');
        return b;
    });
    const document = {
        createElement(tag) {
            return tag === 'tr' ? new FakeRow() : new FakeElement(tag);
        },
        querySelectorAll(sel) {
            assert.equal(sel, '.mode-btn');
            return modeButtons;
        },
    };
    const names = [
        'getRowData', 'syncVarsFromTemplate', 'addVarRow', 'esc', 'escHtml',
        'insertAtCursor', 'splitValues', 'highlightUnfilled', 'update',
        'scheduleUpdate', 'loadPreset', 'renderPresets', 'renderEnvChips',
    ];
    const src = names.map(extractFunction).join('\n');
    // eslint-disable-next-line no-new-func
    const factory = new Function('document', 'tmpl', 'varBody', 'presetGrid', 'modeDesc', 'previewBody', 'previewCount', 'cliText', 'PRESETS', 'DEBOUNCE_MS', 'parseVars', 'sharedCartesian', 'sharedZip', 'sharedExpand', 'VAR_PATTERN', `let mode = 'zip';
     let debounceTimer = null;
     ${src}
     return {
       get mode() { return mode; },
       syncVarsFromTemplate, addVarRow, insertAtCursor, loadPreset,
       renderPresets, renderEnvChips, scheduleUpdate,
     };`);
    const api = factory(document, tmpl, varBody, presetGrid, modeDesc, previewBody, previewCount, cliText, presets, debounceMs, parseVars, cartesian, zip, expand, VAR_PATTERN);
    return {
        tmpl, varBody, presetGrid, modeDesc, modeButtons, previewBody, previewCount, cliText,
        mode: () => api.mode,
        syncVarsFromTemplate: api.syncVarsFromTemplate,
        addVarRow: api.addVarRow,
        insertAtCursor: api.insertAtCursor,
        loadPreset: api.loadPreset,
        renderPresets: api.renderPresets,
        renderEnvChips: api.renderEnvChips,
        scheduleUpdate: api.scheduleUpdate,
        rowData: () => varBody.rows.map(r => [r.nameInput.value, r.valuesInput.value, r.sourceSelect.value]),
        cli: () => cliText.innerHTML.replace(/^<span class="dollar">\$<\/span>/, ''),
    };
}
const tick = (ms) => new Promise(r => setTimeout(r, ms));
// --- addVarRow / syncVarsFromTemplate ----------------------------------------
test('addVarRow appends a row with the given name, values and source preselected', () => {
    const h = makeHarness();
    h.addVarRow('file', 'a.go,b.go', 'glob');
    h.addVarRow('', '', 'manual');
    h.addVarRow('notes', 'README.md', 'file');
    assert.deepEqual(h.rowData(), [
        ['file', 'a.go,b.go', 'glob'],
        ['', '', 'manual'],
        ['notes', 'README.md', 'file'],
    ]);
});
test('addVarRow escapes names and values so they cannot break out of the value attribute', () => {
    const h = makeHarness();
    const hostile = 'x" onfocus="alert(1)';
    h.addVarRow(hostile, 'a&b <c>', 'manual');
    const [[name, values]] = h.rowData();
    // The browser reads the attribute back decoded, i.e. unchanged...
    assert.equal(name, hostile);
    assert.equal(values, 'a&b <c>');
    // ...and the raw markup never contains an un-entitied quote inside the value.
    const html = h.varBody.rows[0].innerHTML;
    assert.ok(!html.includes('value="x" onfocus'), 'quote in name must be escaped in markup');
    assert.ok(html.includes('value="x&quot; onfocus=&quot;alert(1)"'));
    assert.ok(html.includes('value="a&amp;b &lt;c>"'));
});
test('syncVarsFromTemplate adds a row per new template variable, seeded with its default', () => {
    const h = makeHarness();
    h.tmpl.value = 'Review {{file}} for {{focus=security}} and {{file}} again';
    h.syncVarsFromTemplate();
    assert.deepEqual(h.rowData(), [
        ['file', '', 'manual'],
        ['focus', 'security', 'manual'],
    ]);
});
test('syncVarsFromTemplate leaves existing rows and their values untouched', () => {
    const h = makeHarness();
    h.addVarRow('file', 'main.go', 'glob');
    h.tmpl.value = 'Review {{file}} for {{focus}}';
    h.syncVarsFromTemplate();
    h.syncVarsFromTemplate();
    assert.deepEqual(h.rowData(), [
        ['file', 'main.go', 'glob'],
        ['focus', '', 'manual'],
    ]);
});
test('syncVarsFromTemplate recognises whitespace-padded blanks like the CLI does', () => {
    const h = makeHarness();
    h.tmpl.value = 'Hello {{ name }} from {{ team=core }}';
    h.syncVarsFromTemplate();
    assert.deepEqual(h.rowData(), [
        ['name', '', 'manual'],
        ['team', 'core', 'manual'],
    ]);
});
test('a removed row disappears from the table and is re-added only if still in the template', async () => {
    const h = makeHarness();
    h.tmpl.value = 'Hello {{name}} and {{other}}';
    h.syncVarsFromTemplate();
    const [nameRow] = h.varBody.rows;
    nameRow.rmBtn.fire('click');
    assert.deepEqual(h.rowData(), [['other', '', 'manual']]);
    // The remove handler schedules a resync, which brings {{name}} back from the template.
    await tick(10);
    assert.deepEqual(h.rowData(), [['other', '', 'manual'], ['name', '', 'manual']]);
});
// --- insertAtCursor ----------------------------------------------------------
test('insertAtCursor replaces the selection, moves the caret after the insert and refocuses', () => {
    const h = makeHarness();
    h.tmpl.value = 'Review FILE for bugs';
    h.tmpl.setSelectionRange(7, 11);
    h.insertAtCursor('{{file}}');
    assert.equal(h.tmpl.value, 'Review {{file}} for bugs');
    assert.equal(h.tmpl.selectionStart, 15);
    assert.equal(h.tmpl.selectionEnd, 15);
    assert.ok(h.tmpl.focused);
});
test('insertAtCursor at a collapsed caret inserts without deleting text', () => {
    const h = makeHarness();
    h.tmpl.value = 'Hello ';
    h.tmpl.setSelectionRange(6, 6);
    h.insertAtCursor('{{name}}');
    assert.equal(h.tmpl.value, 'Hello {{name}}');
});
test('insertAtCursor deactivates the active preset chip and schedules a resync', async () => {
    const h = makeHarness();
    h.renderPresets();
    h.loadPreset(presets[0]);
    assert.ok(h.presetGrid.children.some(c => c.classList.contains('active')));
    h.tmpl.setSelectionRange(h.tmpl.value.length, h.tmpl.value.length);
    h.insertAtCursor(' {{extra}}');
    assert.ok(h.presetGrid.children.every(c => !c.classList.contains('active')));
    assert.ok(!h.rowData().some(([n]) => n === 'extra'), 'row is added on the debounce, not synchronously');
    await tick(10);
    assert.ok(h.rowData().some(([n]) => n === 'extra'));
});
test('the row insert button inserts {{name}} for the row it belongs to', () => {
    const h = makeHarness();
    h.addVarRow('target', '', 'manual');
    h.addVarRow('', '', 'manual');
    h.tmpl.value = 'Fix ';
    h.tmpl.setSelectionRange(4, 4);
    h.varBody.rows[0].insertBtn.fire('click');
    assert.equal(h.tmpl.value, 'Fix {{target}}');
    // A row with no name inserts nothing.
    h.varBody.rows[1].insertBtn.fire('click');
    assert.equal(h.tmpl.value, 'Fix {{target}}');
});
// --- scheduleUpdate ----------------------------------------------------------
test('scheduleUpdate debounces: many calls in the window produce a single sync and render', async () => {
    const h = makeHarness(15);
    h.tmpl.value = 'Hello {{name}}';
    h.scheduleUpdate();
    h.scheduleUpdate();
    h.scheduleUpdate();
    assert.deepEqual(h.rowData(), []);
    assert.equal(h.cliText.innerHTML, '');
    await tick(40);
    assert.deepEqual(h.rowData(), [['name', '', 'manual']]);
    assert.equal(h.cli(), 'promptargs "Hello {{name}}"');
});
// --- loadPreset / renderPresets ----------------------------------------------
test('renderPresets creates one chip per preset with escaped name and description', () => {
    const h = makeHarness();
    h.renderPresets();
    assert.equal(h.presetGrid.children.length, presets.length);
    presets.forEach((p, i) => {
        const chip = h.presetGrid.children[i];
        assert.equal(chip.tag, 'button');
        assert.equal(chip.type, 'button');
        assert.equal(chip.className, 'preset-chip');
        assert.equal(chip.dataset.preset, p.name);
        assert.ok(chip.innerHTML.includes(`<span class="preset-name">${p.name}</span>`));
    });
});
test('loadPreset replaces template, rows, mode and active chip, then renders', () => {
    const h = makeHarness();
    h.renderPresets();
    h.addVarRow('stale', 'leftover', 'file');
    const cross = presets.find(p => p.mode === 'cross');
    assert.ok(cross, 'need a cross-mode preset');
    h.loadPreset(cross);
    assert.equal(h.tmpl.value, cross.template);
    assert.equal(h.mode(), 'cross');
    assert.equal(h.modeDesc.textContent, 'Every combination of every value');
    assert.deepEqual(h.modeButtons.map(b => b.classList.contains('active')), [false, true]);
    assert.ok(!h.rowData().some(([n]) => n === 'stale'), 'previous rows are cleared');
    for (const v of parseVars(cross.template)) {
        const row = h.rowData().find(([n]) => n === v.name);
        assert.ok(row, `row for ${v.name}`);
        assert.equal(row[1], cross.vars[v.name]);
    }
    assert.deepEqual(h.presetGrid.children.map(c => c.classList.contains('active')), presets.map(p => p === cross));
    assert.ok(h.cliText.innerHTML.includes('--cross'), 'preview rendered with cross mode');
    assert.ok(!h.previewBody.innerHTML.includes('class="unfilled"'), 'every variable is filled');
});
test('clicking a chip loads its preset; a zip preset restores the zip description', () => {
    const h = makeHarness();
    h.renderPresets();
    const zipPreset = presets.find(p => p.mode === 'zip');
    const crossPreset = presets.find(p => p.mode === 'cross');
    assert.ok(zipPreset && crossPreset);
    h.presetGrid.children[presets.indexOf(crossPreset)].fire('click');
    assert.equal(h.mode(), 'cross');
    h.presetGrid.children[presets.indexOf(zipPreset)].fire('click');
    assert.equal(h.mode(), 'zip');
    assert.equal(h.modeDesc.textContent, 'Arrays pair up 1:1');
    assert.equal(h.tmpl.value, zipPreset.template);
    assert.deepEqual(h.modeButtons.map(b => b.classList.contains('active')), [true, false]);
});
test('loadPreset keeps a template variable the preset does not supply a value for', () => {
    const h = makeHarness();
    const preset = {
        name: 'partial',
        desc: 'x',
        template: 'Do {{task}} on {{file}}',
        vars: { file: 'a.ts' },
        mode: 'zip',
    };
    h.loadPreset(preset);
    assert.deepEqual(h.rowData(), [['task', '', 'manual'], ['file', 'a.ts', 'manual']]);
    assert.ok(h.previewBody.innerHTML.includes('<span class="unfilled">{{task}}</span>'));
});
// --- renderEnvChips ----------------------------------------------------------
test('renderEnvChips renders one clickable chip per entry and HTML-escapes keys and values', () => {
    const h = makeHarness();
    const container = new FakeElement('div');
    container.innerHTML = 'previous';
    h.renderEnvChips(container, [
        ['branch', 'main'],
        ['repo', '<org>/r&d'],
    ]);
    assert.equal(container.innerHTML, '', 'container is cleared first');
    assert.equal(container.children.length, 2);
    const [branch, repo] = container.children;
    assert.equal(branch.className, 'env-entry');
    assert.equal(branch.title, 'Click to insert {{branch}} at cursor');
    assert.ok(branch.innerHTML.includes('<span class="env-key">{{branch}}</span>'));
    assert.ok(branch.innerHTML.includes('<span class="env-val">main</span>'));
    assert.ok(repo.innerHTML.includes('<span class="env-val">&lt;org&gt;/r&amp;d</span>'));
    assert.ok(!repo.innerHTML.includes('<org>'));
});
test('clicking an env chip inserts its {{key}} at the cursor', () => {
    const h = makeHarness();
    const container = new FakeElement('div');
    h.renderEnvChips(container, [['branch', 'main']]);
    h.tmpl.value = 'On ';
    h.tmpl.setSelectionRange(3, 3);
    container.children[0].fire('click');
    assert.equal(h.tmpl.value, 'On {{branch}}');
});
//# sourceMappingURL=ui-interactions.test.js.map