import { getEmbeddings } from '../embedding/index.js';
import { getProjectContext } from '../context/index.js';
import type { ProjectContextOptions } from '../context/index.js';
import type { ProjectContext, ProjectContextStore } from '../context/index.js';
import type { PhConfig } from '../config/index.js';

export async function retrieveTaskContext(
  db: ProjectContextStore,
  cfg: Pick<PhConfig, 'ollamaUrl' | 'ollamaEmbedModel'>,
  project: string,
  task: string,
  limit: number,
  options: Pick<ProjectContextOptions, 'includeSummary' | 'includeMemories' | 'includePrompts'> = {},
): Promise<{ context: ProjectContext; fallbackReason?: string }> {
  try {
    const context = await getProjectContext(db, { project, query: task, limit, memoryLimit: limit, ...options }, async query => {
      const [vector] = await getEmbeddings(
        [`${project}: ${query}`],
        cfg.ollamaUrl ?? 'http://localhost:11434',
        cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe',
        1,
      );
      if (!vector?.length) throw new Error('Embedding provider returned no vector');
      return vector;
    });
    return { context };
  } catch (error) {
    const context = await getProjectContext(db, { project, limit, memoryLimit: limit, ...options });
    return { context, fallbackReason: (error as Error).message };
  }
}
