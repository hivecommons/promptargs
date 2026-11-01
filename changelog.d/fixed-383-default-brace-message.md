Fixed error message for a default containing `}`: now reports "Unsupported default" instead of blaming the (valid) variable name, with a hint that `}` cannot appear inside a Mustache tag. (#383)
