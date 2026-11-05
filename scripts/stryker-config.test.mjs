import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// `npm run test:mutation` runs the suite inside a Stryker sandbox copy of the
// tree, and two things about that copy differ from a git checkout in ways the
// suite notices. Stryker rewrites every .js/.ts file it copies (prepending
// `// @ts-nocheck`), so a copied .test-scratch/ui-inline/ file no longer
// matches what ui-harness.test.ts expects to have written; and the rewrite
// creates files with default modes, so dist/cli.js loses the exec bit git
// tracks and package.test.ts finds the packed bin non-executable. Either one
// fails the initial dry run and Stryker aborts before testing a single mutant.
// Pin the sandbox settings that keep the suite green.

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('stryker.config.json', root), 'utf8'));

test('stryker never copies the test harness scratch files into the sandbox', () => {
  assert.ok(
    (config.ignorePatterns ?? []).includes('.test-scratch'),
    'ignorePatterns must list .test-scratch: Stryker rewrites copied .js files and the harness self-test then reads back altered content',
  );
});

test('stryker runs the suite without the coverage gate so only assertions kill mutants', () => {
  assert.match(config.commandRunner?.command ?? '', /npm test -- --no-coverage/);
});

// Stryker pins minimatch ~10.2.x and typed-rest-client 2.3.1 hard-pins
// qs 6.15.1; both carry published advisories whose fixes live in later
// majors/minors that neither `npm audit fix` nor Dependabot can reach, so
// package.json overrides them inside the Stryker subtree only. Pin the
// overrides and the resolved versions so a later grouped dependency bump
// cannot drop them without the suite noticing.
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

function atLeast(actual, minimum) {
  const a = actual.split('.').map(Number);
  const m = minimum.split('.').map(Number);
  for (let i = 0; i < m.length; i++) {
    if (a[i] !== m[i]) return a[i] > m[i];
  }
  return true;
}

test('stryker subtree overrides keep minimatch and qs on patched releases', () => {
  const stryker = pkg.overrides?.['@stryker-mutator/core'] ?? {};
  assert.equal(stryker.minimatch, '^11.0.1', 'override @stryker-mutator/core > minimatch to ^11.0.1 (GHSA-g3hv-75wg-m249)');
  assert.equal(stryker['typed-rest-client']?.qs, '^6.17.1', 'override @stryker-mutator/core > typed-rest-client > qs to ^6.17.1');
  assert.ok(atLeast(lock.packages['node_modules/minimatch'].version, '11.0.1'), 'lockfile must resolve minimatch >= 11.0.1');
  assert.ok(atLeast(lock.packages['node_modules/qs'].version, '6.17.1'), 'lockfile must resolve qs >= 6.17.1');
});
