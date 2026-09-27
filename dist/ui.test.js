import test from 'node:test';
import assert from 'node:assert';
import { get } from 'node:http';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
test('startUI reports EADDRINUSE with guidance and exits 1', async (t) => {
    const server = startUI(0, { openBrowser: false });
    await onceListening(server);
    const exitError = new Error('exit-called');
    const exitCodes = [];
    t.mock.method(process, 'exit', ((code) => {
        exitCodes.push(code);
        throw exitError; // real process.exit never returns; without this the handler would fall through
    }));
    const errors = [];
    t.mock.method(console, 'error', (...args) => {
        errors.push(args.map(String).join(' '));
    });
    try {
        const err = Object.assign(new Error('bind failed'), { code: 'EADDRINUSE' });
        assert.throws(() => server.emit('error', err), /exit-called/);
        assert.deepStrictEqual(exitCodes, [1]);
        // The message names the requested port (0 here) and suggests the next one.
        assert.match(errors.join('\n'), /Port 0 is in use\. Try: promptargs ui --port=1/);
    }
    finally {
        await closeServer(server);
    }
});
test('startUI rethrows server errors that are not EADDRINUSE', async () => {
    const server = startUI(0, { openBrowser: false });
    await onceListening(server);
    try {
        const err = Object.assign(new Error('boom'), { code: 'EPERM' });
        assert.throws(() => server.emit('error', err), /boom/);
    }
    finally {
        await closeServer(server);
    }
});
test('startUI exits with reinstall guidance when ui.html is missing', async (t) => {
    // Copy the compiled modules (but not ui.html) so the readFileSync fails.
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-ui-missing-'));
    for (const entry of readdirSync(here)) {
        if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
            copyFileSync(join(here, entry), join(dir, entry));
        }
    }
    const exitError = new Error('exit-called');
    t.mock.method(process, 'exit', (() => {
        throw exitError;
    }));
    const errors = [];
    t.mock.method(console, 'error', (...args) => {
        errors.push(args.map(String).join(' '));
    });
    try {
        const mod = await import(pathToFileURL(join(dir, 'ui.js')).href);
        assert.throws(() => mod.startUI(0, { openBrowser: false }), /exit-called/);
        assert.match(errors.join('\n'), /UI file not found\. Reinstall @hivecommons\/promptargs\./);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=ui.test.js.map