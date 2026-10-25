import { createInterface } from 'node:readline/promises';
import type { PhConfig } from '../config/index.js';
import { getProvider, getProviderSetupError } from '../ai/provider.js';
import type { PhDB } from '../db/index.js';
import type { PromptEntry } from '../types.js';
import { promoteProjectKnowledge } from '../knowledge/promotion.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import { saveHubMemory } from './memory-hub.js';

export interface KnowledgeProposal {
  summary: string;
  key_insights: string[];
  technical_decisions: string[];
  source_prompt_ids: number[];
}

export function parseKnowledgeProposals(raw: string, allowedPromptIds?: number[]): KnowledgeProposal[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(text) as { proposals?: unknown };
  if (!Array.isArray(parsed.proposals)) throw new Error('Provider response must contain a proposals array');
  return parsed.proposals.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Proposal ${index + 1} is invalid`);
    const item = value as Record<string, unknown>;
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string') ? v.map(x => x.trim()).filter(Boolean) : [];
    if (!summary) throw new Error(`Proposal ${index + 1} has no summary`);
    const sourceIds = Array.isArray(item.source_prompt_ids) && item.source_prompt_ids.every(id => Number.isInteger(id) && Number(id) > 0)
      ? [...new Set(item.source_prompt_ids as number[])] : [];
    if (allowedPromptIds && (!sourceIds.length || sourceIds.some(id => !allowedPromptIds.includes(id)))) {
      throw new Error(`Proposal ${index + 1} must cite selected source prompt IDs`);
    }
    return { summary, key_insights: strings(item.key_insights), technical_decisions: strings(item.technical_decisions), source_prompt_ids: sourceIds };
  });
}

export async function cmdClose(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const project = (flags.project as string | undefined) || detectProject(process.cwd()).projectName;
  if (!project) throw new Error('Could not detect project. Use --project <name>.');
  const since = (flags.since as string | undefined) ?? (!flags.from && !flags.to ? '3h' : undefined);
  const from = flags.from as string | undefined;
  const to = flags.to as string | undefined;
  if (Boolean(since) === Boolean(from || to) || Boolean(from) !== Boolean(to)) {
    throw new Error('Choose either --since <duration> or both --from <id> --to <id>.');
  }
  const entries = since
    ? db.search({ project, since: new Date(Date.now() - parseDuration(since)), limit: 200 })
    : promptRange(db, project, Number(from), Number(to));
  if (!entries.length) throw new Error(`No prompts found for project "${project}" in the selected range.`);
  const selected = entries.slice(0, 12).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  process.stdout.write(`Close review for ${project}: ${selected.length} prompt(s)${entries.length > selected.length ? ` (first 12 of ${entries.length})` : ''}\n`);
  for (const entry of selected) {
    process.stdout.write(`\n#${entry.id} ${entry.tool} ${entry.timestamp}\nPrompt: ${entry.prompt.slice(0, 1000)}${entry.prompt.length > 1000 ? '…' : ''}\nResponse: ${entry.response.slice(0, 1200)}${entry.response.length > 1200 ? '…' : ''}\n`);
  }
  if (flags['dry-run']) {
    process.stdout.write('\nDry run: no model call and no database changes.\n');
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive approval requires a TTY. Re-run ph close in a terminal; no model call or database changes were made.');
  const provider = getProvider(cfg);
  if (!provider) throw new Error(getProviderSetupError(cfg) ?? 'No LLM provider is configured.');
  const source = selected.map(e => `PROMPT #${e.id} (${e.tool})\n${e.prompt.slice(0, 2500)}\nRESPONSE\n${e.response.slice(0, 3000)}`).join('\n\n---\n\n');
  const answer = await provider.generate(`Extract only durable, reusable project knowledge from the work log below. Propose zero or more separate items. Do not invent facts. For each proposal, cite the relevant source IDs from this work log. Return JSON only: {"proposals":[{"summary":"...","key_insights":["..."],"technical_decisions":["..."],"source_prompt_ids":[123]}]}.\nProject: ${project}\n\n${source}`);
  const proposals = parseKnowledgeProposals(answer, selected.map(entry => entry.id));
  if (!proposals.length) {
    process.stdout.write('\nNo durable knowledge proposal. Nothing saved.\n');
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const approved: KnowledgeProposal[] = [];
  let cancelled = false;
  try {
    for (const [index, initial] of proposals.entries()) {
      let proposal = initial;
      process.stdout.write(`\nProposal ${index + 1}/${proposals.length}\nSummary: ${proposal.summary}\nKey insights: ${proposal.key_insights.join(' | ') || '(none)'}\nDecisions: ${proposal.technical_decisions.join(' | ') || '(none)'}\nSources: ${proposal.source_prompt_ids.map(id => `#${id}`).join(', ')}\n`);
      const action = (await rl.question('[a]pprove, [e]dit, [s]kip, [q]uit? ')).trim().toLowerCase();
      if (action === 'q') { cancelled = true; break; }
      if (action === 's' || !action) continue;
      if (action === 'e') {
        const summary = (await rl.question(`Summary [${proposal.summary}]: `)).trim();
        const insights = (await rl.question(`Key insights separated by | [${proposal.key_insights.join(' | ')}]: `)).trim();
        const decisions = (await rl.question(`Technical decisions separated by | [${proposal.technical_decisions.join(' | ')}]: `)).trim();
        proposal = {
          summary: summary || proposal.summary,
          key_insights: insights ? splitList(insights) : proposal.key_insights,
          technical_decisions: decisions ? splitList(decisions) : proposal.technical_decisions,
          source_prompt_ids: proposal.source_prompt_ids,
        };
        process.stdout.write(`\nEdited summary: ${proposal.summary}\nInsights: ${proposal.key_insights.join(' | ')}\nDecisions: ${proposal.technical_decisions.join(' | ')}\n`);
        if ((await rl.question('Save this proposal? [y/N] ')).trim().toLowerCase() !== 'y') continue;
      } else if (action !== 'a') continue;
      approved.push(proposal);
    }
  } finally {
    rl.close();
  }
  if (cancelled) {
    process.stdout.write('\nReview cancelled. No proposals were saved.\n');
    return;
  }
  const savedIds = promoteProjectKnowledge(db, approved.map(proposal => ({
    project,
    prompt_ids: proposal.source_prompt_ids,
    summary: proposal.summary,
    key_insights: proposal.key_insights,
    technical_decisions: proposal.technical_decisions,
  })));
  approved.forEach((proposal, index) => process.stdout.write(`Saved memory #${savedIds[index]} with sources ${proposal.source_prompt_ids.map(i => `#${i}`).join(', ')}.\n`));
  if (cfg.memoryHubUrl || process.env['PH_MEMORY_HUB_URL']) {
    let shared = 0;
    for (const proposal of approved) {
      const content = [
        `Project: ${project}`,
        proposal.summary,
        ...proposal.key_insights.map(item => `Insight: ${item}`),
        ...proposal.technical_decisions.map(item => `Decision: ${item}`),
      ].join('\n');
      try {
        await saveHubMemory(cfg, {
          content, scope: 'project', kind: 'project-knowledge', source: 'ph-close',
          source_ref: proposal.source_prompt_ids.map(id => `prompt:${id}`).join(','),
        });
        shared++;
      } catch {
        process.stderr.write('ph: approved project knowledge is saved locally; the memory hub could not be reached.\n');
        break;
      }
    }
    if (shared) process.stdout.write(`Shared ${shared} approved item(s) with the PH memory hub.\n`);
  }
}

function parseDuration(raw: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(raw);
  if (!match) throw new Error('--since accepts durations like 30m, 3h, or 1d');
  const amount = Number(match[1]);
  const multiplier = match[2] === 'm' ? 60_000 : match[2] === 'h' ? 3_600_000 : 86_400_000;
  const result = amount * multiplier;
  if (result <= 0 || result > 30 * 86_400_000) throw new Error('--since must be between 1 minute and 30 days');
  return result;
}

function promptRange(db: PhDB, project: string, from: number, to: number): PromptEntry[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to < from || to - from > 500) throw new Error('Prompt range must be valid IDs with at most 500 IDs between them.');
  const entries: PromptEntry[] = [];
  for (let id = from; id <= to; id++) {
    const entry = db.getById(id);
    if (!entry) continue;
    let metadata: { project?: string } = {};
    try { metadata = JSON.parse(entry.metadata) as { project?: string }; } catch {}
    if (metadata.project === project) entries.push(entry);
  }
  return entries;
}

function splitList(value: string): string[] { return value.split('|').map(item => item.trim()).filter(Boolean); }
