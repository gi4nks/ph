/**
 * Extracts a short, meaningful title from raw prompt text.
 * Always returns a non-empty string (fallback: first 72 characters, truncated).
 */
export function extractTopic(prompt: string): string {
  // 1. Trim leading and trailing whitespace and newlines.
  let text = prompt.trim();

  // Edge case: empty prompt or whitespace only.
  if (!text) {
    return '(empty prompt)';
  }

  // Edge case: prompt contains only code (starts with ``` or `).
  // Return the first 72 characters of the trimmed original text.
  if (text.startsWith('```') || text.startsWith('`')) {
    return truncateAtWordBoundary(text, 72);
  }

  const originalTrimmed = text;

  // 2. MARKDOWN HEADING
  // If the text starts with one or more # characters followed by a space, extract the heading text.
  if (text.startsWith('#')) {
    const headingMatch = text.match(/^#+\s+(.*?)(?:\s+#+)?(?:\n|$)/);
    if (headingMatch && headingMatch[1]) {
      text = headingMatch[1].trim();
    }
  }

  // 3. PREFIXES TO REMOVE (case-insensitive, English and Italian)
  const prefixes = [
    // English
    'please, ', 'please ', 'can you please ', 'could you please ',
    'can you ', 'could you ', 'would you ',
    'i need you to ', 'i need to ', 'i want you to ', 'i want to ',
    'i\'d like you to ', 'i\'d like to ',
    'help me to ', 'help me ', 'i need ',
    'claude, ', 'gemini, ', 'chatgpt, ',
    // Italian
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
        break; // Restart the loop after removing a prefix.
      }
    }
  }

  // 4. FIRST MEANINGFUL SENTENCE
  // Keep the text up to the first period, question mark, exclamation mark, newline, or code backtick.
  const sentenceEndMatch = text.match(/[\n.?!`]/);
  if (sentenceEndMatch && sentenceEndMatch.index !== undefined) {
    text = text.slice(0, sentenceEndMatch.index).trim();
  }

  // Fall back if the result is empty after transformations.
  if (!text) {
    return truncateAtWordBoundary(originalTrimmed, 72);
  }

  // 5. TRUNCATE to a maximum of 72 characters.
  text = truncateAtWordBoundary(text, 72);

  // 6. Capitalize the first letter.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Truncate at the last space within the character limit.
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

// test: extractTopic("## PROMPT 4 — Phase 4: Refactor BrowseApp ##\n\nThe main file is...") -> "Phase 4: Refactor BrowseApp"
// test: extractTopic("please help me fix the TypeScript error in the auth middleware, the types...") -> "Fix the TypeScript error in the auth middleware"
// test: extractTopic("can you fix the bug in the ListEntry component when paneWidth is zero?") -> "Fix the bug in the ListEntry component when paneWidth is zero"
// test: extractTopic("I need you to refactor this function to use async/await instead of callbacks") -> "Refactor this function to use async/await instead of callbacks"
// test: extractTopic("claude, I don't like PH's UI. Not at all.") -> "I don't like PH's UI"
// test: extractTopic("  \n\nPlease review this code:\n\n```typescript\nfunction foo() {...") -> "Review this code"
