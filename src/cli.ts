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
import { cmdClose } from './commands/close.js';
import { cmdSessions } from './commands/sessions.js';
import { cmdStats } from './commands/stats.js';
import { cmdCluster } from './commands/cluster.js';
import { cmdAnalyzeReusability } from './commands/analyze-reusability.js';
import { cmdCleanupReusability } from './commands/cleanup-reusability.js';
import { cmdTimeline } from './commands/timeline.js';
import { cmdMemoryMigrate } from './commands/memory-migrate.js';
import { cmdWrap } from './commands/wrap.js';
import { cmdChat } from './commands/chat.js';
import { detectCaptureTools, setupCapture } from './commands/setup.js';
import { cmdModels } from './commands/models.js';
import { parseFlags } from './commands/_utils.js';

const ADVANCED_USAGE = `ph — local history and project context for AI CLI tools

USAGE:
  ph                                    Print the short everyday-use guide
  ph setup [tool...]                   Connect supported AI CLIs for automatic capture
  ph <tool> [tool-args...]              Wrap a CLI tool, save prompt to history
  ph search [options] [query]           Search this project (5 matches; --all searches everything)
  ph show <id> [--json] [--archive]     Inspect one complete interaction and its analysis
  ph context [options] [query]          Get RAG context for the current project
  ph prepare "<task>" [options]          Alias for task-aware ph context
  ph close [--since 3h] [options]        Review work and propose knowledge to save
  ph chat <tool> <prompt...>            Run tool with project context injected
  ph last [n]                           Show last N prompts (default 10)
  ph sessions [options]                 Group prompts into work sessions
  ph stats                              Show history statistics
  ph status                             Show recent capture and background-work status
  ph cluster [options]                  Cluster prompts by similarity
  ph analyze-reusability [options]      Analyze prompt reusability
  ph star <id>                          Toggle star on a prompt
  ph export <id> [--format txt|json|md] [--archive] Export one complete interaction
  ph import <source> [--dry-run] [--analyze] [--filter] [--file <path>] [--workdir <path>]
                                                Import from Gemini, Claude, OpenCode, or Codex history
  ph analyze [--limit n] [--force] [--prune] [--dry-run]  Analyze prompts with LLM
  ph models [openrouter|mlx-serve]     List models from an AI provider
  ph mcp                                Start MCP server (Stdio)
  ph server [--port 3001]               Start HTTP REST server for remote sync
  ph timeline [project]                 Show full project history with prompts and memories
  ph memory-migrate                      Merge existing memories into project_summaries
  ph remote push|pull|status            Sync prompts with remote ph server
  ph cleanup [--dry-run] [--min-length N] [--min-score N]  Remove useless prompts
  ph cleanup --retention [--dry-run]          Archive prompts per retention policy
  ph cleanup-reusability [--dry-run] [--threshold 0.7] [--force]  Cleanup based on reusability
  ph embed-all                          Generate embeddings for all prompts
  ph log --tool <name> --prompt <text> [--response <text>]  Log a prompt+response directly
  ph config show                        Show active AI provider configuration
  ph config get <key>                   Read config value (secrets are redacted)
  ph config set <key> [value]           Save config value (secret keys prompt hidden)
  ph browse                             Print the latest interactions

WRAP FLAGS (placed before the tool name):
  --ph-tag <tag>                        Add a tag to the captured prompt
  --ph-role <role>                      Set the prompt role (debug, refactor, explain, review, architect, test, docs, generate, research)
  --ph-debug                            Write a debug log to ~/.ph_debug.log

SEARCH OPTIONS:
  --tool <name>       Filter by tool name (claude, gemini, opencode, codex, …)
  --project <name>    Filter by project name
  --language <lang>   Filter by language (go, typescript, python, …)
  --role <role>       Filter by role (debug, refactor, explain, …)
  --tag <tag>         Filter by tag
  --starred           Show only starred prompts
  --min-quality <n>   Filter by min quality (0-10)
  --min-relevance <n> Filter by min relevance (0-10)
  --top               Show only top quality prompts (quality >= 8)
  --semantic          Use semantic search (requires embeddings)
  --archive           Search archived prompts
  --since YYYY-MM-DD
  --until YYYY-MM-DD
  --limit <n>         Max results (default 5)
  --full              Show full prompt and response without truncation

CONTEXT OPTIONS:
  --project <name>    Project to get context for (default: auto-detect)
  --limit <n>         Max results (default 5)
  --prompts-only      Show only prompt-based context, skip project knowledge
  --memories-only     Show only project knowledge, skip prompts
  --verbose           Include full prompt text in output

PREPARE OPTIONS:
  --project <name>    Project to retrieve context for (default: auto-detect)
  --limit <n>         Max results (default 5, max 20)
  --budget <chars>    Maximum brief content target (default 3500)

CLOSE OPTIONS:
  --since <duration>  Select recent prompts (e.g. 30m, 3h, 1d)
  --from <id> --to <id>  Select an inclusive prompt ID range
  --project <name>    Project to review (default: auto-detect)
  --dry-run           Show selected prompts without calling an LLM

SESSIONS OPTIONS:
  --gap-hours <n>     Hours gap to split sessions (default 2)
  --limit <n>         Max sessions to show (default 20)
  --min-size <n>      Minimum prompts per session (default 1)
  --no-cohesion       Skip semantic cohesion computation
  --export <n>        Export session N as markdown

CLUSTER OPTIONS:
  -k <number>         Number of clusters (default 5)
  --limit <n>         Max prompts per cluster to show (default 3)

ANALYZE-REUSABILITY OPTIONS:
  --export-csv <file>  Export report to CSV
  --threshold <n>      Scoring threshold (default 0.7)

EXAMPLES:
  ph claude "explain goroutines"
  ph --ph-role debug --ph-tag auth claude "fix JWT expiration bug"
  ph search "goroutines"
  ph show 42
  ph search --tool claude --role debug --since 2026-01-01 "error handling"
  ph search --semantic "how to handle errors gracefully"
  ph context "add Wise provider" --limit 5
  ph show 42 --json
  ph close --since 3h
  ph last 20
  ph sessions
  ph sessions --gap-hours 4 --min-size 3
  ph stats
  ph cluster -k 10
  ph export 5 --format md
  ph import claude --analyze --filter
  ph analyze --force --prune --min-score 3
  ph cleanup --dry-run
  ph embed-all
  ph context
  ph context "how to add a new database table"
  ph context --memories-only --project ph
  ph analyze-reusability --export-csv report.csv
  ph cleanup-reusability --dry-run
  ph config set analyze-provider gemini
  ph config set background-analysis true
  ph config set ollama-model llama3.2:latest
  ph ollama-models                          List models available on the local Ollama instance
  ph models openrouter                      Discover OpenRouter models
  ph models mlx-serve                       Discover models on MLX-Serve (default Parmenide tunnel)
`;

const USAGE = `PH remembers work across your AI coding sessions.

One-time setup:
  ph setup                  Connect PH to installed supported AI CLIs

Then use those tools normally. PH saves completed exchanges in the background.

When you need something back:
  ph search "query"         Search this project; use --all to search everything
  ph show <id>              Inspect the full prompt, response, and available analysis
  ph context "task"         Retrieve relevant project context when needed

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
        process.stdout.write('Usage: ph setup [claude|codex|gemini|opencode...]\nWithout tool names, PH detects installed supported CLIs.\n');
        break;
      }
      const selectedTools = cmdArgs.filter(arg => !arg.startsWith('-'));
      const tools = selectedTools.length ? selectedTools : detectCaptureTools();
      const results = setupCapture(process.env.HOME, undefined, tools);
      if (results.length === 0) {
        process.stdout.write('No supported AI CLI detected. Install one or select it explicitly: claude, codex, gemini, opencode.\n');
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
    case 'prepare': {
      const db = new PhDB(dbPath);
      await cmdContext(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'close': {
      const db = new PhDB(dbPath);
      await cmdClose(db, cfg, cmdArgs);
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
    case 'cluster': {
      const db = new PhDB(dbPath);
      await cmdCluster(db, cmdArgs);
      db.close();
      break;
    }
    case 'analyze-reusability': {
      const db = new PhDB(dbPath);
      await cmdAnalyzeReusability(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'cleanup-reusability': {
      const db = new PhDB(dbPath);
      await cmdCleanupReusability(db, cfg, cmdArgs);
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
    case 'memory-migrate': {
      const db = new PhDB(dbPath);
      cmdMemoryMigrate(db);
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

    case 'browse': {
      const db = new PhDB(dbPath);
      process.stderr.write('ph browse is now a text-based history listing; use ph search to find specific work.\n');
      await cmdLast(db, []);
      db.close();
      break;
    }

    case 'chat': {
      await cmdChat(dbPath, cfg, cmdArgs);
      break;
    }

    case 'timeline': {
      const db = new PhDB(dbPath);
      await cmdTimeline(db, cfg, cmdArgs);
      db.close();
      break;
    }

    case 'ollama-models': {
      const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
      try {
        const res = await fetch(`${ollamaUrl}/api/tags`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { models?: Array<{ name: string }> };
        const models = (data.models ?? []).map(m => m.name).filter(Boolean);
        if (models.length === 0) {
          console.log('No models found.');
        } else {
          console.log(`Available Ollama models at ${ollamaUrl}:`);
          for (const m of models) console.log(`  ${m}`);
        }
      } catch (err: unknown) {
        process.stderr.write(`ph: cannot reach Ollama at ${ollamaUrl}: ${(err as Error).message}\n`);
        process.exit(1);
      }
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
