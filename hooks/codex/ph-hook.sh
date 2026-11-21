#!/usr/bin/env bash
set -u
HOOK_INPUT=$(cat)
printf '%s' "$HOOK_INPUT" | ph hook codex --workdir "$PWD" >/dev/null 2>&1 &
disown $! 2>/dev/null || true
printf '{}\n'
exit 0
