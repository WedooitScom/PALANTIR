#!/bin/sh
# Forwards a Claude Code hook payload (JSON on stdin) to the local map server.
# Usage (from ~/.claude/settings.json): send-event.sh <HookEventName>
#
# MUST never block or fail Claude Code: silent, 1 s timeout, always exit 0.
#
# Origin of the session ("go to this session" in the macOS app): a STRICT whitelist of a few
# environment values, each validated here (and again by the server), sent in the X-LOTR-Origin
# header as k=v&k=v. Nothing else from the environment is ever sent (it holds the user's e-mail,
# account UUIDs and tokens). The JSON payload itself is streamed untouched from stdin.
set -f
HOOK_NAME="${1:-}"
case "$HOOK_NAME" in
  *[!A-Za-z]*) HOOK_NAME="" ;;
esac
PORT="${LOTR_MAP_PORT:-4777}"
case "$PORT" in
  ''|*[!0-9]*) PORT=4777 ;;
esac
URL="http://127.0.0.1:${PORT}/event"
if [ -n "$HOOK_NAME" ]; then
  URL="${URL}?hook=${HOOK_NAME}"
fi

ORIGIN=""
# valid <value> <max length> <allowed characters (glob class)>: non-empty, short, only those characters.
valid() {
  [ -n "$1" ] && [ "${#1}" -le "$2" ] || return 1
  case "$1" in
    *[!$3]*) return 1 ;;
  esac
  return 0
}
# add <key> <value> <max length> <allowed characters>
add() {
  valid "$2" "$3" "$4" && ORIGIN="${ORIGIN:+$ORIGIN&}$1=$2"
  return 0
}
add entrypoint "${CLAUDE_CODE_ENTRYPOINT:-}" 32 'a-z0-9_-'
# ^local_[A-Za-z0-9-]{1,64}$
HSID="${CLAUDE_CODE_HOST_SESSION_ID:-}"
case "$HSID" in
  local_*) valid "${HSID#local_}" 64 'A-Za-z0-9-' && ORIGIN="${ORIGIN:+$ORIGIN&}hostSessionId=$HSID" ;;
esac
add termProgram "${TERM_PROGRAM:-}" 64 'A-Za-z0-9._-'
add bundleId "${__CFBundleIdentifier:-}" 128 'A-Za-z0-9.-'
add itermSessionId "${ITERM_SESSION_ID:-}" 80 'A-Za-z0-9:-'
add claudePid "${CLAUDE_PID:-}" 10 '0-9'

# Terminal of the session: first ancestor (from $PPID, at most 6 levels) with a real tty.
# Not looked up for the desktop app (no terminal, saves a few ps calls).
if [ "${CLAUDE_CODE_ENTRYPOINT:-}" != "claude-desktop" ] && command -v ps >/dev/null 2>&1; then
  pid="${PPID:-}"
  i=0
  while [ "$i" -lt 6 ]; do
    case "$pid" in
      ''|*[!0-9]*|0|1) break ;;
    esac
    line=$(ps -o tty= -o ppid= -p "$pid" 2>/dev/null) || break
    # shellcheck disable=SC2086
    set -- $line
    t="${1:-}"
    case "$t" in
      ttys*)
        # ^/dev/ttys[0-9]{1,4}$
        valid "${t#ttys}" 4 '0-9' && ORIGIN="${ORIGIN:+$ORIGIN&}tty=/dev/$t"
        break
        ;;
    esac
    pid="${2:-}"
    i=$((i + 1))
  done
fi

if command -v curl >/dev/null 2>&1; then
  if [ -n "$ORIGIN" ]; then
    curl -s -o /dev/null -m 1 --connect-timeout 1 \
      -X POST -H 'Content-Type: application/json' -H "X-LOTR-Origin: $ORIGIN" \
      --data-binary @- "$URL" >/dev/null 2>&1 || true
  else
    curl -s -o /dev/null -m 1 --connect-timeout 1 \
      -X POST -H 'Content-Type: application/json' \
      --data-binary @- "$URL" >/dev/null 2>&1 || true
  fi
else
  cat >/dev/null 2>&1 || true
fi
exit 0
