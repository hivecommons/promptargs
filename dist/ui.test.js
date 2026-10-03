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
test('startUI warns only once for repeated rejected Host headers', async (t) => {
    const stderr = t.mock.method(console, 'error', () => { });
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
        const repeated = await request(port, 'another-secret.example', '/private-url');
        assert.equal(repeated.statusCode, 403);
        assert.deepEqual(stderr.mock.calls.map(call => call.arguments), [[
                'promptargs: rejected request with unexpected Host header (further rejections suppressed)',
            ]]);
    }
    finally {
        await closeServer(server);
    }
});
test('startUI serves the parser/iterate/mustache modules the browser imports', async () => {
    const server = startUI(0, { openBrowser: false });
    await onceListening(server);
    const { port } = server.address();
    try {
        const parser = await request(port, '127.0.0.1:0', '/parser.js');
        assert.equal(parser.statusCode, 200);
        assert.match(parser.contentType ?? '', /text\/javascript/);
        assert.match(parser.body, /export function parseVars/);
        assert.match(parser.body, /export const VAR_PATTERN/);
        const iterate = await request(port, '127.0.0.1:0', '/iterate.js');
        assert.equal(iterate.statusCode, 200);
        assert.match(iterate.body, /export function cartesian/);
        assert.match(iterate.body, /export function zip/);
        const mustache = await request(port, '127.0.0.1:0', '/mustache.mjs');
        assert.equal(mustache.statusCode, 200);
        assert.match(mustache.body, /export default mustache/);
        const missing = await request(port, '127.0.0.1:0', '/does-not-exist.js');
        assert.equal(missing.statusCode, 200);
        assert.match(missing.body, /window\.__PROMPTARGS_ENV__/);
    }
    finally {
        await closeServer(server);
    }
});
test('startUI answers 404 for a static route whose backing file is missing', () => {
    // Copy the compiled ui.js (plus its one local dep) into a directory
    // without parser.js/iterate.js/mustache.mjs, so requesting a known static
    // route hits the readFileSync catch branch.
    const __dirnameUi = dirname(fileURLToPath(import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'promptargs-ui-static-'));
    try {
        for (const f of ['ui.js', 'ui.html', 'autodetect.js']) {
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
              headers: { Host: '127.0.0.1:0' },
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
        assert.equal(res.status, 0, res.stderr);
        assert.match(res.stdout, /STATUS:404/, res.stderr);
        assert.equal(res.stderr, 'promptargs: failed to load static asset /parser.js (ENOENT)\n');
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
test('browser open picks the right command for each platform', () => {
    // The darwin/win32 arms of the open-command ternary never run on Linux CI;
    // force each platform value in a child and let the command fail on PATH=''.
    for (const platform of ['darwin', 'win32', 'linux']) {
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
            env: { ...process.env, PATH: '' },
        });
        assert.strictEqual(res.status, 0, `platform ${platform}: ${res.stderr}`);
        assert.match(res.stdout, /promptargs builder running at http:\/\/localhost:\d+/);
    }
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
test('UI CLI prints a rejection total on SIGINT and SIGTERM, and stays quiet without rejections', () => {
    for (const [signal, count, exitCode] of [['SIGINT', 3, 130], ['SIGTERM', 2, 143], ['SIGINT', 0, 130]]) {
        const script = `
      import { get } from 'node:http';
      const log = console.log;
      console.log = (...args) => {
        log(...args);
        if (!String(args[0]).startsWith('promptargs builder running')) return;
        (async () => {
          for (let i = 0; i < ${count}; i++) {
            await new Promise((resolve, reject) => {
              get({ hostname: '127.0.0.1', port: serverPort, path: '/secret-url',
                headers: { Host: 'secret-host.example' } }, res => {
                if (res.statusCode !== 403) throw new Error('expected 403');
                res.resume();
                res.on('end', resolve);
              }).on('error', reject);
            });
          }
          process.kill(process.pid, ${JSON.stringify(signal)});
        })();
      };
      // Intercept listen only to discover the OS-assigned port without races.
      const http = await import('node:http');
      const listen = http.Server.prototype.listen;
      let serverPort;
      http.Server.prototype.listen = function (...args) {
        this.prependOnceListener('listening', () => { serverPort = this.address().port; });
        return listen.apply(this, args);
      };
      process.argv = [process.execPath, 'cli.js', 'ui', '--port=0'];
      await import(${JSON.stringify(pathToFileURL(join(__dirname, 'cli.js')).href)});
    `;
        const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf-8', timeout: 15000,
        });
        assert.equal(res.status, exitCode, res.stderr);
        assert.equal(res.stderr, count === 0 ? '' :
            'promptargs: rejected request with unexpected Host header (further rejections suppressed)\n' +
                `promptargs: rejected ${count} request(s) with unexpected Host header in total\n`);
    }
});
//# sourceMappingURL=ui.test.js.map