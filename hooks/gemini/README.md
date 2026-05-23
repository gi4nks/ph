# Gemini CLI Hook for ph

This hook allows Gemini CLI to automatically save every prompt and response to the `ph` database.

## Installation

1. Ensure `ph` is installed and working.
2. Create a symbolic link of the script in Gemini's configuration folder:

```bash
ln -sf "$(pwd)/ph-hook.sh" ~/.gemini/ph-hook.sh
chmod +x ~/.gemini/ph-hook.sh
```

## Gemini CLI Configuration

Add (or update) the `hooks` section in your `~/.gemini/settings.json` file:

```json
{
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/gianluca/.gemini/ph-hook.sh"
          }
        ]
      }
    ]
  }
}
```

**Note:** Ensure the path in the command correctly points to the symbolic link or the actual script. Using the symbolic link at `~/.gemini/ph-hook.sh` keeps the configuration portable.

## How it works

The script is executed by Gemini CLI at the `AfterAgent` event (after each agent response).
1. Receives the JSON input from Gemini CLI containing the prompt and response.
2. Extracts the user prompt and the assistant response.
3. Sends the data to `ph log` in the background.
