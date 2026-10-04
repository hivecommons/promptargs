/**
 * Status line rendering for Claude Code's status area.
 * Shows current template state: filled vars, unfilled vars, progress.
 */
import { sanitizeForTerminal } from './sanitize.js';
export function renderStatus(templateName, vars, values, iteration) {
    const parts = [];
    for (const v of vars) {
        const val = Object.hasOwn(values, v.name) ? values[v.name] : undefined;
        if (val !== undefined) {
            const source = v.defaultValue === val ? '(default)' : '';
            parts.push(`${v.name}=${val}${source}`);
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