`promptargs ui` given any flag other than `--port` (`--prot=3700`, `--json`). Old: silently ignored, the server started on the default port. New: exit 1 with an `Unknown flag` error. (#317)
