import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './index.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
// package.json "main" points at dist/index.js — this file is the public API
// surface consumers get from `import ... from '@hivecommons/promptargs'`.
// Pin every runtime export so a refactor of the barrel (or of a re-exported
// module) that drops or renames a symbol fails the suite instead of shipping
// a silent breaking change.
const EXPECTED_FUNCTION_EXPORTS = [
    'parseVars',
    'expand',
    'autodetect',
    'autodetectAll',
    'loadTemplates',
    'findTemplate',
    'resolve',
    'renderStatus',
].sort();
test('index exports exactly the documented runtime API', () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED_FUNCTION_EXPORTS, 'AUTODETECT_VARS'].sort();
    assert.deepStrictEqual(actual, expected);
});
test('every function export is callable', () => {
    for (const name of EXPECTED_FUNCTION_EXPORTS) {
        assert.strictEqual(typeof api[name], 'function', `expected export "${name}" to be a function`);
    }
});
test('AUTODETECT_VARS is a non-empty list of var names', () => {
    assert.ok(Array.isArray(api.AUTODETECT_VARS));
    assert.ok(api.AUTODETECT_VARS.length > 0);
    for (const v of api.AUTODETECT_VARS) {
        assert.strictEqual(typeof v, 'string');
        assert.ok(v.length > 0);
    }
});
test('entry-point exports are the same objects as their source modules', async () => {
    const parser = await import('./parser.js');
    const autodetectMod = await import('./autodetect.js');
    const loader = await import('./loader.js');
    const resolver = await import('./resolver.js');
    const status = await import('./status.js');
    assert.strictEqual(api.parseVars, parser.parseVars);
    assert.strictEqual(api.expand, parser.expand);
    assert.strictEqual(api.autodetect, autodetectMod.autodetect);
    assert.strictEqual(api.autodetectAll, autodetectMod.autodetectAll);
    assert.strictEqual(api.AUTODETECT_VARS, autodetectMod.AUTODETECT_VARS);
    assert.strictEqual(api.loadTemplates, loader.loadTemplates);
    assert.strictEqual(api.findTemplate, loader.findTemplate);
    assert.strictEqual(api.resolve, resolver.resolve);
    assert.strictEqual(api.renderStatus, status.renderStatus);
});
test('smoke: exported parseVars + expand round-trip through the entry point', () => {
    const vars = api.parseVars('Hello {{name}}, focus on {{focus}}');
    assert.deepStrictEqual(vars.map((v) => v.name), ['name', 'focus']);
    const out = api.expand('Hello {{name}}', { name: 'World' });
    assert.strictEqual(out, 'Hello World');
});
// README "Use as a Library" is the first thing library consumers copy. Its
// snippet shows concrete inputs and commented outputs, and a closing sentence
// enumerates the remaining exports. Pin both to the real entry point so an
// edit to either side — the docs or the API — fails here instead of shipping
// a README that lies.
function readmeLibrarySection() {
    const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf-8');
    const start = readme.indexOf('## Use as a Library');
    assert.notStrictEqual(start, -1, 'README lost its "Use as a Library" section');
    const rest = readme.slice(start + '## Use as a Library'.length);
    const next = rest.search(/\n## /);
    return next === -1 ? rest : rest.slice(0, next);
}
test('README library snippet: parseVars/expand produce the documented results', () => {
    const section = readmeLibrarySection();
    const template = 'Review {{file}} for {{focus=correctness}} issues.';
    assert.ok(section.includes(`const template = '${template}';`), 'README snippet template changed — update this test alongside the docs');
    const vars = api.parseVars(template);
    assert.deepStrictEqual(vars.map((v) => [v.name, v.defaultValue]), [['file', undefined], ['focus', 'correctness']]);
    assert.ok(section.includes("{ name: 'file', ..."));
    assert.ok(section.includes("{ name: 'focus', defaultValue: 'correctness', ..."));
    const explicit = 'Review src/app.ts for security issues.';
    assert.strictEqual(api.expand(template, { file: 'src/app.ts', focus: 'security' }), explicit);
    assert.ok(section.includes(`// '${explicit}'`));
    const defaulted = 'Review src/app.ts for correctness issues.';
    assert.strictEqual(api.expand(template, { file: 'src/app.ts' }), defaulted);
    assert.ok(section.includes(`// '${defaulted}'`));
});
test('README library section: unset variables without a default stay as {{name}}', () => {
    const section = readmeLibrarySection();
    assert.match(section, /no value and no default are left as `\{\{name\}\}`/);
    assert.strictEqual(api.expand('Hello {{name}}', {}), 'Hello {{name}}');
    assert.strictEqual(api.expand('Review {{file}} for {{focus=correctness}} issues.', {}), 'Review {{file}} for correctness issues.');
});
test('README library section names every export exactly once', () => {
    const section = readmeLibrarySection();
    const imported = /import \{ ([^}]+) \} from '@hivecommons\/promptargs';/.exec(section);
    assert.ok(imported, 'README snippet lost its import line');
    const others = /Other exports: ([^\n]+)\./.exec(section);
    assert.ok(others, 'README lost its "Other exports:" sentence');
    const importedNames = imported[1].split(',').map((n) => n.trim());
    const otherNames = [...others[1].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]);
    const documented = [...importedNames, ...otherNames];
    assert.deepStrictEqual([...new Set(documented)].length, documented.length, 'duplicate names in README');
    assert.deepStrictEqual(documented.sort(), Object.keys(api).sort());
});
//# sourceMappingURL=index.test.js.map