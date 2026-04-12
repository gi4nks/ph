/**
 * Estrae un titolo breve e significativo dal testo grezzo di un prompt.
 * Restituisce sempre una stringa non vuota (fallback: primi 72 char troncati).
 */
export function extractTopic(prompt: string): string {
  // 1. Trim whitespace e newline iniziali/finali.
  let text = prompt.trim();

  // Edge cases: Prompt vuoto o solo whitespace
  if (!text) {
    return '(empty prompt)';
  }

  // Edge cases: Testo solo in codice (comincia con ``` o `)
  // Restituisce i primi 72 char del testo originale trimmato.
  if (text.startsWith('```') || text.startsWith('`')) {
    return truncateAtWordBoundary(text, 72);
  }

  const originalTrimmed = text;

  // 2. MARKDOWN HEADING
  // Se il testo inizia con uno o più # seguiti da spazio, estrai il testo del heading.
  if (text.startsWith('#')) {
    const headingMatch = text.match(/^#+\s+(.*?)(?:\s+#+)?(?:\n|$)/);
    if (headingMatch && headingMatch[1]) {
      text = headingMatch[1].trim();
    }
  }

  // 3. PREFISSI DA RIMUOVERE (case-insensitive, inglese + italiano)
  const prefixes = [
    // English
    'please, ', 'please ', 'can you please ', 'could you please ',
    'can you ', 'could you ', 'would you ',
    'i need you to ', 'i need to ', 'i want you to ', 'i want to ',
    'i\'d like you to ', 'i\'d like to ',
    'help me to ', 'help me ', 'i need ',
    'claude, ', 'gemini, ', 'chatgpt, ',
    // Italiano
    'puoi ', 'potresti ', 'potreste ',
    'per favore ', 'per piacere ',
    'ho bisogno che ', 'ho bisogno di ',
    'voglio che ', 'vorrei che ', 'voglio ', 'vorrei ',
    'aiutami a ', 'aiutami ',
    'fammi vedere ', 'fammi ',
    'si prega di ', 'si ',
  ];

  let changed = true;
  while (changed) {
    changed = false;
    const lowerText = text.toLowerCase();
    for (const prefix of prefixes) {
      if (lowerText.startsWith(prefix.toLowerCase())) {
        text = text.slice(prefix.length).trim();
        changed = true;
        break; // Ricomincia il loop dopo la rimozione
      }
    }
  }

  // 4. PRIMA FRASE SIGNIFICATIVA
  // Prendi il testo fino al primo . ? ! o newline o backtick (codice)
  const sentenceEndMatch = text.match(/[\n.?!`]/);
  if (sentenceEndMatch && sentenceEndMatch.index !== undefined) {
    text = text.slice(0, sentenceEndMatch.index).trim();
  }

  // Fallback se il risultato è vuoto dopo le trasformazioni
  if (!text) {
    return truncateAtWordBoundary(originalTrimmed, 72);
  }

  // 5. TRUNCATE a max 72 caratteri
  text = truncateAtWordBoundary(text, 72);

  // 6. Capitalizza la prima lettera
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Troncamento intelligente all'ultimo spazio entro il limite.
 */
function truncateAtWordBoundary(str: string, limit: number): string {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  
  const sub = clean.slice(0, limit);
  const lastSpace = sub.lastIndexOf(' ');
  
  if (lastSpace > 0) {
    return sub.slice(0, lastSpace);
  }
  return sub;
}

// test: extractTopic("## PROMPT 4 — Fase 4: Refactor BrowseApp ##\n\nIl file principale è...") -> "Fase 4: Refactor BrowseApp"
// test: extractTopic("please help me fix the TypeScript error in the auth middleware, the types...") -> "Fix the TypeScript error in the auth middleware"
// test: extractTopic("puoi sistemare il bug nel componente ListEntry quando il paneWidth è zero?") -> "Sistemare il bug nel componente ListEntry quando il paneWidth è zero"
// test: extractTopic("I need you to refactor this function to use async/await instead of callbacks") -> "Refactor this function to use async/await invece di callbacks"
// test: extractTopic("claude, l'interfaccia ui di ph non mi piace. per niente.") -> "L'interfaccia ui di ph non mi piace"
// test: extractTopic("  \n\nPlease review this code:\n\n```typescript\nfunction foo() {...") -> "Review this code"
