# Contributing to promptargs

Thank you for helping improve promptargs.

## Local setup

Use Node.js 18 or newer, then install dependencies:

```bash
npm ci
```

## Build, lint, and test

Before opening a pull request, run:

```bash
npm run lint
npm run build
npm test
```

`npm run build` compiles TypeScript into `dist/` and copies the UI HTML. Keep `dist/` in sync when changing `src/` because the package publishes compiled files.

## Pull requests

- Work on a feature branch; do not push directly to `main`.
- Keep changes focused and include tests or verification notes for behavior changes.
- Sign commits with the Developer Certificate of Origin: `git commit -s`.
- Use clear PR titles and describe user-visible changes, risks, and validation performed.
- Security-sensitive workflow changes should pin reusable workflows or third-party actions to immutable refs.

For larger changes or unclear behavior, open an issue first at https://github.com/hivecommons/promptargs/issues.
