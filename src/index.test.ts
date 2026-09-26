import { test } from 'node:test';
import assert from 'node:assert';

import * as api from './index.js';

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
    assert.strictEqual(
      typeof (api as Record<string, unknown>)[name],
      'function',
      `expected export "${name}" to be a function`,
    );
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
  assert.deepStrictEqual(
    vars.map((v: { name: string }) => v.name),
    ['name', 'focus'],
  );
  const out = api.expand('Hello {{name}}', { name: 'World' });
  assert.strictEqual(out, 'Hello World');
});
