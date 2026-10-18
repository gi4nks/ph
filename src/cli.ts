#!/usr/bin/env node

import { spawnSync } from 'child_process';
import React from 'react';
import { render } from 'ink';
import { load as loadConfig } from './config/index.js';
import { PhDB, defaultPath } from './db/index.js';
import { resolveRealBinary } from './runner/inline.js';
import { isTerminal } from './pty/wrapper.js';
import { runMCPServer } from './mcp/server.js';
import { runServer } from './server/index.js';
import { cmdRemote } from './commands/remote.js';
import { BrowseApp } from './ui/BrowseApp.js';
import { cmdSearch } from './commands/search.js';
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
import { cmdCluster } from './commands/cluster.js';
import { cmdAnalyzeReusability } from './commands/analyze-reusability.js';
import { cmdCleanupReusability } from './commands/cleanup-reusability.js';
import { cmdTimeline } from './commands/timeline.js';
import { cmdMemoryMigrate } from './commands/memory-migrate.js';
import { cmdWrap } from './commands/wrap.js';
import { cmdChat } from './commands/chat.js';
import { cmdModels } from './commands/models.js';
import { getProvider, getProviderSetupError } from './ai/provider.js';
import { parseFlags } from './commands/_utils.js';

const USAGE = `ph — prompt history tracker

USAGE:
  ph                                    Open interactive TUI browser (default)
  ph <tool> [tool-args...]              Wrap a CLI tool, save prompt to history
  ph search [options] [query]           Search saved prompts
  ph context [options] [query]          Get RAG context for the current project
  ph chat <tool> <prompt...>            Run tool with project context injected
  ph last [n]                           Show last N prompts (default 10)
  ph sessions [options]                 Group prompts into work sessions
  ph stats                              Show history statistics
  ph cluster [options]                  Cluster prompts by similarity
  ph analyze-reusability [options]      Analyze prompt reusability
  ph star <id>                          Toggle star on a prompt
  ph export <id> [--format txt|json|md] Export a single prompt
  ph import <source> [--dry-run] [--analyze] [--filter] [--file <path>]
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
  ph config set <key> [value]           Save config value (secret keys prompt hidden)
  ph browse                             Interactive TUI browser

WRAP FLAGS (placed before the tool name):
  --ph-tag <tag>                        Add a tag to the captured prompt
  --ph-role <role>                      Set the prompt role (debug, refactor, explain, review, architect, test, docs, generate, research)
  --ph-debug                            Write a debug log to ~/.ph_debug.log

SEARCH OPTIONS:
  -i, --interactive   Open results in interactive TUI browser
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
  --limit <n>         Max results (default 50)
  --full              Show full prompt without truncation

CONTEXT OPTIONS:
  --project <name>    Project to get context for (default: auto-detect)
  --limit <n>         Max results (default 5)
  --prompts-only      Show only prompt-based context, skip project knowledge
  --memories-only     Show only project knowledge, skip prompts
  --verbose           Include full prompt text in output

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
  ph search --tool claude --role debug --since 2026-01-01 "error handling"
  ph search --semantic "how to handle errors gracefully"
  ph search -i "database"
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





// ─── Entry point ──────────────────────────────────────────────────────────────

type BrowseAppProps = React.ComponentProps<typeof BrowseApp>;

/**
 * Opens the TUI browser inside the alternate screen (SPEC-001).
 * Shared by the default, `browse` and `search -i` paths (SPEC-ISSUES-010).
 * Resolves with the rerun request (or null) after the TUI exits.
 */
async function openBrowser(
  db: PhDB,
  opts: Pick<BrowseAppProps, 'initialTextFilter' | 'initialFilters'> = {},
): Promise<{ tool: string; prompt: string } | null> {
  let pendingRerun: { tool: string; prompt: string } | null = null;
  process.stdout.write('\x1b[?1049h');
  try {
    const { waitUntilExit } = render(
      React.createElement(BrowseApp, {
        db,
        ...opts,
        onRerun: (tool, prompt) => { pendingRerun = { tool, prompt }; },
      })
    );
    await waitUntilExit();
  } finally {
    process.stdout.write('\x1b[?1049l');
  }
  return pendingRerun;
}

/** Executes a TUI rerun request after the browser closed. */
async function runRerun(rerun: { tool: string; prompt: string } | null, dbPath: string, cfg: ReturnType<typeof loadConfig>): Promise<void> {
  if (!rerun) return;
  if (rerun.tool.startsWith('wise:')) {
    const providerId = rerun.tool.slice('wise:'.length) as NonNullable<ReturnType<typeof loadConfig>['analyzeProvider']>;
    const setupError = getProviderSetupError(cfg, providerId);
    if (setupError) throw new Error(setupError);
    const provider = getProvider(cfg, providerId);
    if (!provider) throw new Error(`Cannot create ${providerId} provider from the saved configuration.`);
    const response = await provider.generate(rerun.prompt);
    process.stdout.write(`${response}\n`);
    await cmdLog(dbPath, cfg, ['--tool', `wise:${providerId}`, '--prompt', rerun.prompt, '--response', response]);
    return;
  }
  const realBin = resolveRealBinary(rerun.tool);
  const child = spawnSync(realBin, [rerun.prompt], { stdio: 'inherit' });
  process.exit(child.status ?? 0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Load config first
  const cfg = loadConfig();
  if (cfg.geminiApiKey) {
    process.env.GEMINI_API_KEY = cfg.geminiApiKey;
  }

  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();

  if (argv.length === 0) {
    if (isTerminal()) {
      const db = new PhDB(dbPath);
      const rerun = await openBrowser(db);
      db.close();
      await runRerun(rerun, dbPath, cfg);
      process.exit(0);
    } else {
      process.stdout.write(USAGE);
      process.exit(0);
    }
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
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const command = argv[cmdIdx];
  const cmdArgs = argv.slice(cmdIdx + 1);
  const preArgs = argv.slice(0, cmdIdx); // pre-tool flags like --ph-tag

  switch (command) {
    case 'search': {
      const { flags, positional } = parseFlags(cmdArgs);
      const query = positional.join(' ');
      
      if (flags['i'] || flags['interactive']) {
        const db = new PhDB(dbPath);
        const rerun = await openBrowser(db, {
          initialTextFilter: query,
          initialFilters: {
            tool: flags['tool'] as string,
            project: flags['project'] as string,
            language: flags['language'] as string,
            role: flags['role'] as string,
            tag: flags['tag'] as string,
            starred: Boolean(flags['starred']),
            minQuality: flags['top'] ? 8 : (flags['min-quality'] ? Number(flags['min-quality']) : undefined),
            minRelevance: flags['min-relevance'] ? Number(flags['min-relevance']) : undefined,
          },
        });
        db.close();
        await runRerun(rerun, dbPath, cfg);
        break;
      }

      const db = new PhDB(dbPath);
      await cmdSearch(db, cfg, cmdArgs);
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
      const host = (flags['host'] as string) || '0.0.0.0';
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
      const rerun = await openBrowser(db);
      db.close();
      await runRerun(rerun, dbPath, cfg);
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
      process.stdout.write(USAGE);
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
