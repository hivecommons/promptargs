Test covering the non-ENOENT rethrow branch of the `init` pre-flight lstat, so a permission or I/O error on `.prompts` surfaces instead of being masked.
