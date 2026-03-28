#!/usr/bin/env bash
# ph-hook.sh — Gemini CLI AfterAgent hook: logs the last prompt+response pair to ph
#
# Gemini CLI sends a JSON object on stdin with:
#   {
#     "session_id": "...",
#     "transcript_path": "...",
#     "cwd": "/path/to/workdir",
#     "hook_event_name": "AfterAgent",
#     "timestamp": "...",
#     "prompt": "the user's prompt text",
#     "prompt_response": "the assistant's full response text"
#   }
#
# This script:
#   1. Reads the hook input JSON
#   2. Extracts prompt, prompt_response, and cwd
#   3. Pipes {"tool":"gemini","prompt":"...","response":"...","workdir":"..."} to ph log
#   4. Always exits 0 so Gemini CLI is never blocked

set -uo pipefail

# ── Read hook input ──────────────────────────────────────────────────────────
HOOK_INPUT=$(cat)

PROMPT=$(printf '%s' "$HOOK_INPUT" | jq -r '.prompt // empty')
RESPONSE=$(printf '%s' "$HOOK_INPUT" | jq -r '.prompt_response // empty')
WORKDIR=$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty')

# Nothing to do if no prompt
if [[ -z "$PROMPT" ]]; then
  exit 0
fi

# Fallback workdir
if [[ -z "$WORKDIR" ]]; then
  WORKDIR="$HOME"
fi

# ── Call ph log ───────────────────────────────────────────────────────────────
# Use jq to safely build the JSON payload (handles escaping automatically)
JSON_PAYLOAD=$(
  jq -n \
    --arg tool "gemini" \
    --arg prompt "$PROMPT" \
    --arg response "${RESPONSE:-}" \
    --arg workdir "$WORKDIR" \
    '{"tool":$tool,"prompt":$prompt,"response":$response,"workdir":$workdir}'
)

# Run ph log in the background so it never blocks Gemini CLI
# Redirect all output to /dev/null to keep things silent
printf '%s' "$JSON_PAYLOAD" | /opt/homebrew/bin/ph log >/dev/null 2>&1 &
disown $! 2>/dev/null || true

exit 0
