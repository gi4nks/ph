#!/usr/bin/env bash
# Import the active Codex rollout after each completed turn.
set -u

INPUT=$(cat)
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(s).transcript_path||"")}catch{}})' 2>/dev/null)
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  printf '{}\n'
  exit 0
fi

ph import codex --file "$TRANSCRIPT_PATH" >/dev/null 2>&1 || true
printf '{}\n'
exit 0
