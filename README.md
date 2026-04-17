# ph — Prompt History & Analysis Tool

`ph` is a transparent wrapper for AI CLI tools (such as Gemini CLI, Claude CLI, etc.). It captures every prompt into a local SQLite database, providing full-text and semantic search, automatic background analysis, and Git context snapshots.

## Key Features

- 📥 **Automatic Capture**: Saves prompts, output (if non-interactive), and metadata.
- 🌳 **Git Context**: Saves branch, modified files, and diff at the time of the prompt.
- 🔍 **Advanced Search**: Textual search (FTS5) and semantic search (vectorial).
- 🧠 **Background Analysis**: Automatic prompt analysis (role, tags, relevance) via Ollama or Gemini.
- 🖥️ **Interactive TUI**: Interactive browser (`ph browse`) to manage history.

## Installation

```bash
# Clone and local build
git clone git@github.com:gi4nks/ph.git
cd ph
npm install
make build
make install # Installs the global 'ph' link
```

## Configuration

The tool uses a configuration file at `~/.ph_config.json`.

```bash
ph config set gemini-api-key "YOUR_KEY"
ph config set analyze-provider gemini # or 'ollama' (default)
ph config set background-analysis true  # Enable auto-analysis
```

## Storage & Architecture

`ph` stores its data locally to ensure privacy and fast access.

### Files and Locations

| Item | Default Path | Description |
|------|--------------|-------------|
| **Database** | `~/.prompt_history.db` | SQLite database with FTS5 and vector embeddings. |
| **Config** | `~/.ph_config.json` | JSON configuration file (stored with `0o600` permissions). |

### Customizing the Database Path
You can move your database to a different location (e.g., an external drive or a cloud-synced folder):

```bash
ph config set db-path "/path/to/your/custom.db"
```

### Database Maintenance
As you use `ph`, the database might grow due to Git diffs and metadata. Use these commands to keep it lean:

```bash
# Remove prompts shorter than 20 chars or older than 30 days
ph cleanup --min-length 20 --days 30

# Compact the database file to reclaim disk space
ph vacuum

# Run a dry-run to see what would be deleted
ph cleanup --dry-run --days 60
```

### Database Security
The database uses **WAL (Write-Ahead Logging)** mode, which allows concurrent read and write operations. This is crucial for the **Background Analysis** system to work without locking your CLI session.

## Hooks (Integration with AI CLI)

Hooks allow `ph` to automatically capture prompts and responses from other AI CLI tools by integrating directly with their native hook systems.

### How they work
Hooks are located in the `hooks/` folder. Instead of wrapping the execution, they act as post-action handlers (e.g., `AfterAgent` in Gemini CLI or `Stop` in Claude Code) that send the prompt and response to `ph log` in the background.

### Hook Installation

#### Gemini CLI
1. Link the hook script to your `.gemini` folder:
   ```bash
   ln -sf /path/to/ph/hooks/gemini/ph-hook.sh ~/.gemini/ph-hook.sh
   ```
2. Register the hook in `~/.gemini/settings.json`:
   ```json
   {
     "hooks": { "AfterAgent": [ { "hooks": [ { "type": "command", "command": "~/.gemini/ph-hook.sh" } ] } ] }
   }
   ```

#### Claude Code
1. Link the hook script to your `.claude` folder:
   ```bash
   ln -sf /path/to/ph/hooks/claude/ph-hook.sh ~/.claude/ph-hook.sh
   ```
2. Register the hook in `~/.claude/settings.json`:
   ```json
   {
     "hooks": { "Stop": [ { "matcher": ".*", "hooks": [ { "type": "command", "command": "~/.claude/ph-hook.sh", "async": true } ] } ] }
   }
   ```

The hooks will automatically send every interaction to `ph` without requiring any shell aliases or manual capture commands.

## Usage

### Search
```bash
ph search "how to refactor"        # Textual search
ph search --semantic "refactoring" # Semantic search
```

### TUI Browser
```bash
ph browse
```
*Hotkeys:* `f` (filters), `e` (edit metadata), `r` (rerun prompt), `y` (copy), `x` (delete).

## Releases and Versioning

The project follows **Semantic Versioning (SemVer)** and uses [Conventional Commits](https://www.conventionalcommits.org/). Releases are managed via `standard-version`.

### Release Commands
To create a new version (updates `package.json`, generates `CHANGELOG.md`, and creates a Git tag):

```bash
make release-patch  # Increments: 0.1.0 -> 0.1.1 (fixes and small changes)
make release-minor  # Increments: 0.1.1 -> 0.2.0 (new compatible features)
make release-major  # Increments: 0.2.0 -> 1.0.0 (breaking changes)
```

After the release, remember to push the tags to trigger the **GitHub Action** for publication:
```bash
git push --follow-tags origin main
```
The package will be automatically built and published to [npmjs.org](https://www.npmjs.com/package/@gi4nks/ph).

### Installation via npm
Install globally with:
```bash
npm install -g @gi4nks/ph
```

## Export
```bash
ph export --format md --limit 5 > prompts.md
```
