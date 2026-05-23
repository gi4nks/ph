# ph — Roadmap

## ✅ Phase 1: Metadata Foundation & Auto-Project

- `metadata` column (JSON) in `prompts` table
- Automatic project detection (`.git`, `package.json`, `tsconfig.json`, etc.)
- Automatic language detection
- Extensible `PromptMetadata` structure

## ✅ Phase 2: Organization & Tagging

- `--ph-tag` and `--ph-role` flags in the wrapper
- Search with filters for project, language, role, tag, starred
- Colored output with badges for role and project
- Interactive TUI browser (React/Ink)
- `ph star <id>` command

## ✅ Phase 3: Intelligent Search

- **Vector Search (FTS5):** Ultra-fast full-text search
- **Semantic Search:** Gemini `text-embedding-004` embeddings + cosine similarity
- **`ph analyze`:** Automatic prompt categorization with LLM (Ollama or Gemini)
- Importers for Claude CLI and Gemini CLI
- `ph export` in txt/json/md format
- `ph cleanup` to remove useless prompts
- `ph import --filter` with deduplication pipeline

## ✅ Phase 4: Context, Automation & Sessions

- **Git Context Snapshot:** Automatic capture of branch, diff, and modified files at the time of the prompt
- **Background Analysis:** Detached LLM auto-analysis after each capture
- **Work Sessions (`ph sessions`):** Grouping by time gap + semantic cohesion score
- **Prompt Rerunning (`r` in TUI):** Editor with customizable tool and prompt, direct re-execution

---

## Phase 5: Future Ideas

- **Syntax Highlighting in TUI:** Code block highlighting in prompts
- **Automatic Clustering:** K-means on embeddings to group similar prompts into "macro-themes"
- **Response Capture:** Saving the AI response as well, not just the prompt
- **Multi-Provider from TUI:** Sending a saved prompt to another provider (Claude → Gemini) directly from the TUI
- **Export Session:** Exporting an entire session as a markdown document with a timeline
- **Web UI:** Optional browser interface for desktop history navigation
