The `diff` detector now passes `--no-color --no-ext-diff`, so `{{diff}}` is a plain unified diff even when the user's git config sets `color.ui = always` or a `diff.external` tool.
