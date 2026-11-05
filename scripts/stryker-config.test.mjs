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
