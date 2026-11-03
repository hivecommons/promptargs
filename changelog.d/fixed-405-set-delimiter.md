A Mustache set-delimiter tag (`{{=<% %>=}}`) is now rejected with a usage error instead of silently dropping later `{{name}}` blanks while `--status` reported them filled and the run exited 0. (#405)
