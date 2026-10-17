/**
 * Opt-in structured diagnostics. With PROMPTARGS_LOG=json, diagnostics are
 * written to stderr as one JSON object per line with a fixed, bounded field
 * set. Template contents, argument values, paths and URLs are never logged.
 */
export type LogEvent = 'ui_host_rejected' | 'ui_host_rejected_total' | 'ui_asset_error' | 'ui_request' | 'ui_start_error' | 'ui_browser_open_failed' | 'cli_iteration' | 'cli_error';
export type ErrorClass = 'usage' | 'not_found' | 'io' | 'port_in_use' | 'unknown';
export interface LogFields {
    status?: number | string;
    duration_ms?: number;
    error_class?: ErrorClass;
    count?: number;
    current?: number;
    total?: number;
}
export declare function jsonLogEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function classifyError(err: unknown): ErrorClass;
export declare function diag(event: LogEvent, fields: LogFields, legacy?: string): void;
export declare function logRequest(status: number, startedAt: bigint): void;
