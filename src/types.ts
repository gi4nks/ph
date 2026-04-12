export interface PromptEntry {
  id: number;
  timestamp: string; // ISO-8601 string, stored as TEXT in SQLite
  tool: string;
  prompt: string;
  response: string;  // AI response text, empty string if not captured
  args: string;
  workdir: string;
  hostname: string;
  exit_code: number;
  metadata: string; // JSON string: { project?, language?, tags?, starred? }
}

export interface PromptMetadata {
  title?: string;       // ← NUOVO: titolo breve estratto o impostato manualmente
  project?: string;
  language?: string;
  role?: string;        // e.g. 'debug', 'refactor', 'explain', 'review', 'architect', 'test', 'docs'
  tags?: string[];
  starred?: boolean;
  relevance?: number;   // 0-10: LLM-assigned usefulness score
  quality?: number;     // 0-10: LLM-assigned prompt engineering quality score
  git_context?: { branch: string; files: string[]; diff: string };
}

export interface SearchOptions {
  query?: string;
  tool?: string;
  project?: string;
  language?: string;    // filter by detected/set language
  role?: string;        // filter by role
  tag?: string;         // filter by single tag (prompt must contain it)
  starred?: boolean;
  minQuality?: number;
  minRelevance?: number;
  since?: Date;
  until?: Date;
  limit: number;
  semantic?: boolean;
}

export interface ImportResult {
  filesScanned: number;
  promptsFound: number;
  promptsImported: number;
  skipped: number;
  filtered: number;
  errors: string[];
}
