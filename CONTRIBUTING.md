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

`npm run test:coverage` (Node >= 22.8) runs the same suite with coverage thresholds enforced; use it to check that new code does not drop coverage below the gate.

## Changelog fragments

For a user-visible change, add one Markdown file to `changelog.d/` named `<category>-<slug>.md`, where the category is `added`, `changed`, or `fixed`. The file holds a single user-facing line describing the change, ending with the PR or issue number, for example `(#86)`. See the existing files in `changelog.d/` for the style.

## Releases

Releases ship from a version bump in `package.json`. See [runbooks/release-rollback.md](runbooks/release-rollback.md) for how a release is published and how to roll one back.

## Pull requests

- Work on a feature branch; do not push directly to `main`.
- Keep changes focused and include tests or verification notes for behavior changes.
- Sign commits with the Developer Certificate of Origin: `git commit -s`.
- Use clear PR titles and describe user-visible changes, risks, and validation performed.
- Security-sensitive workflow changes should pin reusable workflows or third-party actions to immutable refs.

For larger changes or unclear behavior, open an issue first at https://github.com/hivecommons/promptargs/issues.
