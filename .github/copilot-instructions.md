# promptargs — Template arguments for AI prompts 🏴‍☠️

This repo includes `promptargs`, a CLI for prompt template variable substitution.

## Usage

```bash
# Run a template
promptargs review --file=src/main.ts --no-interactive

# Array iteration
promptargs review --file=api.go,auth.go,db.go --no-interactive

# Inline template
promptargs "Explain {{concept}} to a {{audience=beginner}}" --concept=recursion --no-interactive

# List templates
promptargs list

# Create starter templates
promptargs init

# Show auto-detected variable values
promptargs env
```

## Install

```bash
npm install -g @kubestellar/promptargs
```

## Template syntax

- `{{variable}}` — required, must be filled
- `{{variable=default}}` — has a default value

Templates live in `.prompts/` (project) or `~/.prompts/` (user).

## Status line

When running a template, ALWAYS run `promptargs env` first and display the auto-detected variable values to the user. This shows what the CLI already knows about the current environment (branch, repo, org, user, date, diff, pr).

After running a template, show the fill state with `--status`:
```bash
promptargs review --file=main.go --status
```

Output: `✅ review: file=main.go  focus=correctness(default)  tone=concise(default)`

## When the user asks to use promptargs

1. **ALWAYS run `promptargs env` first** and display the output — the user must see what values promptargs already knows (branch, repo, org, user, date, diff, pr) before any template expansion
2. Run the requested template with `--status` to show the fill state
3. Run the template with `--no-interactive` to get the expanded prompt
4. Use the expanded prompt as context for the task

## Status display

Every time promptargs is mentioned or a template is run, show the auto-detected variables inline:

```
🏴‍☠️ promptargs env: branch=main  repo=my-project  org=hivecommons  user=Andy Anderson  date=2026-07-02
```

This gives the user immediate visibility into what values are pre-filled.
