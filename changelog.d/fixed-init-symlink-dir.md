`promptargs init` now refuses a project `.prompts` entry that is a symlink (dangling or not) with a clear error instead of reporting "already exists" or failing with EEXIST. (#298)
