#!/usr/bin/env bash
# ph-hook.sh — Claude Code Stop hook: logs the last prompt+response pair to ph
#
# Claude Code passes a JSON object on stdin with:
#   { "session_id": "...", "transcript_path": "/path/to/session.jsonl" }
#
# The transcript is a JSONL file where each line is one of:
#   - Human turn:    { "promptId": "...", "message": {"role":"user", "content": "string"}, "cwd": "...", ... }
#   - Tool result:   { "toolUseResult": ..., "message": {"role":"user", "content": [...]}, ... }
#   - Assistant turn: { "message": {"role":"assistant", "content": [{type,text},...] }, ... }
#
# This script:
#   1. Reads the hook input to get transcript_path
#   2. Uses jq to find the last genuine human-typed user message (has promptId, string content)
#   3. Extracts the last assistant text block
#   4. Pipes {"tool":"claude","prompt":"...","response":"...","workdir":"..."} to ph log
#   5. Always exits 0 so Claude Code is never blocked

set -uo pipefail

# ── Read hook input ──────────────────────────────────────────────────────────
HOOK_INPUT=$(cat)

TRANSCRIPT_PATH=$(printf '%s' "$HOOK_INPUT" | jq -r '.transcript_path // empty')

# Nothing to do if no transcript path provided
if [[ -z "$TRANSCRIPT_PATH" ]] || [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# ── Extract last user prompt using jq slurp ──────────────────────────────────
# Filter for genuine human turns: has "promptId" AND message.content is a string
# (tool result lines also have role:user but have "toolUseResult" key and array content)
LAST_USER_JSON=$(
  jq -Rs '
    split("\n")
    | map(select(length > 0))
    | map(. as $line | try (. | fromjson) catch null)
    | map(select(. != null))
    | map(select(
        has("promptId")
        and has("message")
        and (.message.role == "user")
        and (.message.content | type == "string")
        and (has("toolUseResult") | not)
      ))
    | last
  ' "$TRANSCRIPT_PATH" 2>/dev/null
)

if [[ -z "$LAST_USER_JSON" ]] || [[ "$LAST_USER_JSON" == "null" ]]; then
  exit 0
fi

LAST_USER_PROMPT=$(printf '%s' "$LAST_USER_JSON" | jq -r '.message.content // empty' 2>/dev/null)
WORKDIR=$(printf '%s' "$LAST_USER_JSON" | jq -r '.cwd // empty' 2>/dev/null)

# Skip if no user prompt found
if [[ -z "$LAST_USER_PROMPT" ]]; then
  exit 0
fi

if [[ -z "$WORKDIR" ]]; then
  WORKDIR="$HOME"
fi

# ── Extract last assistant text response ─────────────────────────────────────
# Assistant messages have message.content as an array of typed blocks.
# We want the last "text" block across recent assistant messages.
LAST_ASSISTANT_RESPONSE=$(
  jq -Rs '
    split("\n")
    | map(select(length > 0))
    | map(. as $line | try (. | fromjson) catch null)
    | map(select(. != null))
    | map(select(
        has("message")
        and (.message.role == "assistant")
        and (.message.content | type == "array")
      ))
    | map(.message.content | map(select(.type == "text") | .text) | join(""))
    | map(select(length > 0))
    | last // ""
  ' "$TRANSCRIPT_PATH" 2>/dev/null | jq -r '.' 2>/dev/null
)

# ── Call ph log ───────────────────────────────────────────────────────────────
# Use jq to safely build the JSON payload (handles escaping automatically)
JSON_PAYLOAD=$(
  jq -n \
    --arg tool "claude" \
    --arg prompt "$LAST_USER_PROMPT" \
    --arg response "${LAST_ASSISTANT_RESPONSE:-}" \
    --arg workdir "$WORKDIR" \
    '{"tool":$tool,"prompt":$prompt,"response":$response,"workdir":$workdir}'
)

# Run ph log in the background so it never blocks Claude Code's exit
# Redirect all output to /dev/null to keep things silent
printf '%s' "$JSON_PAYLOAD" | ph log >/dev/null 2>&1 &
disown $! 2>/dev/null || true

exit 0
