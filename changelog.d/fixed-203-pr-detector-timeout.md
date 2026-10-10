The `pr` detector's `gh pr view` call now has a 5 s timeout, so `promptargs ui` can no longer hang at startup on a stalled `gh`; a timed-out call is treated as no PR detected.
