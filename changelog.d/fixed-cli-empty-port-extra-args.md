Fixed `promptargs ui --port=` (empty value) silently using the default port and extra positional arguments after the template name being silently ignored: both now exit 1 with a clear error. (#196)
