/**
 * Auto-detect variable values from the current environment.
 */

import { execSync } from 'node:child_process';

function git(cmd: string): string | undefined {
  try {
    const out = execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // Success with empty output (detached HEAD for `branch --show-current`,
    // clean tree for `diff`) is "nothing detected", not an empty value —
    // otherwise it would override the template default and skip the prompt.
    return out || undefined;
  } catch {
    return undefined;
  }
}

const DETECTORS: Record<string, () => string | undefined> = {
  branch: () => git('branch --show-current'),
  repo: () => {
    const remote = git('remote get-url origin');
    if (!remote) return undefined;
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    return match?.[1];
  },
  org: () => {
    const remote = git('remote get-url origin');
    if (!remote) return undefined;
    const match = remote.match(/[/:]([\w.-]+)\/[\w.-]+?(?:\.git)?$/);
    return match?.[1];
  },
  diff: () => git('diff --staged') || git('diff'),
  pr: () => {
    try {
      const out = execSync('gh pr view --json number --jq .number', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  },
  user: () => git('config user.name'),
  date: () => new Date().toISOString().split('T')[0],
};

export const AUTODETECT_VARS = Object.keys(DETECTORS);

// Env var names that look like credentials. The implicit process.env fallback
// must never expand these into prompt output (templates are repo-controlled),
// and the builder UI must never embed them in the served page.
//
// Word-bounded alternatives use (^|_)…(_|$) so PATH, KEYBOARD, PWD (the shell
// cwd) and AUTHOR stay detectable while GITHUB_PAT, SIGNING_KEY, MYSQL_PWD and
// AUTH_HEADER do not.
const SENSITIVE_ENV_PATTERN = new RegExp(
  [
    'TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'PASSPHRASE', 'CREDENTIAL',
    'API_?KEY', 'ACCESS_KEY', 'PRIVATE_KEY', 'BEARER', 'COOKIE', 'WEBHOOK',
    'JWT', 'HMAC', 'OAUTH', 'CONN(?:ECTION)?_?STR(?:ING)?',
    '(?:^|_)AUTH(?:_|$)', '(?:^|_)KEYS?(?:_|$)', '_PWD(?:_|$)',
    '(?:^|_)PAT(?:_|$)', '(?:^|_)PASS(?:_|$)', '(?:^|_)DSN(?:_|$)',
  ].join('|'),
  'i',
);

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_PATTERN.test(name);
}

// Values that are credentials regardless of what the variable is called:
// a URL carrying a password in its userinfo (DATABASE_URL, REDIS_URL,
// MONGO_URI, SENTRY_DSN), PEM blocks, JWTs, and the fixed prefixes vendors
// stamp on their tokens so scanners can recognise them.
const SENSITIVE_ENV_VALUE_PATTERN = new RegExp(
  [
    '^[a-z][a-z0-9+.-]*://[^/\\s:@]*:[^/\\s@]+@',
    '-----BEGIN ',
    '^eyJ[\\w-]+\\.eyJ[\\w-]+\\.',
    '^(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}',
    '^glpat-[\\w-]{20,}',
    '^sk-[A-Za-z0-9_-]{20,}',
    '^sk_(?:live|test)_[A-Za-z0-9]{10,}',
    '^xox[abprs]-[\\w-]{10,}',
    '^AKIA[0-9A-Z]{16}$',
    '^AIza[\\w-]{35}$',
    '^npm_[A-Za-z0-9]{36}$',
    '^hvs\\.[\\w-]{20,}',
  ].join('|'),
  'i',
);

export function isSensitiveEnvValue(value: string): boolean {
  return SENSITIVE_ENV_VALUE_PATTERN.test(value);
}

export function autodetect(varName: string): string | undefined {
  // Own-property check: {{constructor}} / {{toString}} must not resolve to
  // Object.prototype members.
  if (Object.hasOwn(DETECTORS, varName)) return DETECTORS[varName]();
  // Fall back to terminal environment variables — but never implicitly expand
  // credential-looking names ({{GITHUB_TOKEN}} in a repo template must not
  // exfiltrate secrets into the generated prompt) or credential-shaped values
  // under innocuous names ({{DATABASE_URL}}). Explicit --flags still work.
  if (isSensitiveEnvName(varName) || !Object.hasOwn(process.env, varName)) return undefined;
  const value = process.env[varName];
  if (value === undefined || isSensitiveEnvValue(value)) return undefined;
  return value;
}

export function autodetectAll(varNames: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of varNames) {
    const value = autodetect(name);
    if (value !== undefined) result[name] = value;
  }
  return result;
}
