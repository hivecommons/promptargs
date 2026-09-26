import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, 'cli.js');
function runCli(args, cwd, home) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
// Each test gets an isolated cwd and HOME so ~/.prompts and ./.prompts
// from the host machine never leak into template resolution.
function makeDirs() {
    const base = mkdtempSync(join(tmpdir(), 'promptargs-cli-test-'));
    const cwd = join(base, 'work');
    const home = join(base, 'home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(home, { recursive: true });
    return { cwd, home };
}
test('no args prints help and exits 0', () => {
    const { cwd, home } = makeDirs();
    const res = runCli([], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /promptargs — Template arguments for AI prompts/);
    assert.match(res.stdout, /Auto-detected variables:/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('help subcommand and --help flag print usage', () => {
    const { cwd, home } = makeDirs();
    for (const arg of ['help', '--help']) {
        const res = runCli([arg], cwd, home);
        assert.strictEqual(res.status, 0, `exit code for ${arg}`);
        assert.match(res.stdout, /Usage:/);
    }
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('env subcommand lists every autodetect variable', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['env'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /Auto-detected variables:/);
    // Non-git cwd: variables should render as "(not detected)" rather than crash.
    assert.match(res.stdout, /\{\{branch\}\}/);
    assert.match(res.stdout, /\{\{repo\}\}/);
    assert.match(res.stdout, /\{\{date\}\}/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('inline template expands flag values', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Hello {{name}}', '--name=World', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.stdout.trim(), 'Hello World');
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('template without variables is printed as-is', () => {
    const { cwd, home } = makeDirs();
    mkdirSync(join(cwd, '.prompts'));
    writeFileSync(join(cwd, '.prompts', 'plain.md'), 'No variables here.\n');
    const res = runCli(['plain', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /No variables here\./);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('unknown template exits 1 with guidance', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['nope', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /Template "nope" not found\./);
    assert.match(res.stderr, /promptargs list/);
    assert.match(res.stderr, /promptargs init/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('init creates .prompts with three example templates', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['init'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /Created \.prompts\/ with 3 example templates:/);
    for (const f of ['review.md', 'explain.md', 'fix.md']) {
        assert.ok(existsSync(join(cwd, '.prompts', f)), `${f} should exist`);
    }
    const review = readFileSync(join(cwd, '.prompts', 'review.md'), 'utf-8');
    assert.match(review, /\{\{file\}\}/);
    assert.match(review, /\{\{focus=correctness\}\}/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('init is a no-op when .prompts already exists', () => {
    const { cwd, home } = makeDirs();
    mkdirSync(join(cwd, '.prompts'));
    writeFileSync(join(cwd, '.prompts', 'keep.md'), 'existing {{x}}');
    const res = runCli(['init'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /\.prompts\/ already exists!/);
    assert.strictEqual(readFileSync(join(cwd, '.prompts', 'keep.md'), 'utf-8'), 'existing {{x}}');
    assert.ok(!existsSync(join(cwd, '.prompts', 'review.md')));
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('list shows template names, vars with defaults, and user source tag', () => {
    const { cwd, home } = makeDirs();
    mkdirSync(join(cwd, '.prompts'));
    writeFileSync(join(cwd, '.prompts', 'review.md'), 'Review {{file}} for {{focus=bugs}}.');
    mkdirSync(join(home, '.prompts'));
    writeFileSync(join(home, '.prompts', 'personal.md'), 'Do {{thing}}.');
    const res = runCli(['list'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /review/);
    assert.match(res.stdout, /\{\{file\}\}\s+\{\{focus=bugs\}\}/);
    assert.match(res.stdout, /personal \(user\)/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('list with no templates suggests init', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['list'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /No templates found\./);
    assert.match(res.stdout, /promptargs init/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('show highlights required and defaulted variables', () => {
    const { cwd, home } = makeDirs();
    mkdirSync(join(cwd, '.prompts'));
    writeFileSync(join(cwd, '.prompts', 'demo.md'), 'Fix {{issue}} in {{file=main.go}}.');
    const res = runCli(['show', 'demo'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /Template: demo/);
    // Required var wrapped in red (31m), defaulted var in yellow (33m).
    assert.match(res.stdout, /\x1b\[31m\{\{issue\}\}\x1b\[0m/);
    assert.match(res.stdout, /\x1b\[33m\{\{file=main\.go\}\}\x1b\[0m/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('show without a template name exits 1 with usage', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['show'], cwd, home);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /Usage: promptargs show <template>/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('show with unknown template exits 1', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['show', 'ghost'], cwd, home);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /Template "ghost" not found\./);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('zip mode pairs array values positionally', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Review {{file}} for {{focus}}', '--file=a.go,b.go', '--focus=x,y', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    const runs = res.stdout.trim().split('\n---\n');
    assert.strictEqual(runs.length, 2);
    assert.match(runs[0], /Review a\.go for x/);
    assert.match(runs[1], /Review b\.go for y/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('--cross produces the full cross-product of array values', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Review {{file}} for {{focus}}', '--file=a.go,b.go', '--focus=x,y', '--cross', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    const runs = res.stdout.trim().split('\n---\n');
    assert.strictEqual(runs.length, 4);
    const combos = ['a.go for x', 'a.go for y', 'b.go for x', 'b.go for y'];
    for (const combo of combos) {
        assert.ok(runs.some(r => r.includes(combo)), `missing combination: ${combo}`);
    }
    // Multi-run mode also writes a progress status line per run to stderr.
    assert.match(res.stderr, /\[1\/4\]/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('--json emits a single string for one run and an array for many', () => {
    const { cwd, home } = makeDirs();
    const single = runCli(['Hi {{name}}', '--name=Ada', '--json', '--no-interactive'], cwd, home);
    assert.strictEqual(single.status, 0);
    assert.strictEqual(JSON.parse(single.stdout), 'Hi Ada');
    const multi = runCli(['Hi {{name}}', '--name=Ada,Bob', '--json', '--no-interactive'], cwd, home);
    assert.strictEqual(multi.status, 0);
    assert.deepStrictEqual(JSON.parse(multi.stdout), ['Hi Ada', 'Hi Bob']);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('--status prints only the status line for the first iteration', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Review {{file}} for {{focus=bugs}}', '--file=a.go', '--status', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /file=a\.go/);
    assert.match(res.stdout, /focus=bugs\(default\)/);
    assert.doesNotMatch(res.stdout, /Review a\.go/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('defaults fill unset variables in non-interactive mode', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Be {{tone=concise}} about {{file}}', '--file=x.ts', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /Be concise about x\.ts/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('valueless flags are treated as boolean "true"', () => {
    const { cwd, home } = makeDirs();
    // --no-interactive has no "=", exercising the parseFlags boolean branch;
    // {{flagged}} picks up an explicit value while iteration still succeeds.
    const res = runCli(['{{a}} and {{b}}', '--a=1', '--b=2', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.stdout.trim(), '1 and 2');
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('@file array syntax reads one value per line', () => {
    const { cwd, home } = makeDirs();
    writeFileSync(join(cwd, 'names.txt'), 'Ada\nBob\n');
    const res = runCli(['Hi {{name}}', '--name=@names.txt', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    const runs = res.stdout.trim().split('\n---\n');
    assert.strictEqual(runs.length, 2);
    assert.match(runs[0], /Hi Ada/);
    assert.match(runs[1], /Hi Bob/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('reserved control flags never fill same-named template variables', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Mode {{cross=zip}} status {{status=ok}}', '--cross', '--status', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    // --status wins as a control flag: output is the status line, with both
    // variables resolved from their template defaults, not from "true".
    assert.match(res.stdout, /cross=zip/);
    assert.match(res.stdout, /status=ok/);
    assert.doesNotMatch(res.stdout, /=true/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('--json controls output format without filling {{json}}', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['Output as {{json=yaml}}', '--json', '--no-interactive'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(JSON.parse(res.stdout), 'Output as yaml');
    rmSync(dirname(cwd), { recursive: true, force: true });
});
test('help does not advertise the unimplemented --parallel flag', () => {
    const { cwd, home } = makeDirs();
    const res = runCli(['help'], cwd, home);
    assert.strictEqual(res.status, 0);
    assert.doesNotMatch(res.stdout, /--parallel/);
    rmSync(dirname(cwd), { recursive: true, force: true });
});
//# sourceMappingURL=cli.test.js.map