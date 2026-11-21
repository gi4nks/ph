#!/usr/bin/env bash
set -u
HOOK_INPUT=$(cat)
printf '%s' "$HOOK_INPUT" | ph hook gemini --workdir "$PWD" >/dev/null 2>&1 &
disown $! 2>/dev/null || true
exit 0
