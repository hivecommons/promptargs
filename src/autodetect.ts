/**
 * Auto-detect variable values from the current environment.
 */

import { execSync } from 'node:child_process';

function git(cmd: string): string | undefined {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
const SENSITIVE_ENV_PATTERN =
  /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|ACCESS_KEY|PRIVATE_KEY|BEARER|COOKIE|(^|_)AUTH(_|$)/i;

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_PATTERN.test(name);
}

export function autodetect(varName: string): string | undefined {
  const detector = DETECTORS[varName];
  if (detector) return detector();
  // Fall back to terminal environment variables — but never implicitly expand
  // credential-looking names ({{GITHUB_TOKEN}} in a repo template must not
  // exfiltrate secrets into the generated prompt). Explicit --flags still work.
  if (isSensitiveEnvName(varName)) return undefined;
  return process.env[varName] ?? undefined;
}

export function autodetectAll(varNames: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of varNames) {
    const value = autodetect(name);
    if (value !== undefined) result[name] = value;
  }
  return result;
}
