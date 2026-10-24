`{{&name}}` (the Mustache unescaped alias shown in the UI cheatsheet) is now recognised as the blank `name`, instead of silently rendering empty; `{{&a.b}}` is rejected like `{{a.b}}`. (#332)
