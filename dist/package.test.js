import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
function npmPack(extraArgs) {
    // Under `npm test`, npm_execpath points at the running npm's CLI script, so
    // the check uses the same npm that would publish. Fall back to PATH when the
    // test file is run directly with `node --test`.
    const args = ['pack', '--json', '--ignore-scripts', ...extraArgs];
    const npmCli = process.env.npm_execpath;
    const res = npmCli
        ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 })
        : spawnSync('npm', args, { cwd: ROOT, encoding: 'utf-8', shell: process.platform === 'win32', timeout: 60_000 });
    assert.strictEqual(res.status, 0, `npm ${args.join(' ')} failed:\n${res.stderr}`);
    return JSON.parse(res.stdout);
}
function npmPackDryRun() {
    const report = npmPack(['--dry-run']);
    assert.strictEqual(report.length, 1, 'expected exactly one packed package');
    return report[0].files.map((f) => f.path).sort();
}
const packed = npmPackDryRun();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
test('tarball ships no compiled test files', () => {
    const leaked = packed.filter((p) => /\.test\.(js|js\.map|d\.ts)$/.test(p));
    assert.deepStrictEqual(leaked, [], `test files leaked into the tarball:\n${leaked.join('\n')}`);
});
test('tarball ships no test scratch output', () => {
    const scratch = packed.filter((p) => p.startsWith('.test-scratch/'));
    assert.deepStrictEqual(scratch, []);
});
test('tarball ships no test-only helper modules', () => {
    // src/ui-harness.ts is imported only by the ui-*.test.ts suites; it is not
    // named *.test.* so the glob above does not catch it (#158).
    const helpers = packed.filter((p) => p.startsWith('dist/ui-harness.'));
    assert.deepStrictEqual(helpers, [], `test helpers leaked into the tarball:\n${helpers.join('\n')}`);
});
test('tarball ships package.json, README and LICENSE', () => {
    for (const f of ['package.json', 'README.md', 'LICENSE']) {
        assert.ok(packed.includes(f), `${f} missing from tarball`);
    }
});
test('"main" and every "bin" target are in the tarball', () => {
    assert.ok(packed.includes(pkg.main), `main ${pkg.main} missing from tarball`);
    for (const [name, target] of Object.entries(pkg.bin)) {
        assert.ok(packed.includes(target), `bin "${name}" -> ${target} missing from tarball`);
    }
});
// Everything dist/cli.js reaches at runtime, directly or transitively, plus
// the two non-TypeScript assets `npm run build` copies into dist/ by hand
// (ui.html is read from disk by startUI; mustache.mjs is served to the
// browser through STATIC_JS_ROUTES).
const RUNTIME_FILES = [
    'dist/autodetect.js',
    'dist/cli.js',
    'dist/index.js',
    'dist/iterate.js',
    'dist/loader.js',
    'dist/mustache.mjs',
    'dist/parser.js',
    'dist/resolver.js',
    'dist/sanitize.js',
    'dist/status.js',
    'dist/ui.html',
    'dist/ui.js',
];
test('every runtime module and asset is in the tarball', () => {
    const missing = RUNTIME_FILES.filter((f) => !packed.includes(f));
    assert.deepStrictEqual(missing, [], `runtime files missing from tarball:\n${missing.join('\n')}`);
});
test('every shipped runtime module has its .d.ts alongside', () => {
    const jsModules = packed.filter((p) => p.startsWith('dist/') && p.endsWith('.js'));
    const missing = jsModules.filter((p) => !packed.includes(p.replace(/\.js$/, '.d.ts')));
    assert.deepStrictEqual(missing, [], `modules shipped without types:\n${missing.join('\n')}`);
});
test('static routes the UI serves to the browser are all in the tarball', () => {
    // Mirror STATIC_JS_ROUTES in src/ui.ts: if a route is added there without
    // the file reaching the tarball, the installed UI 404s on page load.
    const uiSource = readFileSync(join(__dirname, 'ui.js'), 'utf-8');
    const routeBlock = /STATIC_JS_ROUTES\s*=\s*\{([\s\S]*?)\};/.exec(uiSource);
    assert.ok(routeBlock, 'STATIC_JS_ROUTES not found in dist/ui.js');
    const targets = [...routeBlock[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(targets.length > 0, 'STATIC_JS_ROUTES has no entries');
    for (const t of targets) {
        assert.ok(packed.includes(`dist/${t}`), `UI static route target dist/${t} missing from tarball`);
    }
});
// The file list says what ships, not whether the shipped command runs. npm
// installs a bin by exec()ing the target file itself, so it needs the
// `#!/usr/bin/env node` line and the exec bit that git tracks on dist/cli.js.
// Every other suite spawns `node dist/cli.js`, which needs neither, so losing
// the shebang (or the 755 mode) would pass CI and break `npx promptargs` for
// every user. Pin both from the real tarball, not the source tree.
const NODE_SHEBANG = '#!/usr/bin/env node';
test('every bin target starts with the node shebang', () => {
    for (const [name, target] of Object.entries(pkg.bin)) {
        const firstLine = readFileSync(join(ROOT, target), 'utf-8').split('\n', 1)[0];
        assert.strictEqual(firstLine, NODE_SHEBANG, `bin "${name}" -> ${target} does not start with ${NODE_SHEBANG}`);
    }
});
test('packed bin runs when exec()ed directly, the way npm installs it', { skip: process.platform === 'win32' && 'shebangs do not apply on Windows' }, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'promptargs-tarball-'));
    try {
        const [report] = npmPack(['--pack-destination', scratch]);
        const tarball = join(scratch, report.filename);
        const untar = spawnSync('tar', ['-xzf', tarball, '-C', scratch], { encoding: 'utf-8', timeout: 10_000 });
        assert.strictEqual(untar.status, 0, `tar failed:\n${untar.stderr}`);
        const unpacked = join(scratch, 'package');
        // The tarball carries only the package; resolve its runtime dependency
        // (mustache) from the dev tree instead of reaching the registry.
        symlinkSync(join(ROOT, 'node_modules'), join(unpacked, 'node_modules'), 'dir');
        for (const [name, target] of Object.entries(pkg.bin)) {
            const bin = join(unpacked, target);
            assert.ok(statSync(bin).mode & 0o111, `bin "${name}" -> ${target} lost its exec bit in the tarball`);
            const res = spawnSync(bin, ['Hello {{name}}', '--name=World', '--no-interactive'], {
                cwd: scratch,
                encoding: 'utf-8',
                env: { ...process.env, HOME: scratch, USERPROFILE: scratch },
                timeout: 30_000,
            });
            assert.strictEqual(res.status, 0, `bin "${name}" exited ${res.status}:\n${res.stderr}`);
            assert.strictEqual(res.stdout.trim(), 'Hello World');
        }
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});
//# sourceMappingURL=package.test.js.map