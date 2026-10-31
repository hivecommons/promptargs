# `promptargs ui` will not start or will not load

Use this when a user reports that `promptargs ui` exits at startup, prints no URL, or opens a page that answers `Forbidden`. The server binds `127.0.0.1` only and serves nothing without the per-run access token, so every symptom below is local to the user's machine.

Ask the reporter to re-run with `PROMPTARGS_LOG=json` set. Each row names the `event` they will see in the stderr output.

| Symptom | `event` | Cause | Fix |
| --- | --- | --- | --- |
| `Port N is in use` and exit code 1 | `ui_start_error` (`error_class` `port_in_use`) | Another process, often an earlier `promptargs ui`, holds the port | Use `promptargs ui --port=N+1`, or `--port=0` to let the OS pick |
| `UI file not found. Reinstall @hivecommons/promptargs.` and exit code 1 | `ui_start_error` (`error_class` `not_found`) | `ui.html` is missing from the installed package | Reinstall; if a fresh install is also missing it, treat it as a broken release (see `incident-response.md`) |
| `could not open a browser` | `ui_browser_open_failed` | No `xdg-open`, `open` or `start` on the machine (headless, container, SSH) | Open the printed URL manually; it already carries the token |
| Page says `Forbidden` | `ui_token_rejected` | The URL was typed or bookmarked without the `?` token query | Copy the full URL printed at startup; the token changes on every run |
| Page says `Forbidden`, URL is correct | `ui_host_rejected` | Reached through a name other than `localhost`, `127.0.0.1` or `[::1]` (port forward, reverse proxy, remote dev box) | Browse to `http://localhost:<port>/?...` directly. Do not relax the Host check: it blocks DNS rebinding reads of the embedded environment |
| Page loads but a script 404s | `ui_asset_error` | A `dist/*.js` module the page imports is missing from the install | Reinstall; if reproducible on a fresh install, roll back (see `release-rollback.md`) |

The `*_rejected` events are logged once per run, then summarised on shutdown, so a single line does not mean a single bad request.

## Do not

- Do not ask the reporter to paste the access token URL into the issue. Anyone on the same machine who has it can read the environment variables the page embeds.
- Do not widen the bind address or the allowed hosts as a workaround.
