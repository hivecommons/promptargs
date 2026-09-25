import test from 'node:test';
import assert from 'node:assert';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildUIHtml,
  collectEnvVars,
  shouldSkipEnv,
  startUI,
  truncateValue,
} from './ui.js';

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
  } finally {
    if (savedVisible === undefined) delete process.env['PROMPTARGS_TEST_VISIBLE'];
    else process.env['PROMPTARGS_TEST_VISIBLE'] = savedVisible;
    if (savedHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = savedHome;
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
  const { port } = server.address() as AddressInfo;

  try {
    const allowed = await request(port, '127.0.0.1:0');
    assert.equal(allowed.statusCode, 200);
    assert.match(allowed.body, /window\.__PROMPTARGS_ENV__/);

    const forbidden = await request(port, 'evil.example');
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.body, 'Forbidden');
  } finally {
    await closeServer(server);
  }
});

function onceListening(server: ReturnType<typeof startUI>): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise(resolve => server.once('listening', resolve));
}

function closeServer(server: ReturnType<typeof startUI>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
}

function request(port: number, host: string): Promise<{ statusCode: number; body: string }> {
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
