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


import { parseVars, expand } from './parser.js';
import { findTemplate } from './loader.js';
import { resolve } from './resolver.js';
import { renderStatus } from './status.js';
import { startUI } from './ui.js';
import { UsageError, parseFlags, parsePort } from './flags.js';
import { doInit, doList, doShow, printEnv } from './commands.js';

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
  --var value         Same as --var=value (switches above take no value)

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
    startUI(parsePort(flags));
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
  let content: string;
  let name: string;
  if (templateName.includes('{{')) {
    content = templateName;
    name = 'inline';
  } else {
    const tpl = findTemplate(templateName);
    if (!tpl) {
      throw new UsageError(
        `Template "${templateName}" not found.\n` +
          'Run "promptargs list" to see available templates.\n' +
          'Run "promptargs init" to create example templates.',
      );
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

  const { iterations } = await resolve(vars, flags, interactive, cross);

  if (statusOnly) {
    const status = renderStatus(name, vars, iterations[0]);
    console.log(status);
    return;
  }

  const results: string[] = [];

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
  } else {
    console.log(results.join('\n---\n'));
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
