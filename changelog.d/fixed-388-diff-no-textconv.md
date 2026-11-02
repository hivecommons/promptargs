The `diff` detector now passes `--no-textconv`, so `{{diff}}` is a plain unified diff even when the user's git config sets `diff.<driver>.textconv` to rewrite blob content.
