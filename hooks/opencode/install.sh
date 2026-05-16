#!/usr/bin/env bash
# install.sh — Install the ph OpenCode plugin
#
# Usage: ./install.sh [--global|--project]
#   --global   Install in ~/.config/opencode/plugins/ (default)
#   --project  Install in .opencode/plugins/ (current directory)

set -euo pipefail

PLUGIN_SOURCE="$(cd "$(dirname "$0")" && pwd)/ph-plugin.ts"
MODE="${1:---global}"

case "$MODE" in
  --global)
    TARGET_DIR="$HOME/.config/opencode/plugins"
    ;;
  --project)
    TARGET_DIR=".opencode/plugins"
    mkdir -p "$TARGET_DIR"
    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
    ;;
  *)
    echo "Usage: $0 [--global|--project]"
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"

TARGET_FILE="$TARGET_DIR/ph-plugin.ts"

if [ -f "$TARGET_FILE" ]; then
  echo "Updating existing plugin at $TARGET_FILE"
else
  echo "Installing plugin to $TARGET_FILE"
fi

cp "$PLUGIN_SOURCE" "$TARGET_FILE"
echo "✅ ph OpenCode plugin installed at $TARGET_FILE"

echo ""
echo "Plugin will be loaded automatically on next OpenCode startup."
echo "To verify: opencode config will show it in the plugin list."
echo ""
echo "To uninstall: rm $TARGET_FILE"
