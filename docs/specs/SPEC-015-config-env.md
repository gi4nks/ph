# SPEC-015: Config & Env Overrides

- **ID**: SPEC-015
- **Cluster**: Config
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Central configuration for ph: `~/.ph_config.json` with typed keys, `ph config
get/set`, and environment overrides (`PH_DB`, `PH_REMOTE_URL`, `GEMINI_API_KEY`).

## 2. Scope
- **In scope**: PhConfig shape, load/save, `ph config` command, env precedence.
- **Out of scope**: per-command flags (each command parses its own).
- **Entry points**: `ph config get|set <key> <value>`, env vars.

## 3. Data Model
- `PhConfig` (src/config/index.ts:5-22): geminiApiKey, dbPath, analyzeProvider,
  ollamaUrl, ollamaModel, ollamaEmbedModel, filterMinLength, filterMinRelevance,
  backgroundAnalysis, remoteUrl, remoteApiKey, remoteLastPush, remoteLastPull,
  retentionDays, retentionMinStarred, retentionMinAnalyzed, retentionMinRelevance.
- Env: `PH_DB` (dbPath, cli.ts:157), `PH_REMOTE_URL` (remote.ts:6-8),
  `GEMINI_API_KEY` (cli.ts:153-155).
- `load()` (src/config/index.ts:27-35): reads the file, defaults `{}` on
  missing/corrupt. `save(cfg)` (:38-40) writes JSON.

## 4. Flows

### 4.1 Command (src/commands/config.ts)
`ph config set <key> <value>` — validates key exists in PhConfig, coerces
value (boolean/number), loads → updates → saves. `ph config get <key>` prints
the value; no key prints the whole config.

### 4.2 Precedence
1. Env beats config: PH_DB > cfg.dbPath > defaultPath; PH_REMOTE_URL >
   cfg.remoteUrl.
2. geminiApiKey in config is exported to `process.env.GEMINI_API_KEY` before
   dispatch (cli.ts:153-155).
3. `analyzeProvider` ('ollama' | 'gemini') picks the LLM provider
   (SPEC-006 factory).

## 5. Invariants & Business rules
- Unknown keys in `ph config set` are rejected (validated against PhConfig).
- load() never throws — corrupt config degrades to defaults.
- Save is full-file write (no partial merge).

## 6. UI / UX surface
`ph config` CLI + Settings panel in the TUI (`o`, SPEC-012) which edits the same
file.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given `ph config set background-analysis true`, When run, Then the
  config file contains `"backgroundAnalysis": true`
  (src/commands/config.ts, config/index.ts:38-40).
- **G2**: Given a missing config file, When `load()` runs, Then `{}` is returned
  without throwing (src/config/index.ts:27-35).
- **G3**: Given `ph config set bogus-key 1`, When run, Then the key is rejected
  (src/commands/config.ts validation).
- **G4**: Given `PH_REMOTE_URL` env and a config `remoteUrl`, When
  `remoteUrl()` runs, Then the env value wins (src/commands/remote.ts:6-8).
- **G5**: Given a config with `geminiApiKey`, When main() runs, Then
  `process.env.GEMINI_API_KEY` is set (src/cli.ts:153-155).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| PhConfig + load/save | src/config/index.ts:5-40 |
| get/set command | src/commands/config.ts |
| Env precedence | src/cli.ts:157, src/commands/remote.ts:6-8 |
| TUI settings panel | src/ui/BrowseApp.tsx (SettingsView) |

## 9. Open questions / discrepancies
- `remoteLastPush` was missing from PhConfig (FIXED 2026-08-08, SPEC-ISSUES-003).
- `save()` writes the whole object — concurrent `ph` processes (e.g. a hook
  logging while the user sets config) can clobber each other's writes (no
  locking).
- Config comments in AGENTS.md describe defaults that live in code
  (load-time defaults in cli.ts/commands) — the doc is authoritative for intent,
  code for truth.

## 10. Related
- SPEC-001 (load at startup), SPEC-004/006/009 (filter/analysis/retention keys),
  SPEC-010 (remote keys). No tests (SPEC-ISSUES-007) — G1/G2/G4 are vitest
  targets with a temp HOME.
