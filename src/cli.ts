#!/usr/bin/env node

import { load as loadConfig } from './config/index.js';
import { PhDB, defaultPath } from './db/index.js';
import { runMCPServer } from './mcp/server.js';
import { runServer } from './server/index.js';
import { cmdRemote } from './commands/remote.js';
import { cmdSearch } from './commands/search.js';
import { cmdShow } from './commands/show.js';
import { cmdStatus } from './commands/status.js';
import { cmdLast } from './commands/last.js';
import { cmdStar } from './commands/star.js';
import { cmdExport } from './commands/export.js';
import { cmdImport } from './commands/import.js';
import { cmdAnalyze } from './commands/analyze.js';
import { cmdEmbedAll } from './commands/embed-all.js';
import { cmdLog } from './commands/log.js';
import { cmdConfig } from './commands/config.js';
import { cmdBackgroundAnalyze } from './commands/background-analyze.js';
import { cmdCleanup } from './commands/cleanup.js';
import { cmdVacuum } from './commands/vacuum.js';
import { cmdContext } from './commands/context.js';
import { cmdSessions } from './commands/sessions.js';
import { cmdStats } from './commands/stats.js';
import { cmdTimeline } from './commands/timeline.js';
import { cmdWrap } from './commands/wrap.js';
import { detectCaptureTools, setupCapture } from './commands/setup.js';
import { cmdModels } from './commands/models.js';
import { parseFlags } from './commands/_utils.js';
import { cmdMemory } from './commands/memory.js';
import { cmdBackgroundMemory } from './commands/background-memory.js';

const ADVANCED_USAGE = `ph — local history and project context for AI CLI tools

USAGE:
  ph                                    Print the short everyday-use guide
  ph setup [claude|codex|gemini|opencode|agy...] Connect supported AI CLIs for automatic capture
  ph <tool> [tool-args...]              Wrap a CLI tool, save prompt to history
  ph search [options] [query]           Search this project (5 matches; --all searches everything)
  ph show <id> [--json] [--archive]     Inspect one complete interaction and its analysis
  ph context [options] [query]          Retrieve prior context for the current project
  ph memory add [options] <text>        Save a project, work, or personal memory
  ph memory list|search [options]       List or search durable memories
  ph memory show|forget|restore <id>    Inspect or change a memory
  ph memory retry|undo <interaction-id> Retry or reverse automatic extraction
  ph last [n]                           Show last N prompts (default 10)
  ph sessions [options]                 Group prompts into work sessions
  ph stats                              Show history statistics
  ph status                             Show recent capture and background-work status
  ph star <id>                          Toggle star on a prompt
  ph export <id> [--format txt|json|md] [--archive] Export one complete interaction
  ph import <source> [--dry-run] [--analyze] [--filter] [--file <path>] [--workdir <path>] [--live]
                                                Import from Gemini, Claude, OpenCode, Codex, or AGY history
  ph analyze [--limit n] [--force] [--prune] [--min-score n] [--dry-run] Analyze prompts (dry-run still calls provider and saves successful metadata)
  ph models [openrouter|mlx-serve|ollama] List models from an AI provider
  ph mcp                                Start MCP server (Stdio)
  ph server [--host <address>] [--port 3001] Start authenticated HTTP service
  ph timeline [project]                 Show full project history with prompts and memories
  ph remote push|pull|status            Sync prompts with remote ph server
  ph cleanup [--dry-run] [--min-length N] [--min-score N] [--days N] Remove matching prompts
  ph cleanup --retention [--dry-run]          Archive prompts per retention policy
  ph vacuum                           Compact the SQLite database
  ph embed-all                          Generate embeddings for all prompts
  ph log --tool <name> --prompt <text> [--response <text>]  Log a prompt+response directly
  ph config show                        Show active AI provider configuration
  ph config get <key>                   Read config value (secrets are redacted)
  ph config set <key> [value]           Save config value (secret keys prompt hidden)

WRAP FLAGS (placed before the tool name):
  --ph-tag <tag>                        Add a tag to the captured prompt
  --ph-role <role>                      Set the prompt role (debug, refactor, explain, review, architect, test, docs, generate, research)
  --ph-debug                            Write a debug log to ~/.ph_debug.log

SEARCH OPTIONS:
  --all               Search across all projects (default: detected current project)
  --tool <name>       Filter by tool name (claude, gemini, opencode, codex, agy, …)
  --project <name>    Filter by project name
  --language <lang>   Filter by language (go, typescript, python, …)
  --role <role>       Filter by role (debug, refactor, explain, …)
  --tag <tag>         Filter by tag
  --starred           Show only starred prompts
  --min-quality <n>   Filter by min quality (0-10)
  --min-relevance <n> Filter by min relevance (0-10)
  --top               Show only top quality prompts (quality >= 8)
  --semantic          Use semantic search (requires embeddings)
  --archive           List archived prompts (date/limit only; no text query)
  -i, --interactive   Compatibility flag; output remains plain text
  --since YYYY-MM-DD
  --until YYYY-MM-DD
  --limit <n>         Max results (default 5)
  --full              Show full prompt and response without truncation

CONTEXT OPTIONS:
  --project <name>    Project to get context for (default: auto-detect)
  --limit <n>         Max results (default 5)
  --prompts-only      Show only prompt-based context, skip project knowledge
  --memories-only     Show only project knowledge, skip prompts
  --verbose           Include up to 1,000 characters of each prompt
  --budget <chars>    Local context character budget (500-12,000; shared memories add extra output)

SESSIONS OPTIONS:
  --gap-hours <n>     Hours gap to split sessions (default 2)
  --limit <n>         Max sessions to show (default 20)
  --min-size <n>      Minimum prompts per session (default 1)
  --no-cohesion       Skip semantic cohesion computation
  --export <n>        Export session N as markdown

EXAMPLES:
  ph claude "explain goroutines"
  ph --ph-role debug --ph-tag auth claude "fix JWT expiration bug"
  ph search "goroutines"
  ph show 42
  ph search --tool claude --role debug --since 2026-01-01 "error handling"
  ph search --semantic "how to handle errors gracefully"
  ph context "add Wise provider" --limit 5
  ph show 42 --json
  ph last 20
  ph sessions
  ph sessions --gap-hours 4 --min-size 3
  ph stats
  ph export 5 --format md
  ph import agy
  ph import claude --analyze --filter
  ph analyze --force --prune --min-score 3
  ph cleanup --dry-run
  ph embed-all
  ph context
  ph context "how to add a new database table"
  ph context --memories-only --project ph
  ph config set analyze-provider gemini
  ph config set background-analysis true
  ph config set ollama-model llama3.2:latest
  ph models ollama
  ph models openrouter
  ph models mlx-serve
`;

const USAGE = `PH remembers work across your AI coding sessions.

One-time setup:
  ph setup                  Connect PH to installed supported AI CLIs

Then use those tools normally. PH saves completed exchanges in the background.

When you need something back:
  ph search "query"         Search this project; use --all to search everything
  ph show <id>              Inspect the full prompt, response, and available analysis
  ph context "task"         Retrieve relevant project context when needed
  ph memory search "query"  Search saved memories

Run ph help --all for optional integrations and maintenance commands.
`;

function setupStatusLabel(status: 'installed' | 'updated' | 'already-configured'): string {
  switch (status) {
    case 'installed': return 'Installed capture for';
    case 'updated': return 'Updated capture for';
    case 'already-configured': return 'Already configured for';
  }
}





// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Load config first
  const cfg = loadConfig();
  if (cfg.geminiApiKey) {
    process.env.GEMINI_API_KEY = cfg.geminiApiKey;
  }

  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();

  if (argv.length === 0) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  // Find first non-flag argument, skipping --ph-tag <value> and --ph-debug
  let cmdIdx = -1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (argv[i] === '--ph-tag' || argv[i] === '--ph-role') i++; // skip value
      continue;
    }
    cmdIdx = i;
    break;
  }

  if (cmdIdx === -1) {
    process.stdout.write(argv.includes('--all') ? ADVANCED_USAGE : USAGE);
    process.exit(0);
  }

  const command = argv[cmdIdx];
  const cmdArgs = argv.slice(cmdIdx + 1);
  const preArgs = argv.slice(0, cmdIdx); // pre-tool flags like --ph-tag

  switch (command) {
    case 'setup': {
      if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) {
        process.stdout.write('Usage: ph setup [claude|codex|gemini|opencode|agy|antigravity...]\nWithout tool names, PH detects installed supported CLIs.\n');
        break;
      }
      const selectedTools = cmdArgs.filter(arg => !arg.startsWith('-'));
      const tools = selectedTools.length ? selectedTools : detectCaptureTools();
      const results = setupCapture(process.env.HOME, undefined, tools);
      if (results.length === 0) {
        process.stdout.write('No supported AI CLI detected. Install one or select it explicitly: claude, codex, gemini, opencode, agy.\n');
        break;
      }
      for (const status of ['installed', 'updated', 'already-configured'] as const) {
        const names = results.filter(result => result.status === status).map(result => result.tool);
        if (names.length) process.stdout.write(`${setupStatusLabel(status)}: ${names.join(', ')}.\n`);
      }
      const restart = results.filter(result => result.status === 'installed' || result.status === 'updated').map(result => result.tool);
      process.stdout.write(restart.length
        ? `Restart ${restart.join(' and ')} to load the capture hook.\n`
        : 'No changes needed.\n');
      break;
    }
    case 'search': {
      const db = new PhDB(dbPath);
      await cmdSearch(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'show': {
      const db = new PhDB(dbPath);
      await cmdShow(db, cmdArgs);
      db.close();
      break;
    }
    case 'status': {
      const db = new PhDB(dbPath);
      await cmdStatus(db, cfg);
      db.close();
      break;
    }
    case 'context': {
      const db = new PhDB(dbPath);
      await cmdContext(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'last': {
      const db = new PhDB(dbPath);
      await cmdLast(db, cmdArgs);
      db.close();
      break;
    }
    case 'sessions': {
      const db = new PhDB(dbPath);
      await cmdSessions(db, cmdArgs);
      db.close();
      break;
    }
    case 'stats': {
      const db = new PhDB(dbPath);
      await cmdStats(db);
      db.close();
      break;
    }
    case 'star': {
      const db = new PhDB(dbPath);
      await cmdStar(db, cmdArgs);
      db.close();
      break;
    }
    case 'export': {
      const db = new PhDB(dbPath);
      await cmdExport(db, cmdArgs);
      db.close();
      break;
    }
    case 'import': {
      const db = new PhDB(dbPath);
      await cmdImport(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'analyze': {
      const db = new PhDB(dbPath);
      await cmdAnalyze(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'models': {
      await cmdModels(cfg, cmdArgs);
      break;
    }
    case 'memory': {
      const db = new PhDB(dbPath);
      await cmdMemory(db, cmdArgs, process.cwd(), cfg);
      db.close();
      break;
    }
    case 'mcp': {
      await runMCPServer();
      break;
    }
    case 'server': {
      const { flags } = parseFlags(cmdArgs);
      const port = Number(flags['port']) || 3001;
      const host = (flags['host'] as string) || '127.0.0.1';
      await runServer(port, host);
      break;
    }
    case 'remote': {
      await cmdRemote(dbPath, cmdArgs);
      break;
    }
    case 'log': {
      await cmdLog(dbPath, cfg, cmdArgs);
      break;
    }
    case 'embed-all': {
      const db = new PhDB(dbPath);
      await cmdEmbedAll(db, cfg);
      db.close();
      break;
    }
    case 'cleanup': {
      const db = new PhDB(dbPath);
      await cmdCleanup(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'vacuum': {
      const db = new PhDB(dbPath);
      await cmdVacuum(db);
      db.close();
      break;
    }
    case 'config':
      await cmdConfig(cmdArgs);
      break;

    case '_bg-analyze': {
      await cmdBackgroundAnalyze(dbPath, cmdArgs);
      break;
    }

    case '_bg-memory': {
      await cmdBackgroundMemory(dbPath, cmdArgs);
      break;
    }

    case 'timeline': {
      const db = new PhDB(dbPath);
      await cmdTimeline(db, cfg, cmdArgs);
      db.close();
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(cmdArgs.includes('--all') ? ADVANCED_USAGE : USAGE);
      break;

    default:
      // Transparent wrap mode: merge pre-tool flags with post-tool args
      await cmdWrap(dbPath, command, [...preArgs, ...cmdArgs], cfg);
      break;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`ph: ${(e as Error).message}\n`);
  process.exit(1);
});
