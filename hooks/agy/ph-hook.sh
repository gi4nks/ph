#!/usr/bin/env bash
set -u
HOOK_INPUT=$(cat)
printf '%s' "$HOOK_INPUT" | ph hook agy --workdir "$PWD" >/dev/null 2>&1 &
disown $! 2>/dev/null || true
printf '{"decision":"allow"}\n'
exit 0
