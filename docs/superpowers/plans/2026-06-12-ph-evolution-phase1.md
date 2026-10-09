# Phase 1: Memory Merging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Create `project_summaries` table (1 row per project, merged/deduped knowledge), migrate existing `memories` into it, update analysis pipeline and MCP tools to use it.

**Architecture:** New table `project_summaries` alongside existing `memories`. Analysis writes to BOTH tables (append-only `memories` for timeline, merged `project_summaries` for curated knowledge). MCP reads from `project_summaries` by default. One-time migration aggregates existing per-project memories into single rows.

**Tech Stack:** TypeScript 5.9 ESM, better-sqlite3, sqlite-vec

## Global Constraints

- ESM only — all imports use `.js` extension
- `better-sqlite3` for DB operations (synchronous API)
- All new methods on `PhDB` class in `src/db/index.ts`
- Follow existing patterns: snake_case column names, camelCase JS methods
- Existing `memories` table and `MemoryEntry` type remain unchanged
- Build passes after every task: `npm run build`

---
### Task 1: `ProjectSummary` type + `project_summaries` table schema + auto-migration

**Files:**
- Modify: `src/types.ts` (add `ProjectSummary` interface)
- Modify: `src/db/index.ts` (add table creation in `ensureSchema`, add `PROJECT_SUMMARIES_SCHEMA`)

**Interfaces:**
- Consumes: nothing other than the existing `PhDB` constructor pattern
- Produces: `ProjectSummary` type, `project_summaries` table created on DB open

- [ ] **Step 1: Add `ProjectSummary` interface to `src/types.ts`**

Append after `MemoryEntry` interface:

```typescript
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
```

- [ ] **Step 2: Add SQL CREATE + migration to `src/db/index.ts`**

At the top of the PhDB class, add the schema constant:

```typescript
private static readonly PROJECT_SUMMARIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS project_summaries (
    project     TEXT    PRIMARY KEY,
    summary     TEXT    NOT NULL DEFAULT '',
    key_insights TEXT   NOT NULL DEFAULT '[]',
    technical_decisions TEXT NOT NULL DEFAULT '[]',
    prompt_count INTEGER NOT NULL DEFAULT 0,
    first_analyzed TEXT  NOT NULL,
    last_analyzed TEXT   NOT NULL,
    git_context_snapshot TEXT
  );
`;
```

In the `ensureSchema()` method, add after the `memories` table creation:

```typescript
this.db.exec(PhDB.PROJECT_SUMMARIES_SCHEMA);
```

- [ ] **Step 3: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/db/index.ts
git commit -m "feat: add project_summaries table and ProjectSummary type"
```

---
### Task 2: `upsertProjectSummary()` + `getProjectSummary()` methods on PhDB

**Files:**
- Modify: `src/db/index.ts` (add methods, add private hydrate helper)

**Interfaces:**
- Produces: `db.upsertProjectSummary(params)` — merges into existing row or inserts new; `db.getProjectSummary(project)` — returns single row or null; `db.getAllProjectsWithSummaries()` — for migration

- [ ] **Step 1: Add `upsertProjectSummary()` and `getProjectSummary()`**

Add after `getAllProjectsWithMemories()` (around line 527):

```typescript
upsertProjectSummary(params: {
  project: string;
  summary: string;
  key_insights: string[];
  technical_decisions: string[];
  git_context_snapshot?: string;
}): void {
  const existing = this.getProjectSummary(params.project);
  const now = new Date().toISOString();

  if (existing) {
    // Merge insights — dedup by string equality
    const allInsights = new Set([...existing.key_insights, ...params.key_insights]);
    // Merge decisions — dedup by string equality
    const allDecisions = new Set([...existing.technical_decisions, ...params.technical_decisions]);

    this.db.prepare(`
      UPDATE project_summaries
      SET summary = ?,
          key_insights = ?,
          technical_decisions = ?,
          prompt_count = prompt_count + 1,
          last_analyzed = ?,
          git_context_snapshot = COALESCE(?, git_context_snapshot)
      WHERE project = ?
    `).run(
      params.summary,
      JSON.stringify([...allInsights]),
      JSON.stringify([...allDecisions]),
      now,
      params.git_context_snapshot || null,
      params.project
    );
  } else {
    this.db.prepare(`
      INSERT INTO project_summaries (project, summary, key_insights, technical_decisions, prompt_count, first_analyzed, last_analyzed, git_context_snapshot)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      params.project,
      params.summary,
      JSON.stringify(params.key_insights),
      JSON.stringify(params.technical_decisions),
      now,
      now,
      params.git_context_snapshot || null
    );
  }
}

getProjectSummary(project: string): ProjectSummary | null {
  const row = this.db.prepare('SELECT * FROM project_summaries WHERE project = ?').get(project) as Record<string, unknown> | undefined;
  if (!row) return null;
  return this.hydrateProjectSummary(row);
}

getAllProjectsWithSummaries(): string[] {
  const rows = this.db.prepare('SELECT project FROM project_summaries ORDER BY project').all() as { project: string }[];
  return rows.map(r => r.project);
}
```

- [ ] **Step 2: Add `hydrateProjectSummary()` private method**

Add after `hydrateMemory()`:

```typescript
private hydrateProjectSummary(row: Record<string, unknown>): ProjectSummary {
  return {
    project: row.project as string,
    summary: row.summary as string,
    key_insights: JSON.parse(row.key_insights as string),
    technical_decisions: JSON.parse(row.technical_decisions as string),
    prompt_count: row.prompt_count as number,
    first_analyzed: row.first_analyzed as string,
    last_analyzed: row.last_analyzed as string,
    git_context_snapshot: row.git_context_snapshot as string | undefined,
  };
}
```

- [ ] **Step 3: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add upsertProjectSummary and getProjectSummary to PhDB"
```

---
### Task 3: One-time migration command — merge existing memories into summaries

**Files:**
- Create: `src/commands/memory-migrate.ts`
- Modify: `src/cli.ts` (register `memory-migrate` command)

**Interfaces:**
- Consumes: `db.upsertProjectSummary()`, `db.searchMemories()` — already exist
- Produces: `ph memory-migrate` CLI command that aggregates all existing memories into project_summaries

- [ ] **Step 1: Create `src/commands/memory-migrate.ts`**

```typescript
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
```

- [ ] **Step 2: Register `memory-migrate` in `src/cli.ts`**

Add import at top:
```typescript
import { cmdMemoryMigrate } from './commands/memory-migrate.js';
```

Add to usage string (after `mcp` line):
```
  ph memory-migrate                      Merge existing memories into project_summaries
```

Add case before `case 'mcp'`:
```typescript
    case 'memory-migrate':
      cmdMemoryMigrate(db);
      break;
```

- [ ] **Step 3: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Run migration**

Run: `node dist/cli.js memory-migrate`
Expected: "Migrated X project(s) into project_summaries."

- [ ] **Step 5: Commit**

```bash
git add src/commands/memory-migrate.ts src/cli.ts
git commit -m "feat: add ph memory-migrate command"
```

---
### Task 4: Update analysis pipeline to write to BOTH tables

**Files:**
- Modify: `src/analyzer/index.ts` (update `analyzeAll`)
- Modify: `src/commands/background-analyze.ts` (update `cmdBackgroundAnalyze`)

**Interfaces:**
- Consumes: `db.upsertProjectSummary()` from Task 2
- Produces: After each analysis, both `memories` (append-only) AND `project_summaries` (merged) get updated

- [ ] **Step 1: Update `analyzeAll` in `src/analyzer/index.ts`**

Find the block around line 225-234 where `db.upsertProjectMemory()` is called. Add `db.upsertProjectSummary()` call after it:

```typescript
        if (result.project && result.summary) {
          db.upsertProjectMemory({
            project: result.project,
            prompt_id: entry.id,
            summary: result.summary,
            key_insights: result.key_insights ?? [],
            technical_decisions: result.technical_decisions ?? [],
          });
          // Also update the merged project summary
          db.upsertProjectSummary({
            project: result.project,
            summary: result.summary,
            key_insights: result.key_insights ?? [],
            technical_decisions: result.technical_decisions ?? [],
          });
        }
```

- [ ] **Step 2: Update `cmdBackgroundAnalyze` in `src/commands/background-analyze.ts`**

Find the block around line 36-43 where `db.upsertProjectMemory()` is called. Add `db.upsertProjectSummary()` after it:

```typescript
    if (result.project && result.summary) {
      db.upsertProjectMemory({
        project: result.project,
        prompt_id: id,
        summary: result.summary,
        key_insights: result.key_insights ?? [],
        technical_decisions: result.technical_decisions ?? [],
      });
      db.upsertProjectSummary({
        project: result.project,
        summary: result.summary,
        key_insights: result.key_insights ?? [],
        technical_decisions: result.technical_decisions ?? [],
      });
    }
```

- [ ] **Step 3: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/analyzer/index.ts src/commands/background-analyze.ts
git commit -m "feat: write to project_summaries from analysis pipeline"
```

---
### Task 5: Update MCP tools to read from `project_summaries`

**Files:**
- Modify: `src/mcp/server.ts` (update `get_project_summary` and `get_project_context` tools)

**Interfaces:**
- Consumes: `db.getProjectSummary()` from Task 2
- Produces: MCP tools return merged knowledge from `project_summaries` instead of raw `memories`

- [ ] **Step 1: Update `get_project_summary` tool handler**

Replace the current implementation (reads from `memories`) with code that reads from `project_summaries`:

```typescript
      if (name === "get_project_summary") {
        const { project } = z.object({
          project: z.string(),
        }).parse(args);

        const summary = db.getProjectSummary(project);

        if (!summary) {
          return {
            content: [{ type: "text", text: `No accumulated knowledge for project "${project}". Run "ph analyze" to generate insights.` }],
          };
        }

        const parts: string[] = [];
        parts.push(`## ${summary.summary || 'Project Memory'}\n`);
        parts.push(`Based on ${summary.prompt_count} interactions.\n`);
        if (summary.key_insights.length > 0) {
          parts.push('**Key Insights:**');
          for (const i of summary.key_insights) parts.push(`- ${i}`);
          parts.push('');
        }
        if (summary.technical_decisions.length > 0) {
          parts.push('**Technical Decisions:**');
          for (const d of summary.technical_decisions) parts.push(`- ${d}`);
          parts.push('');
        }

        return {
          content: [{ type: "text", text: parts.join('\n') }],
        };
      }
```

- [ ] **Step 2: Update `get_project_context` tool handler**

Modify to also include merged summary from `project_summaries`. Around line 107-143, before reading memories, check for merged summary:

```typescript
      if (name === "get_project_context") {
        const { project, limit = 10 } = z.object({
          project: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const parts: string[] = [];

        // Start with merged project summary if available
        const merged = db.getProjectSummary(project);
        if (merged) {
          parts.push('## Project Knowledge (merged)\n');
          if (merged.summary) parts.push(`${merged.summary}\n`);
          if (merged.key_insights.length > 0) {
            parts.push('Key Insights:');
            for (const i of merged.key_insights) parts.push(`  - ${i}`);
            parts.push('');
          }
          if (merged.technical_decisions.length > 0) {
            parts.push('Technical Decisions:');
            for (const d of merged.technical_decisions) parts.push(`  - ${d}`);
            parts.push('');
          }
        }

        // Also pull recent memories (detailed entries)
        const memories = db.searchMemories(project, 3);
        if (memories.length > 0) {
          if (parts.length > 0) parts.push('---\n');
          parts.push('## Recent Memory Entries\n');
          for (const mem of memories) {
            if (mem.summary) parts.push(`- ${mem.summary}`);
          }
          parts.push('');
        }

        const prompts = db.getProjectMemory(project, limit);
        if (prompts.length > 0) {
          if (parts.length > 0) parts.push('---\n');
          parts.push('## Recent Interactions\n');
          parts.push(formatResultsAsMarkdown(prompts));
        }

        return {
          content: [{ type: "text", text: parts.join('\n') || 'No context found for this project.' }],
        };
      }
```

- [ ] **Step 3: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: MCP tools read from project_summaries"
```

---
## Self-Review Checklist

- **Spec coverage:** All Phase 1 items covered: table creation complete, upsert/get methods complete, migration complete, analysis pipeline updates complete, MCP tool updates complete
- **Placeholder scan:** No TBD, TODO, or incomplete code blocks
- **Type consistency:** `ProjectSummary` interface consistent across all tasks: `project`, `summary`, `key_insights[]`, `technical_decisions[]`, `prompt_count`, `first_analyzed`, `last_analyzed`, `git_context_snapshot?`
