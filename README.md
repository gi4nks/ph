# ph — Prompt History & Analysis Tool

`ph` è un wrapper trasparente per strumenti CLI AI (come Gemini CLI, Claude CLI, ecc.). Cattura ogni prompt in un database SQLite locale, fornendo ricerca full-text e semantica, analisi automatica in background e snapshot del contesto Git.

## Caratteristiche principali

- 📥 **Cattura Automatica**: Salva prompt, output (se non interattivo) e metadati.
- 🌳 **Context Git**: Salva branch, file modificati e diff al momento del prompt.
- 🔍 **Ricerca Avanzata**: Ricerca testuale (FTS5) e semantica (vettoriale).
- 🧠 **Analisi Background**: Analisi automatica dei prompt (ruolo, tag, rilevanza) via Ollama o Gemini.
- 🖥️ **TUI Interactive**: Browser interattivo (`ph browse`) per gestire la cronologia.

## Installazione

```bash
# Clone e build locale
git clone git@github.com:gi4nks/ph.git
cd ph
npm install
make build
make install # Installa il link globale 'ph'
```

## Configurazione

Il tool utilizza un file di configurazione in `~/.ph_config.json`.

```bash
ph config set gemini-api-key "TUA_CHIAVE"
ph config set analyze-provider gemini # o 'ollama' (default)
ph config set background-analysis true  # Abilita auto-analisi
```

## Hooks (Integrazione con AI CLI)

Gli hooks permettono a `ph` di intercettare i prompt inviati ad altri strumenti. Sono script che wrappano l'esecuzione dell'AI CLI scelta.

### Come funzionano
Gli hooks si trovano nella cartella `hooks/`. Ogni hook esporta una funzione o agisce come wrapper PTY per mantenere l'interattività dell'AI CLI originale catturando al contempo i dati.

### Installazione Hooks

#### Per Gemini CLI:
Aggiungi questo alias al tuo `.zshrc` o `.bashrc`:
```bash
alias gemini='/path/to/ph/hooks/gemini/ph-hook.sh'
```

#### Per Claude CLI:
Aggiungi questo alias:
```bash
alias claude='/path/to/ph/hooks/claude/ph-hook.sh'
```

L'hook eseguirà `ph capture` prima di passare il controllo all'AI CLI originale, salvando il contesto Git corrente e il prompt inviato.

## Utilizzo

### Ricerca
```bash
ph search "come fare refactor"     # Ricerca testuale
ph search --semantic "refactoring" # Ricerca semantica
```

### Browser TUI
```bash
ph browse
```
*Tasti rapidi:* `f` (filtri), `e` (edit metadati), `r` (rerun prompt), `y` (copia), `x` (elimina).

## Rilasci e Versioning

Il progetto segue il **Semantic Versioning (SemVer)** e utilizza le [Conventional Commits](https://www.conventionalcommits.org/). I rilasci sono gestiti tramite `standard-version`.

### Comandi di Rilascio
Per creare una nuova versione (aggiorna `package.json`, genera `CHANGELOG.md` e crea un tag Git):

```bash
make release-patch  # Incremeta: 0.1.0 -> 0.1.1 (fix e piccole modifiche)
make release-minor  # Incremeta: 0.1.1 -> 0.2.0 (nuove feature compatibili)
make release-major  # Incremeta: 0.2.0 -> 1.0.0 (modifiche breaking)
```

Dopo il rilascio, ricordati di pushare i tag:
```bash
git push --follow-tags origin main
```

## Esportazione
```bash
ph export --format md --limit 5 > prompts.md
```
