import test from 'node:test';
import assert from 'node:assert';
import { get } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildUIHtml, collectEnvVars, shouldSkipEnv, startUI, truncateValue, } from './ui.js';
test('shouldSkipEnv filters noisy shell and tooling variables', () => {
    assert.equal(shouldSkipEnv('HOME'), true);
    assert.equal(shouldSkipEnv('npm_config_cache'), true);
    assert.equal(shouldSkipEnv('VSCODE_PID'), true);
    assert.equal(shouldSkipEnv('PROMPTARGS_VISIBLE'), false);
});
test('truncateValue shortens long values and leaves short values unchanged', () => {
    assert.equal(truncateValue('short', 10), 'short');
    assert.equal(truncateValue('abcdefghijklmnopqrstuvwxyz', 8), 'abcdefgh...');
});
test('collectEnvVars includes terminal env values without skipped keys', () => {
    const savedVisible = process.env['PROMPTARGS_TEST_VISIBLE'];
    const savedHome = process.env['HOME'];
    process.env['PROMPTARGS_TEST_VISIBLE'] = 'visible-value';
    process.env['HOME'] = 'hidden-home';
    try {
        const env = collectEnvVars();
        assert.equal(env.terminal['PROMPTARGS_TEST_VISIBLE'], 'visible-value');
        assert.equal(env.terminal['HOME'], undefined);
    }
    finally {
        if (savedVisible === undefined)
            delete process.env['PROMPTARGS_TEST_VISIBLE'];
        else
            process.env['PROMPTARGS_TEST_VISIBLE'] = savedVisible;
        if (savedHome === undefined)
            delete process.env['HOME'];
        else
            process.env['HOME'] = savedHome;
    }
});
test('buildUIHtml escapes env JSON so values cannot escape the script tag', () => {
    const html = buildUIHtml('<html><head><script></script></head></html>', {
        git: {},
        terminal: { PROMPTARGS_TEST: '</script><script>alert(1)</script>' },
    });
    assert.match(html, /window\.__PROMPTARGS_ENV__/);
    assert.doesNotMatch(html, /<\/script><script>alert\(1\)<\/script>/);
    assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);
});
test('startUI binds a server that rejects non-local Host headers', async () => {
    const server = startUI(0, { openBrowser: false });
    await onceListening(server);
    const { port } = server.address();
    try {
        const allowed = await request(port, '127.0.0.1:0');
        assert.equal(allowed.statusCode, 200);
        assert.match(allowed.body, /window\.__PROMPTARGS_ENV__/);
        const forbidden = await request(port, 'evil.example');
        assert.equal(forbidden.statusCode, 403);
        assert.equal(forbidden.body, 'Forbidden');
    }
    finally {
        await closeServer(server);
    }
});
function onceListening(server) {
    if (server.listening)
        return Promise.resolve();
    return new Promise(resolve => server.once('listening', resolve));
}
function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}
function request(port, host) {
    return new Promise((resolve, reject) => {
        const req = get({
            hostname: '127.0.0.1',
            port,
            path: '/',
            headers: { Host: host },
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
    });
}
// startUI exits the process on fatal errors, so those branches are
// exercised in a child node process rather than in-process.
const __dirname = dirname(fileURLToPath(import.meta.url));
function runStartUI(uiModulePath, port) {
    const script = `
    import(${JSON.stringify(pathToFileURL(uiModulePath).href)})
      .then(m => m.startUI(${port}, { openBrowser: false }));
  `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf-8',
        timeout: 15000,
    });
    return { status: res.status, stderr: res.stderr };
}
test('startUI exits 1 with a port hint when the port is in use', async () => {
    const blocker = createNetServer();
    await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address();
    try {
        const res = runStartUI(join(__dirname, 'ui.js'), port);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, new RegExp(`Port ${port} is in use`));
        assert.match(res.stderr, new RegExp(`--port=${port + 1}`));
    }
    finally {
        await new Promise(resolve => blocker.close(resolve));
    }
});
test('startUI exits 1 with a reinstall hint when ui.html is missing', () => {
    // Copy the compiled module (and its one local dep) somewhere without
    // ui.html so the readFileSync catch branch runs.
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-ui-test-'));
    try {
        copyFileSync(join(__dirname, 'ui.js'), join(dir, 'ui.js'));
        copyFileSync(join(__dirname, 'autodetect.js'), join(dir, 'autodetect.js'));
        // Node 18 has no ESM syntax detection; mark the temp dir as ESM.
        writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
        const res = runStartUI(join(dir, 'ui.js'), 0);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /UI file not found\. Reinstall @hivecommons\/promptargs\./);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=ui.test.js.map