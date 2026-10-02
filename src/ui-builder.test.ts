import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, parseVars, VAR_PATTERN } from './parser.js';
import { cartesian, zip } from './iterate.js';
import { compileInlineScript } from './ui-harness.js';

/**
 * Behavior tests for ui.html's builder logic: `update()` (preview rendering
 * and the copyable CLI command) plus the PRESETS catalogue.
 *
 * ui.html runs an IIFE against the live DOM, so `update()` cannot be
 * imported. Instead the function bodies are extracted verbatim from the
 * page (same approach as ui-inline.test.ts) and instantiated with a tiny
 * stub DOM: `tmpl` exposes `.value`, `varBody.querySelectorAll('tr')`
 * yields rows whose `.querySelector(sel).value` returns the cell values, and
 * the three output nodes record `innerHTML` / `textContent` / `className`.
 * The grammar and iteration helpers are the real compiled modules, exactly
 * as the browser imports them.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

function extractFunction(name: string): string {
  const start = uiHtml.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in ui.html`);
  const bodyStart = uiHtml.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < uiHtml.length; i++) {
    if (uiHtml[i] === '{') depth++;
    else if (uiHtml[i] === '}') {
      depth--;
      if (depth === 0) return uiHtml.slice(start, i + 1);
    }
  }
  assert.fail(`unbalanced braces extracting ${name} from ui.html`);
}

interface OutputNode {
  innerHTML: string;
  textContent: string;
  className: string;
}

interface Row {
  name: string;
  values: string;
  source?: 'manual' | 'glob' | 'file';
}

interface Harness {
  update: () => void;
  tmpl: { value: string };
  rows: Row[];
  previewBody: OutputNode;
  previewCount: OutputNode;
  cliText: OutputNode;
  /** The CLI command as the Copy button would read it (without the `$ `). */
  cli: () => string;
  /** Number of rendered `.iteration` blocks. */
  iterations: () => number;
}

function makeHarness(mode: 'zip' | 'cross' = 'zip'): Harness {
  const node = (): OutputNode => ({ innerHTML: '', textContent: '', className: '' });
  const tmpl = { value: '' };
  const rows: Row[] = [];
  const previewBody = node();
  const previewCount = node();
  const cliText = node();

  const varBody = {
    querySelectorAll(selector: string) {
      assert.equal(selector, 'tr');
      return rows.map(row => ({
        querySelector(sel: string) {
          if (sel === '.var-name') return { value: row.name };
          if (sel === '.var-values') return { value: row.values };
          if (sel === '.var-source') return { value: row.source ?? 'manual' };
          assert.fail(`unexpected cell selector ${sel}`);
        },
      }));
    },
  };

  const src = ['getRowData', 'splitValues', 'escHtml', 'highlightUnfilled', 'update']
    .map(extractFunction)
    .join('\n');
  const factory = compileInlineScript<() => void>('ui-update', [
    'tmpl', 'varBody', 'previewBody', 'previewCount', 'cliText', 'mode',
    'sharedCartesian', 'sharedZip', 'sharedExpand', 'VAR_PATTERN',
  ], `${src}\nreturn update;`);
  const update = factory(
    tmpl, varBody, previewBody, previewCount, cliText, mode,
    cartesian, zip, expand, VAR_PATTERN,
  );

  return {
    update,
    tmpl,
    rows,
    previewBody,
    previewCount,
    cliText,
    cli: () => cliText.innerHTML.replace(/^<span class="dollar">\$<\/span>/, ''),
    iterations: () => (previewBody.innerHTML.match(/<div class="iteration">/g) ?? []).length,
  };
}

function expandedTexts(h: Harness): string[] {
  return [...h.previewBody.innerHTML.matchAll(/<div class="expanded-text">(.*?)<\/div>/gs)].map(m => m[1]);
}

test('update renders the empty state and a bare command when the template is blank', () => {
  const h = makeHarness();
  h.tmpl.value = '   \n';
  h.rows.push({ name: 'file', values: 'a.go' });
  h.update();
  assert.match(h.previewBody.innerHTML, /preview-empty/);
  assert.equal(h.previewCount.textContent, '0 results');
  assert.equal(h.previewCount.className, 'preview-count empty');
  assert.equal(h.cli(), 'promptargs');
});

test('update expands scalar values into a single unlabeled result', () => {
  const h = makeHarness();
  h.tmpl.value = 'Review {{file}} for {{focus=correctness}}';
  h.rows.push({ name: 'file', values: 'api.go' }, { name: 'focus', values: 'security' });
  h.update();
  assert.equal(h.previewCount.textContent, '1 result');
  assert.equal(h.previewCount.className, 'preview-count has-results');
  assert.equal(h.iterations(), 1);
  assert.ok(!h.previewBody.innerHTML.includes('iter-label'), 'single results carry no [i/n] label');
  assert.deepEqual(expandedTexts(h), ['Review api.go for security']);
  assert.equal(h.cli(), 'promptargs "Review {{file}} for {{focus=correctness}}" --file=api.go --focus=security');
});

test('update zips arrays 1:1 and labels each iteration', () => {
  const h = makeHarness('zip');
  h.tmpl.value = '{{file}}:{{focus}}';
  h.rows.push({ name: 'file', values: 'a.go,b.go' }, { name: 'focus', values: 'x,y' });
  h.update();
  assert.equal(h.previewCount.textContent, '2 results');
  assert.deepEqual(expandedTexts(h), ['a.go:x', 'b.go:y']);
  assert.match(h.previewBody.innerHTML, /<div class="iter-label">\[1\/2\] file=a\.go {2}focus=x<\/div>/);
  assert.match(h.previewBody.innerHTML, /<div class="iter-label">\[2\/2\] file=b\.go {2}focus=y<\/div>/);
  assert.equal(h.cli(), 'promptargs "{{file}}:{{focus}}" --file=a.go,b.go --focus=x,y');
});

test('update in cross mode renders every combination and appends --cross', () => {
  const h = makeHarness('cross');
  h.tmpl.value = '{{file}}:{{focus}}';
  h.rows.push({ name: 'file', values: 'a.go,b.go' }, { name: 'focus', values: 'x,y' });
  h.update();
  assert.equal(h.previewCount.textContent, '4 results');
  assert.deepEqual(expandedTexts(h), ['a.go:x', 'a.go:y', 'b.go:x', 'b.go:y']);
  assert.equal(h.cli(), 'promptargs "{{file}}:{{focus}}" --file=a.go,b.go --focus=x,y --cross');
});

test('update omits --cross when fewer than two arrays exist, matching CLI semantics', () => {
  const h = makeHarness('cross');
  h.tmpl.value = '{{file}} {{tone}}';
  h.rows.push({ name: 'file', values: 'a.go,b.go' }, { name: 'tone', values: 'terse' });
  h.update();
  assert.equal(h.previewCount.textContent, '2 results');
  assert.deepEqual(expandedTexts(h), ['a.go terse', 'b.go terse']);
  assert.ok(!h.cli().endsWith('--cross'), `--cross is redundant for one array: ${h.cli()}`);
});

test('update mixes scalar and array values and carries scalars into every iteration', () => {
  const h = makeHarness('zip');
  h.tmpl.value = '{{file}} ({{tone}})';
  h.rows.push({ name: 'tone', values: 'concise' }, { name: 'file', values: 'a.go,b.go,c.go' });
  h.update();
  assert.deepEqual(expandedTexts(h), ['a.go (concise)', 'b.go (concise)', 'c.go (concise)']);
  assert.match(h.previewBody.innerHTML, /\[3\/3\] tone=concise {2}file=c\.go/);
});

test('update treats @file sources as one opaque value and quotes glob sources', () => {
  const h = makeHarness();
  h.tmpl.value = 'Check {{file}} and {{src}}';
  h.rows.push(
    { name: 'file', values: 'list.txt', source: 'file' },
    { name: 'src', values: 'src/*.go', source: 'glob' },
  );
  h.update();
  // The browser cannot read list.txt or expand the glob, so the preview
  // shows one iteration with the raw markers...
  assert.equal(h.previewCount.textContent, '1 result');
  assert.deepEqual(expandedTexts(h), ['Check list.txt and src/*.go']);
  // ...while the command hands them to the CLI in the syntax `promptargs help` documents.
  assert.equal(h.cli(), 'promptargs "Check {{file}} and {{src}}" --file=@list.txt --src="src/*.go"');
});

test('update does not split a comma-containing @file value into an array', () => {
  const h = makeHarness('cross');
  h.tmpl.value = '{{file}}/{{focus}}';
  h.rows.push({ name: 'file', values: 'one,two', source: 'file' }, { name: 'focus', values: 'x,y' });
  h.update();
  assert.equal(h.previewCount.textContent, '2 results');
  assert.deepEqual(expandedTexts(h), ['one,two/x', 'one,two/y']);
  assert.ok(!h.cli().includes('--cross'), 'only one real array, so no --cross');
});

test('update skips rows with empty values in the command but still previews defaults', () => {
  const h = makeHarness();
  h.tmpl.value = 'Be {{tone=concise}} about {{file}}';
  h.rows.push({ name: 'tone', values: '' }, { name: 'file', values: 'a.go' });
  h.update();
  assert.deepEqual(expandedTexts(h), ['Be concise about a.go']);
  assert.equal(h.cli(), 'promptargs "Be {{tone=concise}} about {{file}}" --file=a.go');
});

test('update highlights variables that remain unfilled after expansion', () => {
  const h = makeHarness();
  h.tmpl.value = 'Fix {{issue}} in {{file}}';
  h.rows.push({ name: 'file', values: 'main.go' });
  h.update();
  assert.deepEqual(expandedTexts(h), ['Fix <span class="unfilled">{{issue}}</span> in main.go']);
});

test('update HTML-escapes template text, values, and labels before rendering', () => {
  const h = makeHarness('zip');
  h.tmpl.value = '<b>{{x}}</b> & {{y}}';
  h.rows.push({ name: 'x', values: '<img src=x onerror=alert(1)>,ok' }, { name: 'y', values: 'a,b' });
  h.update();
  const html = h.previewBody.innerHTML;
  assert.ok(!html.includes('<img'), 'raw value markup must not reach the preview');
  assert.ok(!html.includes('<b>'), 'raw template markup must not reach the preview');
  assert.match(html, /&lt;b&gt;&lt;img src=x onerror=alert\(1\)&gt;&lt;\/b&gt; &amp; a/);
  assert.match(html, /iter-label">\[1\/2\] x=&lt;img src=x onerror=alert\(1\)&gt; {2}y=a</);
  assert.match(h.cliText.innerHTML, /--x='&lt;img src=x onerror=alert\(1\)&gt;,ok'/);
});

test('update inlines the template in the command only when it is short and single-line', () => {
  const inline = makeHarness();
  inline.tmpl.value = 'Say "hi" to {{name}}';
  inline.rows.push({ name: 'name', values: 'World' });
  inline.update();
  assert.equal(inline.cli(), 'promptargs "Say \\"hi\\" to {{name}}" --name=World');

  const multiline = makeHarness();
  multiline.tmpl.value = 'Line one {{name}}\nLine two';
  multiline.rows.push({ name: 'name', values: 'World' });
  multiline.update();
  assert.equal(multiline.cli(), 'promptargs --name=World');
  assert.deepEqual(expandedTexts(multiline), ['Line one World\nLine two']);

  const long = makeHarness();
  long.tmpl.value = `${'x'.repeat(200)} {{name}}`;
  long.rows.push({ name: 'name', values: 'World' });
  long.update();
  assert.equal(long.cli(), 'promptargs --name=World');
});

test('update ignores rows without a name', () => {
  const h = makeHarness();
  h.tmpl.value = 'Hello {{name}}';
  h.rows.push({ name: '  ', values: 'orphan' }, { name: 'name', values: 'World' });
  h.update();
  assert.deepEqual(expandedTexts(h), ['Hello World']);
  assert.equal(h.cli(), 'promptargs "Hello {{name}}" --name=World');
});

// --- PRESETS -----------------------------------------------------------------

interface Preset {
  name: string;
  desc: string;
  template: string;
  vars: Record<string, string>;
  mode: 'zip' | 'cross';
}

function extractPresets(): Preset[] {
  const start = uiHtml.indexOf('const PRESETS = [');
  assert.notEqual(start, -1, 'PRESETS not found in ui.html');
  const end = uiHtml.indexOf('\n  ];', start);
  assert.notEqual(end, -1, 'PRESETS array is not terminated');
  const literal = uiHtml.slice(start + 'const PRESETS = '.length, end + '\n  ];'.length);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal}`)() as Preset[];
}

const presets = extractPresets();

test('every preset fills each template variable and uses a known iteration mode', () => {
  assert.ok(presets.length >= 8, `expected the shipped preset catalogue, got ${presets.length}`);
  const names = new Set<string>();
  for (const p of presets) {
    assert.ok(!names.has(p.name), `duplicate preset name ${p.name}`);
    names.add(p.name);
    assert.ok(['zip', 'cross'].includes(p.mode), `${p.name}: unknown mode ${p.mode}`);
    const templateVars = parseVars(p.template).map(v => v.name);
    assert.ok(templateVars.length > 0, `${p.name}: template declares no variables`);
    for (const v of templateVars) {
      assert.ok(v in p.vars, `${p.name}: template uses {{${v}}} but vars has no entry for it`);
      assert.ok(p.vars[v].length > 0, `${p.name}: vars.${v} is empty`);
    }
    for (const v of Object.keys(p.vars)) {
      assert.ok(templateVars.includes(v), `${p.name}: vars.${v} is not used by the template`);
    }
  }
});

test('every preset renders through update() with no unfilled variables', () => {
  for (const p of presets) {
    const h = makeHarness(p.mode);
    h.tmpl.value = p.template;
    for (const [name, values] of Object.entries(p.vars)) h.rows.push({ name, values });
    h.update();
    assert.ok(!h.previewBody.innerHTML.includes('class="unfilled"'), `${p.name}: preview left a variable unfilled`);
    const arrays = Object.values(p.vars).filter(v => v.includes(',')).map(v => v.split(',').length);
    const expected = arrays.length === 0
      ? 1
      : p.mode === 'cross'
        ? arrays.reduce((a, b) => a * b, 1)
        : Math.max(...arrays);
    assert.equal(h.iterations(), expected, `${p.name}: iteration count`);
    assert.ok(h.cli().startsWith('promptargs '), `${p.name}: command is built`);
  }
});

test('preset templates use only the documented {{var}} / {{var=default}} grammar', () => {
  for (const p of presets) {
    const braces = p.template.match(/\{\{[^}]*\}\}/g) ?? [];
    VAR_PATTERN.lastIndex = 0;
    const parsed = p.template.match(VAR_PATTERN) ?? [];
    assert.deepEqual(parsed, braces, `${p.name}: a {{...}} token does not match VAR_PATTERN`);
  }
});
