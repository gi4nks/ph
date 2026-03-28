# GEMINI.md — Istruzioni per Gemini CLI

Questo file definisce le direttive per l'agente Gemini nel progetto `ph`.

## Core Focus: Prompt History (ph)

`ph` è un sistema di osservabilità per prompt LLM. L'integrità del database e la precisione dei metadati sono priorità assolute.

## Sistema Provider LLM

- **Ollama**: Provider di default per embedding e analisi locale.
- **Gemini**: Utilizzato per analisi avanzate e embedding se configurato.
- **Integrazione**: Vedere `src/ai/provider.ts` per l'interfaccia `LLMProvider`.

## Database & Persistence

- **WAL Mode**: Il database SQLite deve sempre operare in modalità WAL per supportare l'analisi in background concorrente.
- **FTS5**: Utilizzato per la ricerca full-text.
- **Embeddings**: Salvati come BLOB (Float32Array).

## Convenzioni di Analisi Background

Il sottocomando `_bg-analyze` (in `src/cli.ts`) viene invocato in modo detached da `src/background/analyzer.ts`.
**Non modificare il comportamento del processo figlio senza testare l'impatto sulla latenza del processo padre.**

## Gestione Hooks

Gli hooks devono essere trasparenti. Ogni modifica a `src/pty/wrapper.ts` deve garantire che il segnale `SIGWINCH` (ridimensionamento terminale) venga propagato correttamente all'AI CLI wrappata.

## Workflow Prompt Snapshot

Al momento della cattura (`ph capture`), raccogli sempre:
1. Git Context (branch, diff).
2. Project Context (rilevato da `package.json` o simili).
3. Ambiente (CWD, Timestamp).

## Semantic Versioning & Releases

- Il progetto utilizza `standard-version` per automatizzare i rilasci.
- **Git Workflow**:
  - Le modifiche devono seguire le **Conventional Commits**.
  - Prima di un rilascio, assicurati che la build sia corretta (`make build`).
  - Esegui `make release-patch` (o minor/major) per aggiornare la versione e il `CHANGELOG.md`.
  - Non committare modifiche alla versione fuori dal processo di rilascio.
  - Il push dei tag (`git push --follow-tags`) innesca il workflow GitHub per la pubblicazione su GitHub Packages.
