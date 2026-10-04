/**
 * Parse {{variables}} and {{variables=defaults}} from template strings.
 * Uses Mustache for expansion, with a promptargs extension for defaults.
 */
import Mustache from 'mustache';
// Exported so any code that needs to recognize the same {{var}} / {{var=default}}
// grammar (e.g. CLI syntax highlighting) reuses this single definition instead
// of re-declaring the pattern and risking drift.
//
// Whitespace padding inside the delimiters ({{ name }}, {{ name=default }}) is
// accepted because Mustache accepts it: a padded tag that this pattern did not
// recognize would still be handed to Mustache as a variable, which renders it
// as an empty string — the blank silently vanished instead of being asked for,
// filled from --flags, highlighted by `show`, or preserved as {{name}}.
// Trailing padding after a default is not part of the default.
export const VAR_PATTERN = /\{\{\s*(\w+)(?:=([^}]*?))?\s*\}\}/g;
export function parseVars(template) {
    const seen = new Set();
    const vars = [];
    for (const match of template.matchAll(VAR_PATTERN)) {
        const name = match[1];
        if (seen.has(name))
            continue;
        seen.add(name);
        vars.push({
            name,
            defaultValue: match[2],
            raw: match[0],
        });
    }
    return vars;
}
export function expand(template, values) {
    const vars = parseVars(template);
    const view = Object.assign(Object.create(null), values);
    for (const v of vars) {
        if (!Object.hasOwn(view, v.name) && v.defaultValue !== undefined) {
            view[v.name] = v.defaultValue;
        }
        // Preserve unfilled vars as {{name}} in output
        if (!Object.hasOwn(view, v.name)) {
            view[v.name] = `{{${v.name}}}`;
        }
    }
    // Convert {{var=default}} to {{var}} so Mustache can handle it
    const normalized = template.replace(VAR_PATTERN, (_match, name) => `{{${name}}}`);
    // Disable HTML escaping for this render only — we want raw text output.
    // Passed via the per-call config (4th arg) rather than assigning to the
    // module-level Mustache.escape, which would permanently disable escaping
    // for every other consumer of the shared `mustache` module in this process.
    return Mustache.render(normalized, view, undefined, { escape: (text) => text });
}
//# sourceMappingURL=parser.js.map