/**
 * Opt-in structured diagnostics. With PROMPTARGS_LOG=json, diagnostics are
 * written to stderr as one JSON object per line with a fixed, bounded field
 * set. Template contents, argument values, paths and URLs are never logged.
 */

export type LogEvent =
  | 'ui_host_rejected'
  | 'ui_host_rejected_total'
  | 'ui_token_rejected'
  | 'ui_token_rejected_total'
  | 'ui_asset_error'
  | 'ui_request'
  | 'ui_start_error'
  | 'ui_browser_open_failed'
  | 'cli_iteration'
  | 'cli_error'
  | 'loader_dir_unreadable'
  | 'loader_dir_symlink';

export type ErrorClass = 'usage' | 'not_found' | 'io' | 'port_in_use' | 'unknown';

export interface LogFields {
  status?: number | string;
  duration_ms?: number;
  error_class?: ErrorClass;
  count?: number;
  current?: number;
  total?: number;
}

export function jsonLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROMPTARGS_LOG === 'json';
}

export function classifyError(err: unknown): ErrorClass {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'not_found';
  if (code === 'EADDRINUSE') return 'port_in_use';
  if (typeof code === 'string' && code.startsWith('E')) return 'io';
  if ((err as Error | undefined)?.name === 'UsageError') return 'usage';
  return 'unknown';
}

// Writes a JSON line when enabled; otherwise prints the legacy text fallback
// (when given) so default output stays byte-for-byte unchanged.
export function diag(event: LogEvent, fields: LogFields, legacy?: string): void {
  if (!jsonLogEnabled()) {
    if (legacy !== undefined) console.error(legacy);
    return;
  }
  const line: Record<string, unknown> = { event };
  for (const key of ['status', 'duration_ms', 'error_class', 'count', 'current', 'total'] as const) {
    if (fields[key] !== undefined) line[key] = fields[key];
  }
  console.error(JSON.stringify(line));
}

// Request logging has no legacy output, so it is silent unless enabled.
export function logRequest(status: number, startedAt: bigint): void {
  const duration_ms = Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000;
  diag('ui_request', { status, duration_ms });
}
