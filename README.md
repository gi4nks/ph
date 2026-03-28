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

## Hooks (Integration with AI CLI)

Hooks allow `ph` to intercept prompts sent to other tools. They are scripts that wrap the execution of the chosen AI CLI.

### How they work
Hooks are located in the `hooks/` folder. Each hook exports a function or acts as a PTY wrapper to maintain the interactivity of the original AI CLI while capturing data.

### Hook Installation

#### For Gemini CLI:
Add this alias to your `.zshrc` or `.bashrc`:
```bash
alias gemini='/path/to/ph/hooks/gemini/ph-hook.sh'
```

#### For Claude CLI:
Add this alias:
```bash
alias claude='/path/to/ph/hooks/claude/ph-hook.sh'
```

The hook will execute `ph capture` before passing control to the original AI CLI, saving the current Git context and the sent prompt.

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
The package will be automatically built and published to [GitHub Packages](https://github.com/gi4nks/ph/packages).

### Installation via GitHub Packages
Configure your `.npmrc` to include the `@gi4nks` scope:
```bash
@gi4nks:registry=https://npm.pkg.github.com
```
Then install with:
```bash
npm install -g @gi4nks/ph
```

## Export
```bash
ph export --format md --limit 5 > prompts.md
```
