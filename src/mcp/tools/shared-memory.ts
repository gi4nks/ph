import { z } from 'zod';
import type { PhConfig } from '../../config/index.js';
import { saveHubMemory, searchHubMemoryRecords } from '../../commands/memory-hub.js';

export async function handleSharedMemoryTool(name: string, args: unknown, cfg: PhConfig) {
  if (name === 'search_shared_memory') {
    const { query, scope = 'project', limit = 5 } = z.object({
      query: z.string().min(1).max(500),
      scope: z.enum(['work', 'project']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }).parse(args);
    const memories = (await searchHubMemoryRecords(cfg, query, scope, limit))
      .filter(memory => memory.sensitivity !== 'sensitive' && (memory.scope === 'work' || memory.scope === 'project'));
    if (!memories.length) return { content: [{ type: 'text' as const, text: 'No matching shared PH memories.' }] };
    const lines = memories.map(memory => `- ${memory.content} [${memory.scope}/${memory.kind}; source: ${memory.source}${memory.source_ref ? ` · ${memory.source_ref}` : ''}; id: ${memory.id}]`);
    return { content: [{ type: 'text' as const, text: `# Shared PH memory\n${lines.join('\n')}` }] };
  }

  if (name === 'save_shared_memory') {
    const input = z.object({
      content: z.string().trim().min(1).max(8000),
      scope: z.enum(['work', 'project']),
      kind: z.string().trim().min(1).max(80),
      source_ref: z.string().trim().min(1).max(500),
    }).parse(args);
    const id = await saveHubMemory(cfg, {
      content: input.content,
      scope: input.scope,
      kind: input.kind,
      source: 'mcp-coding-agent',
      source_ref: input.source_ref,
    });
    return { content: [{ type: 'text' as const, text: `Saved shared PH memory ${id} with source ${input.source_ref}.` }] };
  }

  return undefined;
}
