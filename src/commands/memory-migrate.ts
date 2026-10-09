import { PhDB } from '../db/index.js';

export function cmdMemoryMigrate(db: PhDB): void {
  const projects = db.getAllProjectsWithMemories();
  if (projects.length === 0) {
    console.log('No memories found. Nothing to migrate.');
    return;
  }

  let count = 0;
  for (const project of projects) {
    const memories = db.searchMemories(project, 1000);
    const allInsights = new Set<string>();
    const allDecisions = new Set<string>();
    let lastSummary = '';
    let gitCtx: string | undefined;

    for (const mem of memories) {
      if (mem.summary) lastSummary = mem.summary;
      for (const i of mem.key_insights) allInsights.add(i);
      for (const d of mem.technical_decisions) allDecisions.add(d);
      if (mem.git_context_snapshot) gitCtx = mem.git_context_snapshot;
    }

    db.upsertProjectSummary({
      project,
      summary: lastSummary,
      key_insights: [...allInsights],
      technical_decisions: [...allDecisions],
      git_context_snapshot: gitCtx,
    });
    count++;
  }

  console.log(`Migrated ${count} project(s) into project_summaries.`);
}
