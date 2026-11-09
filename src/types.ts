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
  analysis_error?: 'worker_launch_failed' | 'provider_unavailable' | 'provider_out_of_memory' | 'provider_request_failed' | 'analysis_response_invalid' | 'analysis_failed' | 'analysis_persistence_failed';
  remote_sync_status?: 'pending' | 'complete' | 'failed';
  remote_sync_error?: 'push_failed' | 'invalid_remote_url';
  remote_sync_target?: string;
  automatic_memory_status?: 'pending' | 'complete' | 'empty' | 'failed' | 'undone';
  automatic_memory_error?: 'worker_launch_failed' | 'provider_unavailable' | 'analysis_failed' | 'save_failed';
  automatic_memory_ids?: string[];
  capture_status?: 'in_progress';
  capture_owner_pid?: number;
}

export type MemoryScope = 'project' | 'work' | 'personal';
export type MemoryKind = 'decision' | 'insight' | 'preference' | 'fact';
export type MemoryStatus = 'active' | 'forgotten';

/** Unified, source-linked memory entry backed by SQLite + FTS5. */
export interface MemoryEntry {
  id: number;
  content: string;
  scope: MemoryScope;
  project: string;
  kind: MemoryKind;
  prompt_ids: number[];
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
  sensitivity: 'normal' | 'sensitive';
  source: string;
  source_ref?: string;
  external_id?: string;
  forgotten_at?: string;
}

export interface SearchOptions {
  query?: string;
  tool?: string;
  project?: string;
  language?: string;
  role?: string;
  tag?: string;
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
  importedIds?: number[];
}
