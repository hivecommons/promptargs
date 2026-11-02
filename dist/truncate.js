/**
 * Dependency-free value truncation shared by ui, commands and status.
 * Kept separate from ui.ts so importing it never pulls in the HTTP server.
 */
export const PREVIEW_MAX_CHARS = 60;
// Counts and slices by Unicode code point so a surrogate pair is never split.
export function truncateValue(val, max) {
    let count = 0;
    let end = 0;
    for (const ch of val) {
        if (count === max)
            return val.slice(0, end) + '...';
        end += ch.length;
        count++;
    }
    return val;
}
//# sourceMappingURL=truncate.js.map