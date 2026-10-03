# Release and rollback runbook

How a release of `@hivecommons/promptargs` ships, and how to back out a bad one.

## How a release ships

1. A PR bumps `version` in `package.json` and merges to `main`.
2. `auto-release.yml` creates the GitHub release `v<version>` if none exists.
3. `auto-release.yml` explicitly dispatches `release.yml` with the release tag, which builds, verifies `dist/` is in sync with `src/`, runs the tests, checks the tag matches `package.json`, and runs `npm publish --provenance`.

Human-published GitHub releases also trigger the same `release.yml` publish path. Releases created with `GITHUB_TOKEN` do not trigger release-event workflows, so the automatic path needs the explicit dispatch and `actions: write` permission.

A failure in step 3 leaves a GitHub release without a matching npm version.

## Verify a release

```bash
npm view @hivecommons/promptargs version dist-tags
npx --yes @hivecommons/promptargs@<version> --help
gh release view v<version> --repo hivecommons/promptargs
gh run list --workflow release.yml --repo hivecommons/promptargs --limit 3
```

## Roll back a bad release

npm versions are immutable. Never try to republish the same version.

1. **Stop new installs of the bad version.** Point `latest` at the last good version:
   ```bash
   npm dist-tag add @hivecommons/promptargs@<good-version> latest
   ```
2. **Mark the bad version.** Users who pin it see the warning at install time:
   ```bash
   npm deprecate @hivecommons/promptargs@<bad-version> "Broken release, use <good-version> or later"
   ```
   Use `npm unpublish` only within npm's unpublish window and only if the package contains something that must not be distributed.
3. **Ship the fix forward.** Revert or fix on `main`, bump to a new patch version, and let the release flow publish it. Move `latest` to the fixed version once verified.
4. **Update the GitHub release.** Edit the bad release's notes to say it is superseded, or mark it as a pre-release. Do not delete the tag; `auto-release.yml` would recreate a release for the current `package.json` version.
5. **Record it.** Add a `changelog.d` entry describing the regression and the fixed version.

## Failed publish (release exists, npm version missing)

If no `Release` run exists (including the original `v0.7.0` release), or the dispatch failed after creating the release, check that the version is absent from npm, then dispatch the publish workflow after the workflow fix has merged:

```bash
npm view @hivecommons/promptargs versions --json
GH_TOKEN="$GH_TOKEN" gh workflow run release.yml --repo hivecommons/promptargs --ref main -f tag=v0.7.0
```

Replace `v0.7.0` with the missing release tag. Run the workflow from `main` so it uses the updated workflow even for older tags; it checks out `refs/tags/<tag>` and validates that tag against the checked-out package version before publishing. Do not move or recreate the existing tag. The auto-release workflow skips existing releases, so it will not retry this publication automatically.

1. Open the failed `Release` run and read the failing step (dist drift, tests, tag/version mismatch, or npm auth).
2. If the cause was in the repository, fix it on `main` and bump the patch version. The tag already points at the broken commit.
3. If the cause was transient (npm outage, expired `NPM_TOKEN`), re-run the failed `Release` run after fixing it. The tag matches `package.json` at that commit, so the version check passes.

## Checks before cutting a release

- `npm run lint && npm run build && npm test` pass, and `git status --porcelain -- dist/` is empty.
- `package.json` version is greater than the latest published version.
- `NPM_TOKEN` is valid and the `release.yml` run can reach the npm registry.
