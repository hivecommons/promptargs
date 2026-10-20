import { mkdirSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { parseVars, VAR_PATTERN } from './parser.js';
import { findTemplate, loadTemplates } from './loader.js';
import { autodetect, AUTODETECT_VARS } from './autodetect.js';
import { sanitizeForTerminal } from './sanitize.js';
import { diag } from './log.js';
import { UsageError, assertNoReservedVars, subcommandCollision } from './flags.js';
const EXAMPLE_REVIEW = `Review {{file}} for {{focus=correctness}} issues.
Be {{tone=concise}} in your feedback.
Focus on real bugs, not style nitpicks.
`;
const EXAMPLE_EXPLAIN = `Explain what {{file}} does in {{style=simple}} terms.
Assume the reader is a {{audience=junior developer}}.
`;
const EXAMPLE_FIX = `Fix the {{issue}} in {{file}}.
The expected behavior is: {{expected}}
The actual behavior is: {{actual}}
`;
export function doInit() {
    const dir = join(process.cwd(), '.prompts');
    // Same rule as the loader: the project .prompts entry must be a real
    // directory. lstat runs before existsSync, which follows links and would
    // report a dangling link as absent (then mkdirSync throws EEXIST).
    try {
        if (lstatSync(dir).isSymbolicLink()) {
            diag('loader_dir_symlink', { status: 'refused' }, sanitizeForTerminal(`promptargs: ${dir} is a symlink; the project .prompts directory must be a real directory`));
            process.exitCode = 1;
            return;
        }
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    if (existsSync(dir)) {
        console.log('.prompts/ already exists!');
        return;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'review.md'), EXAMPLE_REVIEW);
    writeFileSync(join(dir, 'explain.md'), EXAMPLE_EXPLAIN);
    writeFileSync(join(dir, 'fix.md'), EXAMPLE_FIX);
    console.log('Created .prompts/ with 3 example templates:');
    console.log('  review.md  — Code review with focus area');
    console.log('  explain.md — Explain code simply');
    console.log('  fix.md     — Bug fix template');
    console.log('');
    console.log('Try it: promptargs review --file=src/main.ts');
}
export function doList() {
    const templates = loadTemplates();
    if (templates.length === 0) {
        console.log('No templates found.');
        console.log('Run "promptargs init" to create example templates.');
        return;
    }
    console.log('Available templates:\n');
    for (const t of templates) {
        const source = t.source === 'user' ? ' (user)' : '';
        console.log(sanitizeForTerminal(`  ${t.name}${source}`));
        if (t.error) {
            console.log(sanitizeForTerminal(`    vars: (error: could not be read: ${t.error})`));
            console.log('');
            continue;
        }
        const collision = subcommandCollision(t.name);
        if (collision) {
            console.log(sanitizeForTerminal(`    ${collision}`));
            console.log('');
            continue;
        }
        try {
            const tplVars = parseVars(t.content);
            assertNoReservedVars(tplVars);
            const varNames = tplVars.map(v => {
                if (v.defaultValue !== undefined)
                    return `${v.name}=${v.defaultValue}`;
                return v.name;
            });
            if (varNames.length === 0) {
                console.log(sanitizeForTerminal(`    vars: (none)`));
            }
            else {
                console.log(sanitizeForTerminal(`    vars: {{${varNames.join('}}  {{')}}}`));
            }
        }
        catch (err) {
            console.log(sanitizeForTerminal(`    vars: (error: ${err instanceof Error ? err.message : String(err)})`));
        }
        console.log('');
    }
}
export function doShow(templateName) {
    if (!templateName) {
        throw new UsageError('Usage: promptargs show <template>');
    }
    const tpl = findTemplate(templateName);
    if (!tpl) {
        throw new UsageError(`Template "${templateName}" not found.`);
    }
    const collision = subcommandCollision(tpl.name);
    if (collision)
        console.error(sanitizeForTerminal(collision));
    // Defaults are merged across repeated blanks, so {{name}} … {{name=dflt}}
    // must colour every occurrence as "has default", not just the one that
    // carries it.
    const tplVars = parseVars(tpl.content);
    assertNoReservedVars(tplVars);
    const hasDefault = new Set(tplVars
        .filter((v) => v.defaultValue !== undefined)
        .map((v) => v.name));
    // Sanitize first: templates are repo-controlled and must not be able to
    // inject their own terminal escapes; only our highlighting below may.
    const highlighted = sanitizeForTerminal(tpl.content).replace(VAR_PATTERN, (raw, varName) => {
        // Colour the tag exactly as written so padded tags ({{ name }}) are
        // shown as the author typed them.
        if (hasDefault.has(varName)) {
            return `\x1b[33m${raw}\x1b[0m`;
        }
        return `\x1b[31m${raw}\x1b[0m`;
    });
    console.log(sanitizeForTerminal(`Template: ${tpl.name} (${tpl.path})`) + '\n');
    console.log(highlighted);
    console.log('\n\x1b[31mred\x1b[0m = required  \x1b[33myellow\x1b[0m = has default');
}
const DIFF_PREVIEW_MAX_CHARS = 60;
export function printEnv() {
    console.log('Auto-detected variables:\n');
    for (const name of AUTODETECT_VARS) {
        const value = autodetect(name);
        if (value !== undefined) {
            let display = value;
            if (name === 'diff' && display.length > DIFF_PREVIEW_MAX_CHARS) {
                display = display.slice(0, DIFF_PREVIEW_MAX_CHARS) + '...';
            }
            console.log(`  \x1b[32m{{${name}}}\x1b[0m = ${sanitizeForTerminal(display)}`);
        }
        else {
            console.log(`  \x1b[90m{{${name}}}\x1b[0m = (not detected)`);
        }
    }
    console.log('');
}
//# sourceMappingURL=commands.js.map