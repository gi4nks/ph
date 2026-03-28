# CLAUDE.md — Istruzioni per Claude

Questo file fornisce contesto specifico per l'utilizzo di Claude all'interno del progetto `ph`.

## Protocollo di Sviluppo

- **Build**: `make build` (usa `tsup` per generare `dist/cli.js`).
- **Dev**: `npm run dev -- <comando>` (usa `tsx` per l'esecuzione diretta).
- **Linguaggio**: TypeScript (ESM). Gli import devono includere l'estensione `.js`.

## Architettura di Riferimento

- **Entry Point**: `src/cli.ts` gestisce il parsing dei comandi via `commander`.
- **Database**: SQLite via `better-sqlite3`. Tabelle principali: `prompts`, `embeddings`.
- **Hooks**: Gli script in `hooks/` sono i punti di ingresso per la cattura trasparente dei dati.

## Stile di Codice

- Segui le regole definite in `eslint.config.js`.
- Mantieni le interfacce in `src/types.ts`.
- Non rimuovere mai funzionalità esistenti senza autorizzazione.
- Documenta sempre i cambiamenti ai metadati dei prompt.

## Comandi Utili per l'Agente

```bash
npm run lint          # Controllo formattazione
make build            # Compilazione completa
make release-patch    # Creazione di una nuova patch release
ph capture --role debug "test prompt" # Test manuale cattura
```

## Workflow di Versioning

- Usa sempre **Conventional Commits** (es. `feat: aggiunta ricerca semantica`, `fix: risolto bug nel database`).
- I rilasci devono essere effettuati tramite i target del `Makefile` (`make release-patch|minor|major`).
- Non modificare manualmente la versione in `package.json`.
