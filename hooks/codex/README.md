# Codex CLI hook for ph

The hook imports the active Codex rollout after each completed turn. Codex supplies the transcript path to the `Stop` hook; `ph` pairs user messages with the assistant response and deduplicates turns already captured.

## Install

From the ph repository, make the hook executable and link it into your Codex configuration directory:

```sh
chmod +x hooks/codex/ph-hook.sh
mkdir -p ~/.codex
ln -sf "$(pwd)/hooks/codex/ph-hook.sh" ~/.codex/ph-hook.sh
```

Add this to `~/.codex/hooks.json` (merge it with any existing hooks):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/ph-hook.sh"
          }
        ]
      }
    ]
  }
}
```

Restart Codex and approve/trust the hook when prompted. If hooks are disabled
in your Codex configuration, enable them in `~/.codex/config.toml`:

```toml
[features]
hooks = true
```

The hook only reads the
transcript path supplied by Codex and writes through `ph import`; it does not
modify Codex session files. Codex describes the transcript path as a convenience
field and does not guarantee the transcript format as a stable hook interface.

## Import existing sessions

```sh
ph import codex --dry-run
ph import codex
```

Codex rollouts are read from `~/.codex/sessions/`. To import one transcript, the hook uses the same importer with `--file <path>`.
