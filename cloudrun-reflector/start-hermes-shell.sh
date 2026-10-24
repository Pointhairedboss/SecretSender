#!/usr/bin/env bash
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export TERM=xterm-256color
export COLORTERM=truecolor
export HERMES_MODEL="${HERMES_MODEL:-gemini-3.8-flash}"
cd /app

/usr/local/bin/hermes "$@"

exec /bin/bash -i
