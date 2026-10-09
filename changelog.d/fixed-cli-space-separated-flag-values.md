Fixed `--var value` (space-separated) silently binding `true` in the CLI: it now binds the value, and a bare non-switch `--var` with no value exits 1 with a clear error.
