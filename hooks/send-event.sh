#!/bin/sh
# Forwards a Claude Code hook payload (JSON on stdin) to the local map server.
# Usage (from ~/.claude/settings.json): send-event.sh <HookEventName>
#
# MUST never block or fail Claude Code: silent, 1 s timeout, always exit 0.
HOOK_NAME="${1:-}"
case "$HOOK_NAME" in
  *[!A-Za-z]*) HOOK_NAME="" ;;
esac
PORT="${LOTR_MAP_PORT:-4777}"
URL="http://127.0.0.1:${PORT}/event"
if [ -n "$HOOK_NAME" ]; then
  URL="${URL}?hook=${HOOK_NAME}"
fi
if command -v curl >/dev/null 2>&1; then
  curl -s -o /dev/null -m 1 --connect-timeout 1 \
    -X POST -H 'Content-Type: application/json' \
    --data-binary @- "$URL" >/dev/null 2>&1 || true
else
  cat >/dev/null 2>&1 || true
fi
exit 0
