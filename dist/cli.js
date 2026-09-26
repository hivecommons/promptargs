#!/usr/bin/env node
/**
 * promptargs CLI — Template arguments for AI prompts.
 *
 * Usage:
 *   promptargs <template>              # interactive mode
 *   promptargs <template> --var=value   # fill from flags
 *   promptargs list                     # show available templates
 *   promptargs init                     # create .prompts/ with examples
 *   promptargs show <template>          # show template with vars highlighted
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseVars, expand } from './parser.js';
import { findTemplate, loadTemplates } from './loader.js';
import { resolve } from './resolver.js';
import { renderStatus } from './status.js';
import { autodetect, AUTODETECT_VARS } from './autodetect.js';
import { startUI } from './ui.js';
const HELP = `
promptargs — Template arguments for AI prompts 🏴‍☠️

Usage:
  promptargs <template>                Run a template (interactive)
  promptargs <template> --var=value    Fill variables from flags
  promptargs list                      Show available templates
  promptargs init                      Create .prompts/ with examples
  promptargs show <template>           Preview a template
  promptargs env                       Show auto-detected variable values
  promptargs ui                        Open the builder UI in your browser
  promptargs help                      Show this help

Flags:
  --no-interactive    Skip interactive prompts (use defaults/auto only)
  --cross             Cross-product mode: all combinations of array values
  --json              Output as JSON instead of plain text
  --status            Print status line only (for IDE integration)

Reserved flag names (never fill template variables):
  no-interactive, cross, json, status

Array values:
  --file=a.go,b.go    Comma-separated → one run per value
  --file="src/*.go"   Glob → expands to matching files
  --file=@list.txt    File → one value per line

Iteration modes:
  Default (zip):      --file=a,b --focus=x,y  → 2 runs (a+x, b+y)
  Cross-product:      --file=a,b --focus=x,y --cross  → 4 runs (a+x, a+y, b+x, b+y)

Templates live in:
  .prompts/           Project-level (checked into repo)
  ~/.prompts/         User-level (personal templates)
`;
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
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
        console.log(HELP);
        printEnv();
        return;
    }
    if (args[0] === 'env') {
        printEnv();
        return;
    }
    if (args[0] === 'ui') {
        const flags = parseFlags(args.slice(1));
        const port = flags['port'] ? Number(flags['port']) : undefined;
        startUI(port);
        return;
    }
    if (args[0] === 'init') {
        return doInit();
    }
    if (args[0] === 'list') {
        return doList();
    }
    if (args[0] === 'show') {
        return doShow(args[1]);
    }
    // Run a template
    const templateName = args[0];
    const flags = parseFlags(args.slice(1));
    const interactive = !flags['no-interactive'];
    const cross = 'cross' in flags;
    const asJson = 'json' in flags;
    const statusOnly = 'status' in flags;
    // Check for inline template (quoted string with {{vars}})
    let content;
    let name;
    if (templateName.includes('{{')) {
        content = templateName;
        name = 'inline';
    }
    else {
        const tpl = findTemplate(templateName);
        if (!tpl) {
            console.error(`Template "${templateName}" not found.`);
            console.error('Run "promptargs list" to see available templates.');
            console.error('Run "promptargs init" to create example templates.');
            process.exit(1);
            return;
        }
        content = tpl.content;
        name = tpl.name;
    }
    const vars = parseVars(content);
    if (vars.length === 0) {
        // No variables — just output the template as-is
        console.log(content);
        return;
    }
    const { iterations } = await resolve(vars, varFlags(flags), interactive, cross);
    if (statusOnly) {
        const status = renderStatus(name, vars, iterations[0]);
        console.log(status);
        return;
    }
    const results = [];
    for (let i = 0; i < iterations.length; i++) {
        const values = iterations[i];
        const expanded = expand(content, values);
        if (iterations.length > 1) {
            const status = renderStatus(name, vars, values, {
                current: i + 1,
                total: iterations.length,
            });
            console.error(status);
        }
        results.push(expanded);
    }
    if (asJson) {
        console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    }
    else {
        console.log(results.join('\n---\n'));
    }
}
// Control flags that steer the CLI itself; they must never be treated as
// template variable values (e.g. --json filling {{json}} with "true").
const RESERVED_FLAGS = new Set(['no-interactive', 'cross', 'json', 'status']);
function varFlags(flags) {
    const out = {};
    for (const [key, value] of Object.entries(flags)) {
        if (!RESERVED_FLAGS.has(key))
            out[key] = value;
    }
    return out;
}
function parseFlags(args) {
    const flags = {};
    for (const arg of args) {
        if (arg.startsWith('--')) {
            const eq = arg.indexOf('=');
            if (eq > 0) {
                flags[arg.slice(2, eq)] = arg.slice(eq + 1);
            }
            else {
                flags[arg.slice(2)] = 'true';
            }
        }
    }
    return flags;
}
function doInit() {
    const dir = join(process.cwd(), '.prompts');
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
function doList() {
    const templates = loadTemplates();
    if (templates.length === 0) {
        console.log('No templates found.');
        console.log('Run "promptargs init" to create example templates.');
        return;
    }
    console.log('Available templates:\n');
    for (const t of templates) {
        const vars = parseVars(t.content);
        const varNames = vars.map(v => {
            if (v.defaultValue !== undefined)
                return `${v.name}=${v.defaultValue}`;
            return v.name;
        });
        const source = t.source === 'user' ? ' (user)' : '';
        console.log(`  ${t.name}${source}`);
        console.log(`    vars: {{${varNames.join('}}  {{')}}}`);
        console.log('');
    }
}
function doShow(templateName) {
    if (!templateName) {
        console.error('Usage: promptargs show <template>');
        process.exit(1);
        return;
    }
    const tpl = findTemplate(templateName);
    if (!tpl) {
        console.error(`Template "${templateName}" not found.`);
        process.exit(1);
        return;
    }
    const highlighted = tpl.content.replace(/\{\{(\w+)(?:=([^}]*))?\}\}/g, (_m, varName, defaultVal) => {
        if (defaultVal !== undefined) {
            return `\x1b[33m{{${varName}=${defaultVal}}}\x1b[0m`;
        }
        return `\x1b[31m{{${varName}}}\x1b[0m`;
    });
    console.log(`Template: ${tpl.name} (${tpl.path})\n`);
    console.log(highlighted);
    console.log('\n\x1b[31mred\x1b[0m = required  \x1b[33myellow\x1b[0m = has default');
}
const DIFF_PREVIEW_MAX_CHARS = 60;
function printEnv() {
    console.log('Auto-detected variables:\n');
    for (const name of AUTODETECT_VARS) {
        const value = autodetect(name);
        if (value !== undefined) {
            let display = value;
            if (name === 'diff' && display.length > DIFF_PREVIEW_MAX_CHARS) {
                display = display.slice(0, DIFF_PREVIEW_MAX_CHARS) + '...';
            }
            console.log(`  \x1b[32m{{${name}}}\x1b[0m = ${display}`);
        }
        else {
            console.log(`  \x1b[90m{{${name}}}\x1b[0m = (not detected)`);
        }
    }
    console.log('');
}
main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map