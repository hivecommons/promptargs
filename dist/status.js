/**
 * Status line rendering for Claude Code's status area.
 * Shows current template state: filled vars, unfilled vars, progress.
 */
import { sanitizeForTerminal } from './sanitize.js';
import { truncateValue, PREVIEW_MAX_CHARS } from './truncate.js';
// Newlines become a visible marker (not a space) so a multi-line value such as
// {{diff}} stays on one line yet is still recognisably multi-line.
function previewValue(val) {
    const flat = val.replace(/\r\n|\r|\n/g, '⏎');
    return truncateValue(flat, PREVIEW_MAX_CHARS);
}
export function renderStatus(templateName, vars, values, iteration, defaulted) {
    const parts = [];
    for (const v of vars) {
        const val = Object.hasOwn(values, v.name) ? values[v.name] : undefined;
        if (val !== undefined) {
            const isDefault = defaulted ? defaulted.has(v.name) : v.defaultValue === val;
            const source = isDefault ? '(default)' : '';
            parts.push(`${v.name}=${previewValue(val)}${source}`);
        }
        else {
            parts.push(`${v.name}=___`);
        }
    }
    const allFilled = vars.every(v => Object.hasOwn(values, v.name));
    const icon = allFilled ? '✅' : '📋';
    const progress = iteration ? ` [${iteration.current}/${iteration.total}]` : '';
    // Values may come from repo-controlled sources (templates, git diff);
    // never let them inject escape sequences into the status line.
    return sanitizeForTerminal(`${icon} ${templateName}${progress}: ${parts.join('  ')}`);
}
//# sourceMappingURL=status.js.map