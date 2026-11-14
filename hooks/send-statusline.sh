#!/bin/sh
# Forwards the Claude Code status line payload (JSON on stdin) to the local map server.
# Called from the user's status line script:  printf '%s' "$input" | send-statusline.sh
#
# MUST never slow down or alter the status line: prints nothing (stdout IS the status line),
# sends from a detached background curl (1 s timeout) whose stdout/stderr go to /dev/null,
# always exits 0. The explicit `<&3` keeps the payload as curl's stdin (a background job
# would otherwise get /dev/null), without spawning `cat` or a subshell.
command -v curl >/dev/null 2>&1 || exit 0
PORT="${LOTR_MAP_PORT:-4777}"
case "$PORT" in
  ''|*[!0-9]*) PORT=4777 ;;
esac
exec 3<&0
curl -s -o /dev/null -m 1 --connect-timeout 1 \
  -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:${PORT}/statusline" <&3 >/dev/null 2>&1 &
exit 0
