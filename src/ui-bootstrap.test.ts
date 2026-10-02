import test, { mock } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, parseVars, VAR_PATTERN } from './parser.js';
import { cartesian, zip } from './iterate.js';

/**
 * Behavior tests for the top-level wiring of ui.html's inline script: the
 * code that runs once when the page loads and connects the DOM to the
 * functions covered by ui-builder.test.ts and ui-interactions.test.ts.
 *
 * That wiring is the only part of the page no other suite reaches:
 *  - the init sequence (renderPresets + loadPreset(PRESETS[0]))
 *  - the template `input`, "+ add variable", mode and cheatsheet handlers
 *  - the Copy button (clipboard text, "Copied" feedback and its revert)
 *  - the `window.__PROMPTARGS_ENV__` section: git chips, the lazy terminal
 *    toggle and the hide/show decisions for each group
 *
 * The whole IIFE body is extracted verbatim and run against a stub DOM.
 * Timers are mocked so the 120ms debounce and the 1.5s "Copied" revert are
 * driven deterministically.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

function extractIifeBody(): string {
  const open = '(function () {';
  const start = uiHtml.indexOf(open);
  assert.notEqual(start, -1, 'ui.html inline script IIFE not found');
  const close = '\n})();';
  const end = uiHtml.indexOf(close, start);
  assert.notEqual(end, -1, 'ui.html inline script IIFE is not terminated');
  return uiHtml.slice(start + open.length, end);
}

const iifeBody = extractIifeBody();

// --- stub DOM ----------------------------------------------------------------

type Handler = () => void;

class ClassList {
  private set = new Set<string>();
  add(c: string) { this.set.add(c); }
  remove(c: string) { this.set.delete(c); }
  contains(c: string) { return this.set.has(c); }
  toggle(c: string, force?: boolean) {
    const on = force === undefined ? !this.set.has(c) : force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

class FakeElement {
  className = '';
  type = '';
  title = '';
  protected _html = '';
  protected _text = '';
  get innerHTML() { return this._html; }
  /** Like a browser, setting innerHTML also replaces textContent. */
  set innerHTML(html: string) {
    this._html = html;
    this._text = decodeEntities(html.replace(/<[^>]*>/g, ''));
  }
  get textContent() { return this._text; }
  set textContent(t: string) { this._text = t; this._html = t; }
  dataset: Record<string, string> = {};
  classList = new ClassList();
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  constructor(public tag: string, public id = '') {}
  addEventListener(event: string, fn: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
  }
  fire(event: string) {
    for (const fn of this.handlers.get(event) ?? []) fn();
  }
  appendChild(child: FakeElement) { this.children.push(child); }
  querySelectorAll(sel: string): FakeElement[] {
    const cls = sel.replace(/^\./, '');
    return this.children.filter(c => c.className.split(/\s+/).includes(cls));
  }
}

/** Reads `value="..."` from the first element whose class list contains `cls`. */
function attrValue(html: string, cls: string): string {
  const re = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"\\s+value="([^"]*)"`);
  const m = html.match(re);
  assert.ok(m, `no .${cls} with a value attribute in: ${html}`);
  return decodeEntities(m[1]);
}

class FakeInput extends FakeElement {
  constructor(public value: string) { super('input'); }
}

class FakeRow extends FakeElement {
  nameInput!: FakeInput;
  valuesInput!: FakeInput;
  sourceSelect!: FakeInput;
  rmBtn = new FakeElement('button');
  insertBtn = new FakeElement('button');
  parent: FakeTableBody | null = null;
  constructor() { super('tr'); }
  override get innerHTML() { return this._html; }
  override set innerHTML(html: string) {
    this._html = html;
    this.nameInput = new FakeInput(attrValue(html, 'var-name'));
    this.valuesInput = new FakeInput(attrValue(html, 'var-values'));
    const selected = html.match(/<option value="(\w+)" selected>/);
    this.sourceSelect = new FakeInput(selected ? selected[1] : 'manual');
  }
  querySelector(sel: string): FakeElement {
    switch (sel) {
      case '.var-name': return this.nameInput;
      case '.var-values': return this.valuesInput;
      case '.var-source': return this.sourceSelect;
      case '.rm-btn': return this.rmBtn;
      case '.insert-btn': return this.insertBtn;
      default: assert.fail(`unexpected row selector ${sel}`);
    }
  }
  override querySelectorAll(sel: string): FakeElement[] {
    assert.equal(sel, 'input, select');
    return [this.nameInput, this.valuesInput, this.sourceSelect];
  }
  remove() { this.parent?.detach(this); }
}

class FakeTableBody extends FakeElement {
  rows: FakeRow[] = [];
  constructor() { super('tbody', 'var-body'); }
  override get innerHTML() { return ''; }
  override set innerHTML(html: string) {
    assert.equal(html, '', 'ui.html only ever clears var-body');
    this.rows = [];
  }
  override appendChild(child: FakeElement) {
    assert.ok(child instanceof FakeRow);
    child.parent = this;
    this.rows.push(child);
  }
  override querySelectorAll(sel: string): FakeRow[] {
    assert.equal(sel, 'tr');
    return [...this.rows];
  }
  detach(row: FakeRow) { this.rows = this.rows.filter(r => r !== row); }
}

class FakeTextarea extends FakeElement {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  focused = false;
  constructor() { super('textarea', 'tmpl'); }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  focus() { this.focused = true; }
}

interface EnvPayload {
  git?: Record<string, string>;
  terminal?: Record<string, string>;
}

interface Page {
  tmpl: FakeTextarea;
  varBody: FakeTableBody;
  addBtn: FakeElement;
  presetGrid: FakeElement;
  previewBody: FakeElement;
  previewCount: FakeElement;
  cliText: FakeElement;
  copyBtn: FakeElement;
  modeDesc: FakeElement;
  modeButtons: FakeElement[];
  envSection: FakeElement;
  envGit: FakeElement;
  envTerminal: FakeElement;
  envGitGroup: FakeElement;
  envTerminalGroup: FakeElement;
  envToggle: FakeElement;
  cheatsheet: FakeElement;
  cheatsheetToggle: FakeElement;
  clipboard: string[];
  /** Rows as [name, values, source] the way getRowData reads them. */
  rowData: () => [string, string, string][];
  cli: () => string;
  chips: () => FakeElement[];
  activeChips: () => string[];
}

/** Builds the stub DOM with the same ids/classes/initial styles as ui.html and runs the page script. */
function loadPage(env?: EnvPayload): Page {
  const tmpl = new FakeTextarea();
  const varBody = new FakeTableBody();
  const addBtn = new FakeElement('button', 'add-var');
  const presetGrid = new FakeElement('div', 'preset-grid');
  const previewBody = new FakeElement('div', 'preview-body');
  const previewCount = new FakeElement('span', 'preview-count');
  const cliText = new FakeElement('code', 'cli-text');
  const copyBtn = new FakeElement('button', 'copy-btn');
  copyBtn.textContent = 'Copy';
  const modeDesc = new FakeElement('span', 'mode-desc');
  const envSection = new FakeElement('div', 'env-section');
  envSection.style.display = 'none';
  const envGit = new FakeElement('div', 'env-git');
  const envTerminal = new FakeElement('div', 'env-terminal');
  const envGitGroup = new FakeElement('div', 'env-git-group');
  const envTerminalGroup = new FakeElement('div', 'env-terminal-group');
  envTerminalGroup.style.display = 'none';
  const envToggle = new FakeElement('button', 'env-toggle');
  envToggle.style.display = 'none';
  envToggle.textContent = 'Show terminal env';
  const cheatsheet = new FakeElement('div', 'cheatsheet');
  const cheatsheetToggle = new FakeElement('button', 'cheatsheet-toggle');
  const modeButtons = ['zip', 'cross'].map(m => {
    const b = new FakeElement('button');
    b.className = 'mode-btn';
    b.dataset.mode = m;
    if (m === 'zip') b.classList.add('active');
    return b;
  });

  const byId: Record<string, FakeElement> = {};
  for (const el of [
    tmpl, varBody, addBtn, presetGrid, previewBody, previewCount, cliText, copyBtn, modeDesc,
    envSection, envGit, envTerminal, envGitGroup, envTerminalGroup, envToggle, cheatsheet, cheatsheetToggle,
  ]) byId[el.id] = el;

  const document = {
    getElementById(id: string): FakeElement {
      const el = byId[id];
      assert.ok(el, `ui.html references unknown element #${id}`);
      return el;
    },
    createElement(tag: string): FakeElement {
      return tag === 'tr' ? new FakeRow() : new FakeElement(tag);
    },
    querySelectorAll(sel: string): FakeElement[] {
      assert.equal(sel, '.mode-btn');
      return modeButtons;
    },
  };

  const clipboard: string[] = [];
  const navigator = {
    clipboard: {
      writeText(text: string) { clipboard.push(text); return Promise.resolve(); },
    },
  };
  const window = env === undefined ? {} : { __PROMPTARGS_ENV__: env };

  // eslint-disable-next-line no-new-func
  const run = new Function(
    'document', 'window', 'navigator',
    'parseVars', 'sharedExpand', 'VAR_PATTERN', 'sharedCartesian', 'sharedZip',
    iifeBody,
  );
  run(document, window, navigator, parseVars, expand, VAR_PATTERN, cartesian, zip);

  return {
    tmpl, varBody, addBtn, presetGrid, previewBody, previewCount, cliText, copyBtn, modeDesc, modeButtons,
    envSection, envGit, envTerminal, envGitGroup, envTerminalGroup, envToggle, cheatsheet, cheatsheetToggle,
    clipboard,
    rowData: () => varBody.rows.map(r => [r.nameInput.value, r.valuesInput.value, r.sourceSelect.value]),
    cli: () => cliText.innerHTML.replace(/^<span class="dollar">\$<\/span>/, ''),
    chips: () => presetGrid.children,
    activeChips: () => presetGrid.children.filter(c => c.classList.contains('active')).map(c => c.dataset.preset),
  };
}

const DEBOUNCE_MS = 120;
const COPIED_REVERT_MS = 1500;

test.beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
test.afterEach(() => { mock.timers.reset(); });

// --- init --------------------------------------------------------------------

test('page load renders every preset chip and loads the first preset', () => {
  const p = loadPage();
  const presetsStart = uiHtml.indexOf('const PRESETS = [');
  const presetsEnd = uiHtml.indexOf('\n  ];', presetsStart);
  const presetCount = (uiHtml.slice(presetsStart, presetsEnd).match(/^\s+name: '/gm) ?? []).length;
  assert.ok(presetCount > 1, 'ui.html defines several presets');
  assert.equal(p.chips().length, presetCount);
  assert.deepEqual(p.activeChips(), [p.chips()[0].dataset.preset]);
  assert.ok(p.tmpl.value.includes('{{'), 'first preset template is in the textarea');
  assert.ok(p.rowData().length > 0, 'first preset variables are in the table');
  assert.ok(p.rowData().every(([, v]) => v !== ''), 'first preset fills every variable');
  assert.ok(p.cli().startsWith('promptargs'));
  assert.ok(!p.previewBody.innerHTML.includes('class="unfilled"'));
  const firstMode = uiHtml.slice(presetsStart, presetsEnd).match(/mode: '(\w+)'/)![1];
  assert.equal(p.modeDesc.textContent, firstMode === 'zip' ? 'Arrays pair up 1:1' : 'Every combination of every value');
  assert.deepEqual(p.modeButtons.map(b => b.classList.contains('active')), [firstMode === 'zip', firstMode === 'cross']);
});

test('page load without __PROMPTARGS_ENV__ leaves the env section hidden and unwired', () => {
  const p = loadPage();
  assert.equal(p.envSection.style.display, 'none');
  assert.equal(p.envToggle.style.display, 'none');
  assert.equal(p.envGit.children.length, 0);
  assert.equal(p.envToggle.handlers.size, 0);
});

// --- template input ----------------------------------------------------------

test('editing the template deactivates the preset chip and resyncs rows after the debounce', () => {
  const p = loadPage();
  assert.equal(p.activeChips().length, 1);
  p.tmpl.value += ' and {{extra}}';
  p.tmpl.fire('input');
  assert.deepEqual(p.activeChips(), []);
  assert.ok(!p.rowData().some(([n]) => n === 'extra'), 'rows sync on the debounce, not synchronously');
  mock.timers.tick(DEBOUNCE_MS - 1);
  assert.ok(!p.rowData().some(([n]) => n === 'extra'));
  mock.timers.tick(1);
  assert.ok(p.rowData().some(([n]) => n === 'extra'));
  assert.ok(p.previewBody.innerHTML.includes('<span class="unfilled">{{extra}}</span>'));
});

test('rapid template edits collapse into one debounced update', () => {
  const p = loadPage();
  p.tmpl.value = 'A {{one}}';
  p.tmpl.fire('input');
  mock.timers.tick(DEBOUNCE_MS / 2);
  p.tmpl.value = 'A {{one}} {{two}}';
  p.tmpl.fire('input');
  mock.timers.tick(DEBOUNCE_MS / 2);
  const before = p.rowData().map(([n]) => n);
  assert.ok(!before.includes('one') && !before.includes('two'), 'first timer was cancelled by the second edit');
  mock.timers.tick(DEBOUNCE_MS / 2);
  const after = p.rowData().map(([n]) => n);
  assert.ok(after.includes('one') && after.includes('two'));
});

// --- add variable ------------------------------------------------------------

test('"+ add variable" appends an empty manual row without rendering', () => {
  const p = loadPage();
  const n = p.rowData().length;
  const cliBefore = p.cli();
  p.addBtn.fire('click');
  assert.equal(p.rowData().length, n + 1);
  assert.deepEqual(p.rowData()[n], ['', '', 'manual']);
  assert.equal(p.cli(), cliBefore, 'an unnamed row changes nothing until it is filled in');
});

// --- mode buttons ------------------------------------------------------------

test('mode buttons switch mode, active class, description and re-render immediately', () => {
  const p = loadPage();
  // Two array variables so that cross and zip produce different commands.
  p.tmpl.value = '{{a}} {{b}}';
  p.tmpl.fire('input');
  for (const row of [...p.varBody.rows]) row.rmBtn.fire('click');
  mock.timers.tick(DEBOUNCE_MS);
  assert.deepEqual(p.rowData().map(([n]) => n), ['a', 'b']);
  for (const row of p.varBody.rows) row.valuesInput.value = row.nameInput.value === 'a' ? '1,2' : 'x,y';
  const [zipBtn, crossBtn] = p.modeButtons;

  crossBtn.fire('click');
  assert.deepEqual(p.modeButtons.map(b => b.classList.contains('active')), [false, true]);
  assert.equal(p.modeDesc.textContent, 'Every combination of every value');
  assert.ok(p.cli().endsWith(' --cross'), p.cli());
  assert.equal(p.previewCount.textContent, '4 results');

  zipBtn.fire('click');
  assert.deepEqual(p.modeButtons.map(b => b.classList.contains('active')), [true, false]);
  assert.equal(p.modeDesc.textContent, 'Arrays pair up 1:1');
  assert.ok(!p.cli().includes('--cross'));
  assert.equal(p.previewCount.textContent, '2 results');
});

// --- copy button -------------------------------------------------------------

test('Copy writes the command without the "$ " prompt and shows "Copied" for 1.5s', async () => {
  const p = loadPage();
  p.copyBtn.fire('click');
  await Promise.resolve();
  assert.deepEqual(p.clipboard, [p.cliText.textContent.replace(/^\$\s*/, '')]);
  assert.ok(p.clipboard[0].startsWith('promptargs '));
  assert.ok(!p.clipboard[0].startsWith('$'));
  assert.equal(p.copyBtn.textContent, 'Copied');
  assert.ok(p.copyBtn.classList.contains('copied'));
  mock.timers.tick(COPIED_REVERT_MS - 1);
  assert.equal(p.copyBtn.textContent, 'Copied');
  mock.timers.tick(1);
  assert.equal(p.copyBtn.textContent, 'Copy');
  assert.ok(!p.copyBtn.classList.contains('copied'));
});

test('Copy yields the shell-quoted command, so multi-word preset values survive paste (#86)', async () => {
  const p = loadPage();
  const multiWord = p.chips().find(c => {
    p.tmpl.value = '';
    c.fire('click');
    return p.rowData().some(([, v]) => /\s/.test(v) && !v.includes(','));
  });
  assert.ok(multiWord, 'a preset with a multi-word scalar value exists');
  const [, value] = p.rowData().find(([, v]) => /\s/.test(v) && !v.includes(','))!;
  p.copyBtn.fire('click');
  await Promise.resolve();
  assert.ok(p.clipboard[0].includes(`='${value}'`), `${p.clipboard[0]} quotes ${value}`);
  assert.ok(!p.clipboard[0].includes('&quot;') && !p.clipboard[0].includes('&amp;'), 'clipboard text is not HTML');
});

// --- cheatsheet --------------------------------------------------------------

test('cheatsheet toggle flips the open class on each click', () => {
  const p = loadPage();
  assert.ok(!p.cheatsheet.classList.contains('open'));
  p.cheatsheetToggle.fire('click');
  assert.ok(p.cheatsheet.classList.contains('open'));
  p.cheatsheetToggle.fire('click');
  assert.ok(!p.cheatsheet.classList.contains('open'));
});

// --- env section -------------------------------------------------------------

test('env payload with only empty values keeps the whole section hidden', () => {
  const p = loadPage({ git: { branch: '' }, terminal: { USER: '' } });
  assert.equal(p.envSection.style.display, 'none');
  assert.equal(p.envGitGroup.style.display, 'none', 'empty git group is hidden');
  assert.equal(p.envToggle.style.display, 'none');
  assert.equal(p.envGit.children.length, 0);
});

test('git entries render as chips eagerly; without terminal entries the toggle stays hidden', () => {
  const p = loadPage({ git: { branch: 'main', repo: 'org/r', dirty: '' } });
  assert.equal(p.envSection.style.display, '');
  assert.notEqual(p.envGitGroup.style.display, 'none');
  assert.deepEqual(p.envGit.children.map(c => c.title), [
    'Click to insert {{branch}} at cursor',
    'Click to insert {{repo}} at cursor',
  ]);
  assert.equal(p.envToggle.style.display, 'none');
  assert.equal(p.envTerminalGroup.style.display, 'none');
  assert.equal(p.envTerminal.children.length, 0);
});

test('a git chip click inserts {{key}} into the template and deactivates the preset', () => {
  const p = loadPage({ git: { branch: 'main' } });
  const end = p.tmpl.value.length;
  p.tmpl.setSelectionRange(end, end);
  p.envGit.children[0].fire('click');
  assert.ok(p.tmpl.value.endsWith('{{branch}}'));
  assert.deepEqual(p.activeChips(), []);
  mock.timers.tick(DEBOUNCE_MS);
  assert.ok(p.rowData().some(([n]) => n === 'branch'));
});

test('terminal entries hide the git group, show a counted toggle and render chips lazily once', () => {
  const p = loadPage({ terminal: { USER: 'dev', SHELL: '/bin/zsh', EMPTY: '' } });
  assert.equal(p.envSection.style.display, '');
  assert.equal(p.envGitGroup.style.display, 'none');
  assert.equal(p.envToggle.style.display, '');
  assert.equal(p.envToggle.textContent, 'Show terminal env (2 vars)');
  assert.equal(p.envTerminal.children.length, 0, 'terminal chips are not rendered until requested');

  p.envToggle.fire('click');
  assert.equal(p.envTerminalGroup.style.display, '');
  assert.equal(p.envToggle.textContent, 'Hide terminal env');
  assert.equal(p.envTerminal.children.length, 2);
  const rendered = p.envTerminal.children;

  p.envToggle.fire('click');
  assert.equal(p.envTerminalGroup.style.display, 'none');
  assert.equal(p.envToggle.textContent, 'Show terminal env (2 vars)');

  p.envToggle.fire('click');
  assert.equal(p.envTerminalGroup.style.display, '');
  assert.deepEqual(p.envTerminal.children, rendered, 'chips are rendered once, not duplicated on re-show');
});

test('both git and terminal entries render independently', () => {
  const p = loadPage({ git: { branch: 'main' }, terminal: { USER: 'dev' } });
  assert.equal(p.envSection.style.display, '');
  assert.notEqual(p.envGitGroup.style.display, 'none');
  assert.equal(p.envGit.children.length, 1);
  assert.equal(p.envToggle.textContent, 'Show terminal env (1 vars)');
  p.envToggle.fire('click');
  assert.equal(p.envTerminal.children.length, 1);
  assert.ok(p.envTerminal.children[0].innerHTML.includes('<span class="env-val">dev</span>'));
});
