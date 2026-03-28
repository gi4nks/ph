# ph — Roadmap

## ✅ Fase 1: Fondamenta Metadati & Auto-Project

- Colonna `metadata` (JSON) nella tabella `prompts`
- Rilevamento automatico del progetto (`.git`, `package.json`, `tsconfig.json`, ecc.)
- Rilevamento automatico del linguaggio
- Struttura `PromptMetadata` estensibile

## ✅ Fase 2: Organizzazione & Tagging

- Flag `--ph-tag` e `--ph-role` nel wrapper
- Ricerca con filtri per project, language, role, tag, starred
- Output colorato con badge per ruolo e progetto
- Browser TUI interattivo (React/Ink)
- Comando `ph star <id>`

## ✅ Fase 3: Ricerca Intelligente

- **Vector Search (FTS5):** Ricerca full-text ultra-veloce
- **Ricerca Semantica:** Embeddings Gemini `text-embedding-004` + cosine similarity
- **`ph analyze`:** Categorizzazione automatica dei prompt con LLM (Ollama o Gemini)
- Importatori per Claude CLI e Gemini CLI
- `ph export` in formato txt/json/md
- `ph cleanup` per rimuovere prompt inutili
- `ph import --filter` con pipeline di deduplicazione

## ✅ Fase 4: Contesto, Automazione & Sessioni

- **Git Context Snapshot:** Cattura automatica di branch, diff e file modificati al momento del prompt
- **Background Analysis:** Auto-analisi LLM in processo detached dopo ogni cattura
- **Work Sessions (`ph sessions`):** Raggruppamento per gap temporale + score di coesione semantica
- **Prompt Rerunning (`r` in TUI):** Editor con tool e prompt modificabili, riesecuzione diretta

---

## Fase 5: Idee Future

- **Syntax Highlighting nella TUI:** Evidenziazione dei blocchi di codice nei prompt
- **Clustering Automatico:** K-means sugli embeddings per raggruppare prompt simili in "macro-temi"
- **Cattura delle Risposte:** Salvare anche la risposta dell'AI, non solo il prompt
- **Multi-Provider dalla TUI:** Inviare un prompt salvato a un altro provider (Claude → Gemini) direttamente dalla TUI
- **Export Session:** Esportare una sessione intera come documento markdown con timeline
- **Web UI:** Interfaccia browser opzionale per navigare la cronologia su desktop
