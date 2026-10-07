# Incident response and postmortem template

Use this when a published `@hivecommons/promptargs` version is broken for users (wrong output, crash on install, leaked data, failed publish). Security reports follow `SECURITY.md` and must stay private.

## Triage

1. Confirm the report: reproduce against the published version (`npx @hivecommons/promptargs@<version> --help`).
2. Record the affected versions and the user impact (who is blocked, and whether a workaround exists).
3. Decide: roll back (see `release-rollback.md`) or ship a fixed patch version. Prefer a patch when the fix is small and tested.

## Communicate

- Open or update a GitHub issue stating affected versions, impact, workaround, and current status.
- Deprecate the bad version on npm with a message pointing to the fixed version.
- Post a status update on the issue whenever the state changes, and when it is resolved.

## Postmortem template

Copy into an issue titled `postmortem: <short summary>` within five working days of resolution. Keep it blameless.

```markdown
## Summary
One or two sentences: what broke, for whom, for how long.

## Impact
Affected versions, number of users or installs if known, severity.

## Timeline (UTC)
- HH:MM detected
- HH:MM mitigated
- HH:MM resolved

## Root cause
What change or condition caused it, and why checks did not catch it.

## What went well / what went poorly

## Action items
- [ ] Owner, due date, link to the issue or PR
```
