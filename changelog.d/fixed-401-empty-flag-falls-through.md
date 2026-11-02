Fixed `--flag=` (an empty value) now falls through to the default or prompt like `--flag=,` and `--flag=@empty.txt`, instead of overriding the default with an empty string. (#401)
