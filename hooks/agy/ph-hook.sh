#!/usr/bin/env bash
# ph-hook.sh — Antigravity Stop hook: imports the active session transcript into ph
set -u

INPUT=$(cat)
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.transcriptPath||j.transcript_path||"")}catch{}})' 2>/dev/null)
WORKDIR=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.workspacePaths&&j.workspacePaths[0])||j.cwd||"")}catch{}})' 2>/dev/null)

if [ -z "$WORKDIR" ]; then
  WORKDIR="$PWD"
fi

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  ph import agy --file "$TRANSCRIPT_PATH" --workdir "$WORKDIR" --live >/dev/null 2>&1 || true
fi

printf '{"decision":"allow"}\n'
exit 0
