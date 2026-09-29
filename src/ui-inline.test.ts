import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from './resolver.js';
import type { TemplateVar } from './parser.js';

/**
 * Regression tests for ui.html's browser <script>.
 *
 * ui.html previously hand-reimplemented the {{var}} grammar, expansion, and
 * array-iteration logic from parser.ts/resolver.ts as plain functions, with
 * nothing type-checking that copy — it could silently drift from the CLI
 * (see issue #62). ui.html now imports parseVars/expand from './parser.js'
 * and cartesian/zip from './iterate.js' directly (the exact compiled modules
 * the CLI runs), served by ui.ts alongside the page. These tests assert that
 * wiring stays in place and only the browser-only helpers (splitValues,
 * esc, escHtml — which have no CLI counterpart) remain hand-written.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

/** Extract a `function name(...) { ... }` declaration via brace matching. */
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

function instantiate<T>(name: string): T {
  const src = extractFunction(name);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src};`)() as T;
}

const uiSplitValues = instantiate<(raw: string, source: string) => string[]>('splitValues');
const uiEsc = instantiate<(s: string) => string>('esc');
const uiEscHtml = instantiate<(s: string) => string>('escHtml');

test('ui.html imports the canonical grammar/iteration modules instead of reimplementing them', () => {
  assert.match(uiHtml, /import \{ parseVars, expand as \w+, VAR_PATTERN \} from '\.\/parser\.js';/);
  assert.match(uiHtml, /import \{ cartesian as \w+, zip as \w+ \} from '\.\/iterate\.js';/);
  // The functions that used to hand-duplicate parser/resolver logic must be
  // gone — their behavior now comes solely from the imported modules.
  for (const removed of ['parseVarsFromTemplate', 'function expand(', 'function cartesian(', 'function zip(']) {
    assert.ok(!uiHtml.includes(removed), `${removed} should no longer be defined in ui.html`);
  }
});

test('ui.html declares an import map resolving "mustache" for the browser', () => {
  assert.match(uiHtml, /<script type="importmap">/);
  assert.match(uiHtml, /"mustache":\s*"\.\/mustache\.mjs"/);
});

test('ui splitValues mirrors CLI comma-separated handling', () => {
  assert.deepEqual(uiSplitValues('a.go, b.go ,c.go', 'manual'), ['a.go', 'b.go', 'c.go']);
  assert.deepEqual(uiSplitValues('a,,b,', 'manual'), ['a', 'b']);
  assert.deepEqual(uiSplitValues('', 'manual'), []);
  // @file values are opaque single entries in the UI (server has no file access)
  assert.deepEqual(uiSplitValues('one,two', 'file'), ['one,two']);
});

test('ui esc/escHtml escape injection-relevant characters', () => {
  // esc feeds attribute values built with innerHTML
  assert.equal(uiEsc('a&b "c" <d>'), 'a&amp;b &quot;c&quot; &lt;d>');
  // escHtml feeds text content
  assert.equal(uiEscHtml('a&b <script>'), 'a&amp;b &lt;script&gt;');
});

// Sanity check that resolver's cartesian/zip iteration order (which the
// browser now imports verbatim via iterate.js) still matches what
// resolve() produces, keeping this parity documented even though the logic
// itself is no longer duplicated.
test('resolver cartesian/zip iteration order used by resolve()', async () => {
  const vars: TemplateVar[] = [
    { name: 'file', raw: '{{file}}' },
    { name: 'focus', raw: '{{focus}}' },
  ];
  const cross = await resolve(vars, { file: 'a.go,b.go,c.go', focus: 'security,perf' }, false, true);
  assert.deepEqual(
    cross.iterations.map(it => [it['file'], it['focus']]),
    [
      ['a.go', 'security'], ['a.go', 'perf'],
      ['b.go', 'security'], ['b.go', 'perf'],
      ['c.go', 'security'], ['c.go', 'perf'],
    ],
  );

  const zipped = await resolve(vars, { file: 'a.go,b.go,c.go', focus: 'security,perf' }, false, false);
  assert.deepEqual(
    zipped.iterations.map(it => [it['file'], it['focus']]),
    [['a.go', 'security'], ['b.go', 'perf'], ['c.go', 'security']],
  );
});
