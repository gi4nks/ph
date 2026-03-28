# Claude Code Hook for ph

Questo hook permette a Claude Code di salvare automaticamente ogni prompt e risposta nel database di `ph`.

## Installazione

1. Assicurati che `ph` sia installato e funzionante.
2. Crea un link simbolico dello script nella cartella di configurazione di Claude:

```bash
ln -sf "$(pwd)/ph-hook.sh" ~/.claude/ph-hook.sh
chmod +x ~/.claude/ph-hook.sh
```

## Configurazione Claude Code

Aggiungi (o aggiorna) la sezione `hooks` nel tuo file `~/.claude/settings.json`:

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

**Nota:** Assicurati che il percorso nel comando punti correttamente al link simbolico o allo script reale. Usando il link simbolico in `~/.claude/ph-hook.sh`, la configurazione rimane portabile.

## Come funziona

Lo script viene eseguito da Claude Code all'evento `Stop` (fine di un exchange). 
1. Legge il transcript della sessione corrente.
2. Estrae l'ultimo prompt dell'utente e l'ultima risposta dell'assistente.
3. Invia i dati a `ph log` in background.
