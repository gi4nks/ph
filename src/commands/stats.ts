import { PhDB } from '../db/index.js';
import { getStats } from '../stats/index.js';

export async function cmdStats(db: PhDB): Promise<void> {
  const stats = getStats(db);
  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
    magenta: '\x1b[35m',
  };

  console.log(`${C.cyan}ph — Prompt History Statistics${C.reset}\n`);
  console.log(`  Total prompts:  ${C.yellow}${stats.total}${C.reset}`);
  console.log(`  Analyzed:       ${C.yellow}${stats.analyzed}${C.reset} (${Math.round((stats.analyzed / (stats.total || 1)) * 100)}%)`);
  console.log(`  Starred:        ${C.yellow}${stats.starred}${C.reset}`);

  if (stats.avgRelevance > 0 || stats.avgQuality > 0) {
    console.log(`\n${C.cyan}Global Scores:${C.reset}`);
    console.log(`  - Avg Relevance: ${C.yellow}${stats.avgRelevance.toFixed(1)}/10${C.reset}`);
    console.log(`  - Avg Quality:   ${C.yellow}${stats.avgQuality.toFixed(1)}/10${C.reset}`);
  }

  console.log(`\n${C.cyan}By Tool:${C.reset}`);
  Object.entries(stats.byTool).sort((a, b) => b[1] - a[1]).forEach(([tool, count]) => {
    console.log(`  - ${tool.padEnd(12)}: ${C.yellow}${count}${C.reset}`);
  });

  if (Object.keys(stats.byProject).length > 0) {
    console.log(`\n${C.cyan}Top Projects:${C.reset}`);
    Object.entries(stats.byProject).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([proj, count]) => {
      console.log(`  - ${proj.padEnd(20)}: ${C.yellow}${count}${C.reset}`);
    });
  }

  if (Object.keys(stats.byLanguage).length > 0) {
    console.log(`\n${C.cyan}Top Languages:${C.reset}`);
    Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([lang, count]) => {
      console.log(`  - ${lang.padEnd(12)}: ${C.yellow}${count}${C.reset}`);
    });
  }

  if (Object.keys(stats.byRole).length > 0) {
    console.log(`\n${C.cyan}By Role:${C.reset}`);
    Object.entries(stats.byRole).sort((a, b) => b[1] - a[1]).forEach(([role, count]) => {
      console.log(`  - ${role.padEnd(12)}: ${C.yellow}${count}${C.reset}`);
    });
  }
  console.log();
}
