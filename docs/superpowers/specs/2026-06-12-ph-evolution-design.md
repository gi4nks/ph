# ph Evolution: Curated Knowledge System

**Date:** 2026-06-12
**Status:** Design approved

## Vision

ph evolves from a passive logger into a **curated knowledge base** for AI-assisted development. It keeps only distilled, meaningful information — condensed memories and significant prompts — while automatically pruning noise. The MCP server becomes the primary interface for agents; the TUI/CLI remain for exploration and management.

**Core principle:** *ph should shrink, not grow.* Every week the knowledge becomes more compact and more valuable, not larger and noisier.

## Problem Statement

### Current Issues
1. **Append-only memories**: each analysis creates a new row in `memories`. Same project → 10+ near-identical rows saying the same thing.
2. **Unlimited prompt storage**: every captured prompt lives forever. Signal-to-noise ratio degrades daily.
3. **No retention policy**: starred and analyzed prompts are treated identically to throwaway interactions.
4. **MCP is an afterthought**: the most valuable interface (agent-facing) is treated as "one more tool" instead of the primary consumer.

### Desired State (3 months)
- ph's database is **stable in size** (~a few MB), not growing linearly with usage
- Each project has **one curated summary** with accumulated key insights and technical decisions
- Old/irrelevant prompts are **automatically archived** after configurable TTL
- Agents get **relevant, compact context** via MCP — no noise, no duplicates
- The user **never worries about bloat** — it's self-maintaining

## Design

### 1. Memory Merging (Hybrid Model)

Two levels of memory per project:

#### 1a. `project_summary` — Single curated row per project

| Column | Description |
|--------|-------------|
| `project` | Project name (PK) |
| `summary` | Cumulated project description (concatenated + condensed) |
| `key_insights` | Merged JSON array of unique insights |
| `technical_decisions` | Merged JSON array of unique decisions |
| `prompt_count` | Number of prompts that contributed |
| `first_analyzed` | Timestamp of first analysis |
| `last_analyzed` | Timestamp of last update |
| `git_context` | Latest git context snapshot |

**Behavior:**
- `upsertProjectSummary()`: 
  - Look up existing row by `project`
  - If found: merge `key_insights` (dedup by similarity threshold), merge `technical_decisions` (dedup), update `summary` (newest wins or concatenate), increment `prompt_count`, update `last_analyzed`
  - If not found: insert new row
- This is a **new table** (`project_summaries`), keeping existing `memories` table intact

#### 1b. `memories` — Keep append-only for timeline, but add TTL

Existing `memories` table remains append-only for detailed history. But entries older than N days without access get pruned.

#### Migration
- Create `project_summaries` table
- Run one-time merge: for each project in `memories`, aggregate all entries into one `project_summaries` row
- New analyses write to BOTH `memories` AND `project_summaries`
- After migration, MCP tools read from `project_summaries` by default

### 2. Prompt Pruning & Retention

#### Retention Rules (configurable via `ph config`)

| Config key | Default | Description |
|-----------|---------|-------------|
| `retentionDays` | 90 | Auto-archive prompts older than N days |
| `retentionMinStarred` | true | Starred prompts are never auto-archived |
| `retentionMinAnalyzed` | true | Analyzed prompts are never auto-archived |
| `retentionMinRelevance` | 3 | Prompts with relevance < N are pruned first |

#### Archive mechanism

- New table: `prompts_archive` (same schema as `prompts`)
- `ph cleanup --retention` moves old/unqualified prompts to `prompts_archive`
- Archive can be queried with `ph search --archive`
- Archive can be purged with `ph vacuum --purge-archive`
- A background TUI indicator shows when archiving is needed

#### Pruning priority (ph cleanup run order)

1. Duplicate prompts (exact content match within 7 days) → delete
2. Relevance < `retentionMinRelevance` AND age > `retentionDays` → archive
3. Age > `retentionDays` AND not starred AND not analyzed → archive
4. Archived entries older than 2x `retentionDays` → auto-purge (configurable)

### 3. MCP as Primary Interface

#### New MCP Tools

| Tool | Description |
|------|-------------|
| `check_project_knowledge` | Before implementing: returns what ph knows (merged summary + semantic search). Returns "no knowledge" if none found. |
| `save_decision` | Agents call this after making a technical decision. Writes directly to `project_summaries`. |

#### Enhanced existing tools

- `get_project_summary` now reads from `project_summaries` (merged knowledge)
- `search_project_memory` falls back to `project_summaries` if no semantic results
- `get_project_context` returns merged summary + recent prompts from last 7 days

### 4. CLI Commands

| Command | Description |
|---------|-------------|
| `ph cleanup --retention` | Archive prompts per retention policy |
| `ph cleanup --merge-memories` | One-time merge all `memories` → `project_summaries` |
| `ph memory-migrate` | Create `project_summaries` table + merge existing data |
| `ph config set retentionDays 60` | Configure retention |

### 5. TUI Enhancements

- Settings panel (already done) → add retention config fields
- Status indicator in header: "142 prompts (23 archived)"
- Filter option: `--archived` or view archived prompts

## Data Flow

```
Hook/Import → ph log → prompts table
                              ↓
                    [background analysis]
                              ↓
              ┌────────────────┴────────────────┐
              ↓                                 ↓
        memories (append-only,           project_summaries
        with TTL)                        (single row per project,
                                          cumulated + deduped)
              ↓                                 ↓
        [ph cleanup --retention]          MCP tools read
        → prompts_archive                 from here by default
```

## Migration Path

### Phase 1: Foundation (now)
1. Create `project_summaries` table in PhDB
2. Add `upsertProjectSummary()` method
3. Run one-time merge: for each project, aggregate all `memories` rows into one `project_summaries` row
4. Update `_bg-analyze` and `analyzeAll` to write to BOTH tables

### Phase 2: Retention (next)
1. Create `prompts_archive` table
2. Add retention logic to `ph cleanup`
3. Add `retentionDays`, `retentionMinStarred`, `retentionMinAnalyzed`, `retentionMinRelevance` to config
4. Wire into `_bg-analyze` for post-analysis archive check

### Phase 3: MCP Evolution
1. Add `check_project_knowledge` tool
2. Add `save_decision` tool
3. Update existing tools to read from `project_summaries`

### Phase 4: Polish
1. TUI archive indicator
2. `ph search --archive` support
3. Auto-purge of old archived entries

## Success Criteria

- Database size stabilizes (no growth beyond configured retention window)
- `project_summaries` has exactly 1 row per project with knowledge
- MCP `check_project_knowledge` returns useful context before implementation
- `ph cleanup --retention` can be run daily (cron) without user intervention
- Zero data loss: archived prompts are queryable, only explicitly purgeable

## Non-Goals

- Full-text dedup across projects (separate concern)
- Cross-project knowledge merging (too risky)
- Automatic git state tracking (Task 2.4, deferred)
- Vector search over archived prompts (unnecessary for cold data)
