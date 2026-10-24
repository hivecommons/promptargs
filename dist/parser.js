/**
 * Parse {{variables}} and {{variables=defaults}} from template strings.
 * Uses Mustache for expansion, with a promptargs extension for defaults.
 */
import Mustache from 'mustache';
// Kept local (not imported from flags.ts) because ui.html loads parser.js in the browser,
// where only parser.js/iterate.js/mustache.mjs are served (see STATIC_JS_ROUTES in ui.ts).
function usageError(message) {
    const e = new Error(message);
    e.name = 'UsageError';
    return e;
}
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
// Ampersand tags ({{&name}}) are Mustache's unescaped-variable alias and are
// the same blank as {{name}}.
export const VAR_PATTERN = /\{\{\s*(?:&\s*)?([\w-]+)(?:=([^}]*?))?\s*\}\}/g;
// Dotted names ({{repo.owner}}) are Mustache context paths, which promptargs
// never fills; they would silently render empty, so they are rejected.
// The lookbehind skips triple-mustache tags; sigil tags ({{#x}}, {{!c}}) do
// not start with a name character and never match.
const DOTTED_PATTERN = /(?<!\{)\{\{\s*(?:&\s*)?([\w-]+\.[\w.-]*)\s*(?:=[^}]*)?\}\}/;
export function parseVars(template) {
    const vars = [];
    // The first offending tag aborts; the message is built from the name only
    // (restricted to [\w.-]) so raw template bytes never reach the terminal.
    const dotted = DOTTED_PATTERN.exec(template);
    if (dotted) {
        const name = dotted[1];
        throw usageError(`Unsupported variable name "${name}": dotted names are not supported; use {{${name.replace(/\./g, '_')}}}`);
    }
    for (const match of template.matchAll(VAR_PATTERN)) {
        const name = match[1];
        const existing = vars.find((v) => v.name === name);
        if (existing) {
            const dflt = match[2];
            if (dflt === undefined)
                continue;
            // First default wins; later occurrences may restate it (e.g. a code
            // fence using a different casing) without being an error.
            if (existing.defaultValue === undefined)
                existing.defaultValue = dflt;
            continue;
        }
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
    // The & sigil is kept so Mustache still sees an unescaped variable tag.
    const normalized = template.replace(VAR_PATTERN, (match, name) => /^\{\{\s*&/.test(match) ? `{{&${name}}}` : `{{${name}}}`);
    // Disable HTML escaping for this render only — we want raw text output.
    // Passed via the per-call config (4th arg) rather than assigning to the
    // module-level Mustache.escape, which would permanently disable escaping
    // for every other consumer of the shared `mustache` module in this process.
    return Mustache.render(normalized, view, undefined, { escape: (text) => text });
}
//# sourceMappingURL=parser.js.map