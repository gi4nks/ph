# Gemini CLI Hook for ph

Questo hook permette a Gemini CLI di salvare automaticamente ogni prompt e risposta nel database di `ph`.

## Installazione

1. Assicurati che `ph` sia installato e funzionante.
2. Crea un link simbolico dello script nella cartella di configurazione di Gemini:

```bash
ln -sf "$(pwd)/ph-hook.sh" ~/.gemini/ph-hook.sh
chmod +x ~/.gemini/ph-hook.sh
```

## Configurazione Gemini CLI

Aggiungi (o aggiorna) la sezione `hooks` nel tuo file `~/.gemini/settings.json`:

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

**Nota:** Assicurati che il percorso nel comando punti correttamente al link simbolico o allo script reale. Usando il link simbolico in `~/.gemini/ph-hook.sh`, la configurazione rimane portabile.

## Come funziona

Lo script viene eseguito da Gemini CLI all'evento `AfterAgent` (dopo ogni risposta dell'agente).
1. Riceve l'input JSON da Gemini CLI contenente prompt e risposta.
2. Estrae il prompt dell'utente e la risposta dell'assistente.
3. Invia i dati a `ph log` in background.
