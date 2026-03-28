# Claude Code Hook for ph

This hook allows Claude Code to automatically save every prompt and response to the `ph` database.

## Installation

1. Ensure `ph` is installed and working.
2. Create a symbolic link of the script in Claude's configuration folder:

```bash
ln -sf "$(pwd)/ph-hook.sh" ~/.claude/ph-hook.sh
chmod +x ~/.claude/ph-hook.sh
```

## Claude Code Configuration

Add (or update) the `hooks` section in your `~/.claude/settings.json` file:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/gianluca/.claude/ph-hook.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

**Note:** Ensure the path in the command correctly points to the symbolic link or the actual script. Using the symbolic link at `~/.claude/ph-hook.sh` keeps the configuration portable.

## How it works

The script is executed by Claude Code at the `Stop` event (end of an exchange).
1. Reads the current session transcript.
2. Extracts the last user prompt and the last assistant response.
3. Sends the data to `ph log` in the background.
