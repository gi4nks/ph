# Codex CLI capture for PH

Install or update the integration with:

```sh
ph setup codex
```

Restart Codex and approve/trust the hook if prompted. PH reads the rollout transcript supplied to its stop hook, associates imported turns with the active CLI working directory, and deduplicates turns already stored.

To import existing sessions, preview first:

```sh
ph import codex --dry-run
ph import codex
```

See [the PH Capture Integrations guide](../../docs/hooks.md) and [the user manual](../../docs/ph-manual.md) for the supported workflow, other integrations, options, and data handling.
