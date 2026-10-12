import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Branch protection on main requires the checks named below. Those names are
// produced by the `name:` expression on the build-and-test matrix job in
// ci.yml, so a change to the expression or the matrix axes can rename them —
// at which point the required checks never report and no PR can merge (#216
// hit exactly this when the os axis was added). Evaluate the expression the
// way the runner would for every matrix leg and pin the result here, so the
// rename fails `npm test` on the PR that introduces it instead of blocking
// every PR after it.

const REQUIRED_CHECKS = ['build-and-test (22)', 'build-and-test (24)', 'build-and-test (26)'];
const REQUIRED_OS = 'ubuntu-latest';

const root = new URL('../', import.meta.url);
const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

// The job block is everything between `  build-and-test:` and the next job
// (or end of file). Field lookups below are scoped to it so another job with
// the same keys cannot satisfy the assertions.
export function jobBlock(workflow, job) {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `ci.yml has no job named "${job}"`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

function field(block, key) {
  const match = block.match(new RegExp(`^ +${key}: (.+)$`, 'm'));
  assert.ok(match, `job has no "${key}:" field`);
  return match[1].trim();
}

// Parses a flow-style YAML list of scalars: `[ubuntu-latest, macos-latest]`.
export function flowList(value) {
  const match = value.match(/^\[(.*)\]$/);
  assert.ok(match, `expected a flow-style list, got ${value}`);
  return match[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
}

export function matrixAxes(block) {
  const matrix = block.split(/^ +matrix:\n/m)[1];
  assert.ok(matrix, 'job has no strategy.matrix');
  const axes = {};
  for (const line of matrix.split('\n')) {
    const match = line.match(/^ {8}([A-Za-z0-9_-]+): (\[.*\])$/);
    if (!match) break;
    axes[match[1]] = flowList(match[2]);
  }
  assert.ok(Object.keys(axes).length > 0, 'strategy.matrix declares no axes');
  return axes;
}

export function matrixLegs(axes) {
  return Object.entries(axes).reduce(
    (legs, [axis, values]) => legs.flatMap((leg) => values.map((value) => ({ ...leg, [axis]: value }))),
    [{}],
  );
}

// Evaluates the subset of the GitHub expression language that ci.yml's name
// uses: `matrix.<axis>` references, `==`/`!=` against a single-quoted
// literal, and the `cond && 'a' || 'b'` ternary idiom. Anything else is a
// test bug, not a silent pass.
export function evaluate(expr, leg) {
  const source = expr.trim();
  const ternary = source.match(/^(.+?) && '([^']*)' \|\| '([^']*)'$/);
  if (ternary) return evaluate(ternary[1], leg) ? ternary[2] : ternary[3];
  const compare = source.match(/^matrix\.([A-Za-z0-9_-]+) (==|!=) '([^']*)'$/);
  if (compare) {
    const equal = String(leg[compare[1]]) === compare[3];
    return compare[2] === '==' ? equal : !equal;
  }
  const ref = source.match(/^matrix\.([A-Za-z0-9_-]+)$/);
  if (ref) {
    assert.ok(ref[1] in leg, `expression references unknown matrix axis "${ref[1]}"`);
    return String(leg[ref[1]]);
  }
  assert.fail(`unsupported workflow expression: ${source}`);
}

export function render(template, leg) {
  return template.replaceAll(/\$\{\{(.*?)\}\}/g, (_, expr) => String(evaluate(expr, leg)));
}

const job = jobBlock(ci, 'build-and-test');
const axes = matrixAxes(job);
const legs = matrixLegs(axes);
const names = legs.map((leg) => ({ leg, name: render(field(job, 'name'), leg) }));

test('ci matrix: every leg of the build-and-test matrix gets a distinct check name', () => {
  const all = names.map(({ name }) => name);
  assert.equal(new Set(all).size, all.length, `duplicate check names: ${all.join(', ')}`);
  assert.doesNotMatch(all.join('\n'), /\$\{\{|matrix\./, 'name expression was not fully expanded');
});

test(`ci matrix: the ${REQUIRED_OS} legs keep the check names branch protection requires`, () => {
  const required = names.filter(({ leg }) => leg.os === REQUIRED_OS).map(({ name }) => name).sort();
  assert.deepEqual(required, [...REQUIRED_CHECKS].sort());
});

test('ci matrix: legs on other operating systems never shadow a required check name', () => {
  for (const { leg, name } of names) {
    if (leg.os === REQUIRED_OS) continue;
    assert.ok(!REQUIRED_CHECKS.includes(name), `${leg.os} leg reports as required check "${name}"`);
  }
});

test('ci matrix: the job runs on the matrix os, so each leg really is a different platform', () => {
  assert.equal(field(job, 'runs-on'), '${{ matrix.os }}');
});

test('ci matrix: the minimum supported Node major from package.json engines is a required leg', () => {
  const minimum = pkg.engines.node.match(/^>=\s*(\d+)/);
  assert.ok(minimum, `unexpected engines.node range: ${pkg.engines.node}`);
  assert.ok(REQUIRED_CHECKS.includes(`build-and-test (${minimum[1]})`));
  assert.ok(axes['node-version'].includes(minimum[1]));
});

// --- evaluator self-checks ----------------------------------------------------

test('ci matrix evaluator: cartesian product covers every axis combination', () => {
  assert.deepEqual(matrixLegs({ a: ['1', '2'], b: ['x'] }), [
    { a: '1', b: 'x' },
    { a: '2', b: 'x' },
  ]);
});

test('ci matrix evaluator: references, comparisons and the ternary idiom', () => {
  const leg = { os: 'macos-latest', 'node-version': '22' };
  assert.equal(render('build-and-test (${{ matrix.node-version }})', leg), 'build-and-test (22)');
  assert.equal(evaluate("matrix.os == 'macos-latest'", leg), true);
  assert.equal(evaluate("matrix.os != 'macos-latest'", leg), false);
  assert.equal(evaluate("matrix.os == 'ubuntu-latest' && ' linux' || ''", leg), '');
  assert.equal(evaluate("matrix.os != 'ubuntu-latest' && ' mac' || ''", leg), ' mac');
});

test('ci matrix evaluator: rejects unknown axes and unsupported syntax instead of guessing', () => {
  assert.throws(() => evaluate('matrix.arch', { os: 'x' }), /unknown matrix axis "arch"/);
  assert.throws(() => evaluate("startsWith(matrix.os, 'mac')", { os: 'x' }), /unsupported workflow expression/);
  assert.throws(() => flowList('ubuntu-latest'), /expected a flow-style list/);
  assert.throws(() => jobBlock(ci, 'no-such-job'), /no job named/);
  assert.throws(() => matrixAxes('  job:\n    runs-on: x\n'), /no strategy.matrix/);
});
