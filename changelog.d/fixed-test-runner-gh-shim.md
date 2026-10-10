Test runner puts a no-op `gh` first on PATH for the whole suite, so UI and CLI tests no longer stall or trip their spawn guards when the host's `gh pr view` hangs on a slow proxy or expired auth.
