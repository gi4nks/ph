import type { PhDB } from '../db/index.js';
import type { PromptMetadata } from '../types.js';

export type PromptMetadataPatch = { [K in keyof PromptMetadata]?: PromptMetadata[K] | null };

export function patchPromptMetadata(db: Pick<PhDB, 'updateMetadataFields'>, id: number, patch: PromptMetadataPatch): void {
  db.updateMetadataFields(id, patch as Record<string, unknown>);
}

export function getAnalysisStatus(metadata: PromptMetadata): string {
  if (metadata.analysis_status) return metadata.analysis_status;
  if (metadata.summary || metadata.key_insights?.length || metadata.technical_decisions?.length || metadata.quality !== undefined || metadata.relevance !== undefined) return 'complete';
  return 'not analyzed';
}

export function getRemoteSyncStatus(metadata: PromptMetadata, configured: boolean): string {
  if (metadata.remote_sync_status) return metadata.remote_sync_status;
  return configured ? 'unknown (legacy record)' : 'not configured';
}
