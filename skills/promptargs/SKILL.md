---
name: promptargs
description: Fill in reusable prompt templates with variable substitution using the promptargs CLI. Use when the user wants to run, list, preview or create prompt templates with {{blanks}}, iterate a prompt over many files or values, or pipe an expanded prompt to an AI CLI.
license: Apache-2.0
compatibility: Requires Node.js 22+ and the promptargs CLI (npm install -g @hivecommons/promptargs, or npx @hivecommons/promptargs).
---

# promptargs — template arguments for AI prompts

A template is a prompt with blanks: `Review {{file}} for {{focus=correctness}} issues.` promptargs fills the blanks from flags, auto-detected context, defaults, or an interactive prompt.

## Install

```bash
npm install -g @hivecommons/promptargs
# or run without installing
npx @hivecommons/promptargs help
```

## Run a template

Always pass `--no-interactive` when running as an agent so it never waits for input:

```bash
promptargs review --file=src/main.ts --focus=security --no-interactive
```

Inline template (no file needed):

```bash
promptargs "Explain {{concept}} to a {{audience=beginner}}" --concept=recursion --no-interactive
```

## Discover and create templates

```bash
promptargs list          # available templates and their variables
promptargs show review   # preview with blanks highlighted
promptargs init          # create .prompts/ with starter templates
promptargs env           # preview auto-detected variable values
```

Templates are `.md` files in `.prompts/` (project, overrides) or `~/.prompts/` (personal).

## Template syntax

- `{{name}}` — required blank
- `{{name=default}}` — blank with a default
- `{{! comment }}` — Mustache comment, safe to use

Names may use letters, digits, `_` and `-` (`{{file-name}}`). Dotted names such as `{{repo.owner}}` are rejected with a `UsageError` — use `{{repo_owner}}` instead; the switch names `no-interactive`, `cross`, `json`, `status` and `help` are also rejected, as they are reserved for CLI switches. Likewise, the template file names `help`, `env`, `ui`, `init`, `list` and `show` are reserved for the subcommands of the same name; such a template is listed as unreachable by `promptargs list` (and `show` warns), because the subcommand always wins. A default may appear on any occurrence of a repeated blank (`{{name}} … {{name=hello}}`); if two occurrences give different defaults, the first one wins.

Avoid Mustache sections (`{{#x}}`) and partials (`{{>x}}`): promptargs does not fill them.

## Fill priority

1. `--flag=value` (always wins)
2. Auto-detected values: git context (`branch`, `repo`, `org`, `user`, `date`, `diff`, `pr`) and non-secret environment variables
3. Template default
4. Interactive prompt (skipped with `--no-interactive`)

Credential-looking environment variables (tokens, secrets, passwords, keys) are never auto-filled.

## Iterate over many values

Comma-separated values, globs, or `@file` run the template once per value, with results separated by `---`:

```bash
promptargs review --file=api.go,auth.go,db.go --no-interactive
promptargs review --file="src/*.go" --no-interactive
promptargs review --file=@list.txt --no-interactive
```

To pass a single value that contains a comma, escape it as `\,` (`--expected="returns 200\, not 500"`); this also applies to interactive answers and `@file` lines. To end a value with a backslash before a separator comma, double it: `\\,` (`--dir='C:\out\\,D:\out'` gives `C:\out\` and `D:\out`).

Multiple arrays are zipped 1:1 by default; add `--cross` for every combination.

## Output formats

- default: plain expanded text (progress goes to stderr)
- `--json`: JSON output
- `--status`: one status line showing which variables were filled or defaulted (never prompts; implies `--no-interactive`)

## Pipe to an AI tool

```bash
promptargs review --file=src/main.ts --no-interactive | claude -p "do this review"
```

Or read the expanded prompt and act on it directly in the current session.

## Pitfalls

- A blank with no value and no default is a usage error under `--no-interactive` (or piped stdin): the run exits 1 with `Missing value for {{name}}`. Pass `--name=value`, give it a default, or check with `promptargs show <template>` or `--status`.
- Auto-detected values and defaults are never prompted for; pass `--name=value` to override.
