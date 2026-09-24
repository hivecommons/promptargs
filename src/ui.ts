import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autodetect, AUTODETECT_VARS } from './autodetect.js';

const DEFAULT_PORT = 3700;
const OPEN_DELAY_MS = 500;
const DIFF_PREVIEW_MAX_CHARS = 60;
const ENV_VAL_PREVIEW_MAX_CHARS = 80;

const SKIP_ENV_PREFIXES = [
  'npm_', 'LESS', 'LS_COLORS', 'LSCOLORS', 'TERM_', 'XPC_', 'SECURITYSESSION',
  'COMMAND_MODE', 'LaunchInstanceID', 'ITERM', '__CF', '__NEXT', 'VSCODE',
  'ELECTRON', 'CHROME', 'COLORTERM', 'SHLVL', 'LOGNAME', 'OLDPWD', '_',
];

const SKIP_ENV_EXACT = new Set([
  'HOME', 'PWD', 'SHELL', 'TERM', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'PAGER', 'MANPATH', 'INFOPATH', 'DISPLAY', 'SSH_AUTH_SOCK', 'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'Apple_PubSub_Socket_Render',
  'MallocNanoZone', 'ORIGINAL_XDG_CURRENT_DESKTOP', 'GIT_ASKPASS',
]);

function shouldSkipEnv(key: string): boolean {
  if (SKIP_ENV_EXACT.has(key)) return true;
  return SKIP_ENV_PREFIXES.some(p => key.startsWith(p));
}

function truncateValue(val: string, max: number): string {
  return val.length > max ? val.slice(0, max) + '...' : val;
}

interface EnvData {
  git: Record<string, string>;
  terminal: Record<string, string>;
}

function collectEnvVars(): EnvData {
  const git: Record<string, string> = {};
  for (const name of AUTODETECT_VARS) {
    const value = autodetect(name);
    if (value !== undefined) {
      git[name] = name === 'diff'
        ? truncateValue(value, DIFF_PREVIEW_MAX_CHARS)
        : value;
    }
  }

  const terminal: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (!val || shouldSkipEnv(key)) continue;
    terminal[key] = truncateValue(val, ENV_VAL_PREVIEW_MAX_CHARS);
  }

  return { git, terminal };
}

export function startUI(port = DEFAULT_PORT): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = join(__dirname, 'ui.html');
  let rawHtml: string;

  try {
    rawHtml = readFileSync(htmlPath, 'utf-8');
  } catch {
    console.error('UI file not found. Reinstall @hivecommons/promptargs.');
    process.exit(1);
  }

  const envVars = collectEnvVars();
  // Escape "<" so env values cannot break out of the script tag (e.g. "</script>").
  const envJson = JSON.stringify(envVars).replace(/</g, '\\u003c');
  const envScript = `<script>window.__PROMPTARGS_ENV__ = ${envJson};</script>`;
  const html = rawHtml.replace('<script>', envScript + '\n<script>');

  const ALLOWED_HOSTS = new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
  ]);

  const server = createServer((req, res) => {
    // Reject non-local Host headers to block DNS-rebinding reads of env data.
    if (!req.headers.host || !ALLOWED_HOSTS.has(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  // Bind loopback only: the page embeds environment variables and must never
  // be reachable from other machines on the network.
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`promptargs builder running at ${url}`);
    console.log('Press Ctrl+C to stop.\n');

    setTimeout(() => {
      import('node:child_process').then(({ exec }) => {
        const cmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`);
      });
    }, OPEN_DELAY_MS);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try: promptargs ui --port=${port + 1}`);
      process.exit(1);
    }
    throw err;
  });
}
