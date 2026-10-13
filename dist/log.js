/**
 * Opt-in structured diagnostics. With PROMPTARGS_LOG=json, diagnostics are
 * written to stderr as one JSON object per line with a fixed, bounded field
 * set. Template contents, argument values, paths and URLs are never logged.
 */
export function jsonLogEnabled(env = process.env) {
    return env.PROMPTARGS_LOG === 'json';
}
export function classifyError(err) {
    const code = err?.code;
    if (code === 'ENOENT')
        return 'not_found';
    if (code === 'EADDRINUSE')
        return 'port_in_use';
    if (typeof code === 'string' && code.startsWith('E'))
        return 'io';
    if (err?.name === 'UsageError')
        return 'usage';
    return 'unknown';
}
// Writes a JSON line when enabled; otherwise prints the legacy text fallback
// (when given) so default output stays byte-for-byte unchanged.
export function diag(event, fields, legacy) {
    if (!jsonLogEnabled()) {
        if (legacy !== undefined)
            console.error(legacy);
        return;
    }
    const line = { event };
    for (const key of ['status', 'duration_ms', 'error_class', 'count', 'current', 'total']) {
        if (fields[key] !== undefined)
            line[key] = fields[key];
    }
    console.error(JSON.stringify(line));
}
// Request logging has no legacy output, so it is silent unless enabled.
export function logRequest(status, startedAt) {
    const duration_ms = Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000;
    diag('ui_request', { status, duration_ms });
}
//# sourceMappingURL=log.js.map