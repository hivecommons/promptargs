import test from 'node:test';
import assert from 'node:assert';
import { get } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { execSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildUIHtml, collectEnvVars, PAGE_HEADERS, requestCarriesToken, shouldSkipEnv, startUI, truncateValue, } from './ui.js';
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
test('collectEnvVars truncates the git diff preview to 60 chars but passes other git values through verbatim', () => {
    // The served page embeds autodetected git values; only `diff` is capped so a
    // large working-tree change does not bloat the HTML. Drive it from a scratch
    // repo with a diff well over the cap.
    const prevCwd = process.cwd();
    const repo = mkdtempSync(join(tmpdir(), 'promptargs-ui-env-'));
    try {
        process.chdir(repo);
        const run = (cmd) => execSync(cmd, { stdio: 'pipe', timeout: 10_000 });
        run('git init -q -b pa-ui-env-branch');
        run('git config user.email pa@test.local');
        run('git config user.name "PA Tester"');
        writeFileSync('tracked.txt', 'before\n');
        run('git add tracked.txt && git commit -q -m add');
        writeFileSync('tracked.txt', `${'x'.repeat(200)}\n`);
        const env = collectEnvVars();
        assert.equal(env.git['branch'], 'pa-ui-env-branch');
        assert.equal(env.git['user'], 'PA Tester');
        assert.match(env.git['diff'] ?? '', /^diff --git a\/tracked\.txt/);
        assert.equal(env.git['diff']?.length, 60 + '...'.length);
        assert.ok(env.git['diff']?.endsWith('...'));
    }
    finally {
        process.chdir(prevCwd);
        rmSync(repo, { recursive: true, force: true });
    }
});
test('collectEnvVars omits credential-looking names and credential-shaped values', () => {
    const keys = ['PROMPTARGS_TEST_SIGNING_KEY', 'PROMPTARGS_TEST_DB_URL', 'PROMPTARGS_TEST_PLAIN'];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    process.env['PROMPTARGS_TEST_SIGNING_KEY'] = 'sig';
    process.env['PROMPTARGS_TEST_DB_URL'] = 'postgres://app:hunter2@db.internal/app';
    process.env['PROMPTARGS_TEST_PLAIN'] = 'plain';
    try {
        const env = collectEnvVars();
        assert.equal(env.terminal['PROMPTARGS_TEST_SIGNING_KEY'], undefined);
        assert.equal(env.terminal['PROMPTARGS_TEST_DB_URL'], undefined);
        assert.equal(env.terminal['PROMPTARGS_TEST_PLAIN'], 'plain');
    }
    finally {
        for (const k of keys) {
            if (saved[k] === undefined)
                delete process.env[k];
            else
                process.env[k] = saved[k];
        }
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
test('buildUIHtml inserts env JSON literally when values contain replacement patterns', () => {
    const rawHtml = '<html><head><title>before</title><script></script><p>after</p></head></html>';
    const envVars = {
        git: { branch: "x$'y" },
        terminal: { PROMPTARGS_TEST: 'a$`b$&c$$d' },
    };
    const html = buildUIHtml(rawHtml, envVars);
    const start = html.indexOf('window.__PROMPTARGS_ENV__ = ') + 'window.__PROMPTARGS_ENV__ = '.length;
    const end = html.indexOf(';</script>', start);
    assert.deepStrictEqual(JSON.parse(html.slice(start, end)), envVars);
    assert.strictEqual((html.match(/<\/script>/g) ?? []).length, 2);
    assert.strictEqual((html.match(/<title>/g) ?? []).length, 1);
    assert.strictEqual((html.match(/<p>after<\/p>/g) ?? []).length, 1);
});
test('buildUIHtml injects env data before the module script in the real ui.html', () => {
    const realHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ui.html'), 'utf-8');
    const html = buildUIHtml(realHtml, { git: { branch: 'main' }, terminal: {} });
    const envIdx = html.indexOf('window.__PROMPTARGS_ENV__ =');
    const moduleIdx = html.indexOf('<script type="module">');
    assert.notEqual(envIdx, -1);
    assert.ok(moduleIdx > envIdx);
});
test('startUI binds a server that rejects non-local Host headers', async () => {
    const { server, port, page } = await launch();
    try {
        const allowed = await request(port, `127.0.0.1:${port}`, page);
        assert.equal(allowed.statusCode, 200);
        assert.match(allowed.body, /window\.__PROMPTARGS_ENV__/);
        // A valid token does not rescue a request with a foreign Host.
        const forbidden = await request(port, 'evil.example', page);
        assert.equal(forbidden.statusCode, 403);
        assert.equal(forbidden.body, 'Forbidden');
    }
    finally {
        await closeServer(server);
    }
});
test('startUI serves the env-bearing page only to a client presenting the per-run token', async () => {
    // Loopback is shared by every account on the host; the Host check alone
    // would let another local user read the embedded environment.
    const lines = [];
    const origError = console.error;
    console.error = (...args) => { lines.push(args.join(' ')); };
    const { server, port, token, page } = await launch();
    const host = `localhost:${port}`;
    try {
        assert.match(token, /^[0-9a-f]{32}$/);
        for (const path of ['/', '/?t=', `/?t=${token.slice(0, -1)}`, `/?t=${token}0`, `/?x=${token}`, '/index.html']) {
            const denied = await request(port, host, path);
            assert.equal(denied.statusCode, 403, path);
            assert.equal(denied.body, 'Forbidden', path);
            assert.doesNotMatch(denied.body, /__PROMPTARGS_ENV__/);
        }
        const allowed = await request(port, host, page);
        assert.equal(allowed.statusCode, 200);
        assert.match(allowed.body, /window\.__PROMPTARGS_ENV__/);
        // Public module code the page imports needs no token.
        assert.equal((await request(port, host, '/parser.js')).statusCode, 200);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /rejected request without the access token/);
        assert.doesNotMatch(lines[0], new RegExp(token));
        await closeServer(server);
        assert.equal(lines.length, 2);
        assert.match(lines[1], /rejected 6 requests without the access token/);
    }
    finally {
        console.error = origError;
        if (server.listening)
            await closeServer(server);
    }
});
test('startUI serves the env-bearing page with no-store, no-referrer and nosniff headers', async () => {
    // The page embeds environment data behind a tokened URL: without these the
    // browser may keep a copy in its disk cache after the server has exited,
    // and would send the tokened URL as the Referer on the page's outbound links.
    const { server, port, page } = await launch();
    try {
        const allowed = await request(port, `localhost:${port}`, page);
        assert.equal(allowed.statusCode, 200);
        assert.equal(allowed.headers['cache-control'], 'no-store');
        assert.equal(allowed.headers['referrer-policy'], 'no-referrer');
        assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
        assert.equal(allowed.contentType, 'text/html; charset=utf-8');
        for (const [name, value] of Object.entries(PAGE_HEADERS)) {
            assert.equal(allowed.headers[name.toLowerCase()], value, name);
        }
    }
    finally {
        await closeServer(server);
    }
});
test('requestCarriesToken compares the t query parameter exactly', () => {
    const token = 'ab'.repeat(16);
    assert.equal(requestCarriesToken(`/?t=${token}`, token), true);
    assert.equal(requestCarriesToken(`/anything?x=1&t=${token}`, token), true);
    assert.equal(requestCarriesToken(`/?t=${token.toUpperCase()}`, token), false);
    assert.equal(requestCarriesToken(`/?t=${token.slice(1)}`, token), false);
    assert.equal(requestCarriesToken('/?t=', token), false);
    assert.equal(requestCarriesToken('/', token), false);
    assert.equal(requestCarriesToken(undefined, token), false);
    assert.equal(requestCarriesToken('http://[::1', token), false);
});
test('startUI logs a rejected Host once on stderr without echoing it, and totals on close', async () => {
    const lines = [];
    const origError = console.error;
    console.error = (...args) => { lines.push(args.join(' ')); };
    const server = startUI(0, { openBrowser: false });
    try {
        await onceListening(server);
        const { port } = server.address();
        for (let i = 0; i < 3; i++) {
            assert.equal((await request(port, 'evil.example')).statusCode, 403);
        }
        assert.equal(lines.length, 1);
        assert.match(lines[0], /rejected request with unexpected Host header/);
        assert.doesNotMatch(lines[0], /evil\.example/);
        await closeServer(server);
        assert.equal(lines.length, 2);
        assert.match(lines[1], /rejected 3 requests/);
    }
    finally {
        console.error = origError;
        if (server.listening)
            await closeServer(server);
    }
});
test('startUI emits one ui_request JSON line per request when PROMPTARGS_LOG=json', async () => {
    const lines = [];
    const origError = console.error;
    const origLog = process.env.PROMPTARGS_LOG;
    console.error = (...args) => { lines.push(args.join(' ')); };
    process.env.PROMPTARGS_LOG = 'json';
    const { server, port, token, page } = await launch();
    try {
        assert.equal((await request(port, `127.0.0.1:${port}`, page)).statusCode, 200);
        assert.equal((await request(port, 'evil.example')).statusCode, 403);
        assert.equal((await request(port, `127.0.0.1:${port}`)).statusCode, 403);
        await closeServer(server);
        const events = lines.map(l => JSON.parse(l));
        const requests = events.filter(e => e.event === 'ui_request');
        assert.deepStrictEqual(requests.map(e => e.status), [200, 403, 403]);
        for (const e of requests) {
            assert.deepStrictEqual(Object.keys(e), ['event', 'status', 'duration_ms']);
            assert.ok(e.duration_ms >= 0);
        }
        assert.ok(events.some(e => e.event === 'ui_host_rejected' && e.status === 403));
        assert.ok(events.some(e => e.event === 'ui_token_rejected' && e.status === 403));
        // Never echo the attacker-controlled Host header, even in JSON mode.
        assert.ok(!lines.some(l => l.includes('evil.example')));
        assert.ok(!lines.some(l => l.includes(token)));
    }
    finally {
        console.error = origError;
        if (origLog === undefined)
            delete process.env.PROMPTARGS_LOG;
        else
            process.env.PROMPTARGS_LOG = origLog;
        if (server.listening)
            await closeServer(server);
    }
});
test('startUI serves the parser/iterate/mustache modules the browser imports', async () => {
    const { server, port, token } = await launch();
    try {
        const parser = await request(port, `127.0.0.1:${port}`, '/parser.js');
        assert.equal(parser.statusCode, 200);
        assert.match(parser.contentType ?? '', /text\/javascript/);
        assert.match(parser.body, /export function parseVars/);
        assert.match(parser.body, /export const VAR_PATTERN/);
        const iterate = await request(port, `127.0.0.1:${port}`, '/iterate.js');
        assert.equal(iterate.statusCode, 200);
        assert.match(iterate.body, /export function cartesian/);
        assert.match(iterate.body, /export function zip/);
        const mustache = await request(port, `127.0.0.1:${port}`, '/mustache.mjs');
        assert.equal(mustache.statusCode, 200);
        assert.match(mustache.body, /export default mustache/);
        const missing = await request(port, `127.0.0.1:${port}`, '/does-not-exist.js');
        assert.equal(missing.statusCode, 403);
        const missingWithToken = await request(port, `127.0.0.1:${port}`, `/does-not-exist.js?t=${token}`);
        assert.equal(missingWithToken.statusCode, 200);
        assert.match(missingWithToken.body, /window\.__PROMPTARGS_ENV__/);
    }
    finally {
        await closeServer(server);
    }
});
test('startUI with port 0 accepts every loopback Host carrying the actual bound port', async () => {
    const { server, port, page } = await launch();
    try {
        assert.notEqual(port, 0);
        for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
            assert.equal((await request(port, host, page)).statusCode, 200, host);
        }
        assert.equal((await request(port, 'localhost:0', page)).statusCode, 403);
    }
    finally {
        await closeServer(server);
    }
});
test('startUI answers 404 for a static route whose backing file is missing', () => {
    // Copy the compiled ui.js (plus its local deps) into a directory
    // without parser.js/iterate.js/mustache.mjs, so requesting a known static
    // route hits the readFileSync catch branch.
    const __dirnameUi = dirname(fileURLToPath(import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-ui-static-'));
    try {
        for (const f of ['ui.js', 'ui.html', 'autodetect.js', 'log.js']) {
            copyFileSync(join(__dirnameUi, f), join(dir, f));
        }
        writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
        // Intentionally omit parser.js/iterate.js/mustache.mjs so the route 404s.
        const script = `
      import { get } from 'node:http';
      import(${JSON.stringify(pathToFileURL(join(dir, 'ui.js')).href)})
        .then(m => {
          const server = m.startUI(0, { openBrowser: false });
          server.once('listening', () => {
            const { port } = server.address();
            get({
              hostname: '127.0.0.1', port, path: '/parser.js',
              headers: { Host: '127.0.0.1:' + port },
            }, res => {
              process.stdout.write('STATUS:' + res.statusCode);
              server.close(() => process.exit(0));
            });
          });
        });
    `;
        const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf-8',
            timeout: 15000,
        });
        assert.match(res.stdout, /STATUS:404/, res.stderr);
        assert.match(res.stderr, /failed to load static asset \/parser\.js \(ENOENT\)/);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
function onceListening(server) {
    if (server.listening)
        return Promise.resolve();
    return new Promise(resolve => server.once('listening', resolve));
}
// Starts the UI on an ephemeral port and recovers the per-run access token
// from the URL it prints, the same way a user would.
async function launch() {
    const origLog = console.log;
    let out = '';
    console.log = (...args) => { out += args.join(' ') + '\n'; };
    const server = startUI(0, { openBrowser: false });
    try {
        await onceListening(server);
    }
    finally {
        console.log = origLog;
    }
    const { port } = server.address();
    const token = out.match(new RegExp(`running at http://localhost:${port}/\\?t=([0-9a-f]+)`))?.[1];
    assert.ok(token, `no access token in startup output: ${out}`);
    return { server, port, token, page: `/?t=${token}` };
}
function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}
function request(port, host, path = '/') {
    return new Promise((resolve, reject) => {
        const req = get({
            hostname: '127.0.0.1',
            port,
            path,
            headers: { Host: host },
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({
                statusCode: res.statusCode ?? 0,
                body,
                contentType: res.headers['content-type'],
                headers: res.headers,
            }));
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
        copyFileSync(join(__dirname, 'log.js'), join(dir, 'log.js'));
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
test('startUI schedules a browser open by default', () => {
    // openBrowser defaults to true; run in a child with an empty PATH so the
    // platform open command is a harmless shell failure, never a real browser.
    const script = `
    import(${JSON.stringify(pathToFileURL(join(__dirname, 'ui.js')).href)})
      .then(m => {
        const server = m.startUI(0);
        setTimeout(() => server.close(() => process.exit(0)), 900);
      });
  `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, PATH: '' },
    });
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /promptargs builder running at http:\/\/localhost:\d+/);
});
test('browser open picks the right command for each platform', { skip: process.platform === 'win32' && 'shell-script shims do not run on Windows' }, () => {
    // The darwin/win32 arms of the open-command ternary never run on Linux CI;
    // force each platform value in a child and put recording shims for every
    // candidate opener first on PATH so the test can assert which one ran and
    // with what URL, rather than only that startUI survived a missing opener.
    const expected = { darwin: 'open', win32: 'start', linux: 'xdg-open' };
    const shimDir = mkdtempSync(join(tmpdir(), 'promptargs-open-shim-'));
    const logFile = join(shimDir, 'invocations.log');
    try {
        for (const cmd of Object.values(expected)) {
            const shim = join(shimDir, cmd);
            writeFileSync(shim, `#!/bin/sh\nprintf '%s %s\\n' ${JSON.stringify(cmd)} "$1" >> ${JSON.stringify(logFile)}\n`);
            chmodSync(shim, 0o755);
        }
        // With platform forced to win32, exec() runs `cmd.exe /d /s /c "<command>"`
        // instead of /bin/sh -c, so the `start` shim is never reached directly; a
        // cmd.exe shim logs the quoted command it was handed instead.
        const cmdExe = join(shimDir, 'cmd.exe');
        writeFileSync(cmdExe, `#!/bin/sh\nc=$4; c=\${c#\\"}; c=\${c%\\"}; printf '%s\\n' "$c" >> ${JSON.stringify(logFile)}\n`);
        chmodSync(cmdExe, 0o755);
        for (const [platform, cmd] of Object.entries(expected)) {
            writeFileSync(logFile, '');
            const script = `
        Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
        import(${JSON.stringify(pathToFileURL(join(__dirname, 'ui.js')).href)})
          .then(m => {
            const server = m.startUI(0);
            setTimeout(() => server.close(() => process.exit(0)), 900);
          });
      `;
            const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
                encoding: 'utf-8',
                timeout: 15000,
                env: { ...process.env, PATH: shimDir },
            });
            assert.strictEqual(res.status, 0, `platform ${platform}: ${res.stderr}`);
            const [, port, token] = res.stdout.match(/promptargs builder running at http:\/\/localhost:(\d+)\/\?t=([0-9a-f]{32})/) ?? [];
            assert.ok(port && token, `platform ${platform}: no bound port and token in stdout: ${res.stdout}`);
            const url = `http://localhost:${port}/?t=${token}`;
            // collectEnvVars' git/gh probes go through the same shell; keep only opener calls.
            const openers = new Set(Object.values(expected));
            const invocations = readFileSync(logFile, 'utf-8').trim().split('\n')
                .filter(line => openers.has(line.split(' ')[0]));
            // POSIX shims see the URL as one unquoted argv word; the cmd.exe shim
            // records the whole `start "" "<url>"` command line it was handed.
            const expectedInvocation = platform === 'win32' ? `start "" "${url}"` : `${cmd} ${url}`;
            assert.deepStrictEqual(invocations, [expectedInvocation], `platform ${platform} should open the browser with ${cmd} exactly once`);
        }
    }
    finally {
        rmSync(shimDir, { recursive: true, force: true });
    }
});
test('missing opener logs a hint', { skip: process.platform === 'win32' && 'POSIX shell lookup semantics' }, () => {
    const script = `
    import(${JSON.stringify(pathToFileURL(join(__dirname, 'ui.js')).href)})
      .then(m => {
        const server = m.startUI(0);
        setTimeout(() => server.close(() => process.exit(0)), 900);
      });
  `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, PATH: '/nonexistent' },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const port = res.stdout.match(/promptargs builder running at http:\/\/localhost:(\d+)/)?.[1];
    assert.ok(port, `no bound port in stdout: ${res.stdout}`);
    assert.match(res.stderr, new RegExp(`promptargs: could not open a browser \\(.+\\); open http://localhost:${port}/\\?t=[0-9a-f]{32} manually`));
});
test('startUI rethrows non-EADDRINUSE server errors', async (t) => {
    // Only run where binding port 1 really fails with EACCES; containers with
    // ip_unprivileged_port_start=0 (or root) can bind it and would hang instead.
    const probeErr = await new Promise(resolve => {
        const probe = createNetServer();
        probe.once('error', err => resolve(err));
        probe.listen(1, '127.0.0.1', () => probe.close(() => resolve(null)));
    });
    if (probeErr?.code !== 'EACCES') {
        t.skip('binding port 1 did not fail with EACCES');
        return;
    }
    const res = runStartUI(join(__dirname, 'ui.js'), 1);
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /EACCES/);
    assert.doesNotMatch(res.stderr, /is in use/);
});
//# sourceMappingURL=ui.test.js.map