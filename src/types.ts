export interface PromptEntry {
  id: number;
  timestamp: string;
  tool: string;
  prompt: string;
  response: string;
  args: string;
  workdir: string;
  hostname: string;
  exit_code: number;
  metadata: string;
}

export interface ArchivedPromptEntry extends PromptEntry {
  archived_at: string;
  original_id: number | null;
}

export interface PromptMetadata {
  $schema_version?: number;
  title?: string;
  project?: string;
  language?: string;
  role?: string;
  tags?: string[];
  starred?: boolean;
  relevance?: number;
  quality?: number;
  technical_decisions?: string[];
  git_context?: { branch: string; files: string[]; diff: string };
  summary?: string;
  key_insights?: string[];
  analysis_status?: 'pending' | 'complete' | 'failed';
  analysis_error?: 'worker_launch_failed' | 'provider_unavailable' | 'analysis_failed' | 'analysis_persistence_failed';
  remote_sync_status?: 'pending' | 'complete' | 'failed';
  remote_sync_error?: 'push_failed' | 'invalid_remote_url';
  remote_sync_target?: string;
  capture_status?: 'in_progress';
  capture_owner_pid?: number;
}

export interface MemoryEntry {
  id: number;
  project: string;
  prompt_ids: number[];
  summary: string;
  key_insights: string[];
  technical_decisions: string[];
  git_context_snapshot?: string;
  created_at: string;
  updated_at: string;
  access_count: number;
  last_accessed?: string;
}

export interface ProjectSummary {
  project: string;
  summary: string;
  key_insights: string[];
  technical_decisions: string[];
  prompt_count: number;
  first_analyzed: string;
  last_analyzed: string;
  git_context_snapshot?: string;
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
