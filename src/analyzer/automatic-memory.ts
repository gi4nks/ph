import type { LLMProvider } from '../ai/provider.js';
import type { PromptEntry, PersonalMemoryScope } from '../types.js';

export interface AutomaticMemoryCandidate {
  scope: Extract<PersonalMemoryScope, 'work' | 'project'>;
  kind: 'work-preference' | 'project-decision';
  content: string;
}

const promptFor = (entry: PromptEntry, project?: string) => `Extract at most two durable memories from this completed AI coding interaction. This is an automatic memory write, so be conservative.

Return JSON only in this form: {"memories":[{"scope":"work|project","kind":"work-preference|project-decision","content":"...","evidence":"an exact short quote from the user prompt","sensitive":false}]}. Return {"memories":[]} when nothing qualifies.

Rules:
- Save only durable coding-work preferences the user clearly stated, or project decisions the user explicitly made or accepted.
- Do not save one-off task details, transient errors, proposed decisions the user did not accept, or generic facts.
- Never save personal-life details or sensitive information such as health, finances, relationships, identity, location, credentials, or private contact information. If any candidate could be sensitive or is uncertain, omit it. Never use scope "personal".
- Each memory must be independently useful later, concise, factual, and directly supported by an exact quote in the user prompt. The evidence must be a verbatim substring of the user prompt. Do not infer the user's preference from assistant behavior or assistant-only decisions.
- Use scope "work" for reusable work preferences; use "project" for a decision specific to the current project.
- Mark sensitive true if a candidate includes sensitive or personal information; PH will reject it.
- Keep memory content under 400 characters. Do not include secrets or raw prompt excerpts.

Project: ${project || '(unknown)'}
User prompt:
"""
${entry.prompt.slice(0, 4000)}
"""
Assistant response:
"""
${entry.response.slice(0, 4000)}
"""`;

const obviousSensitive = /(?:\b(?:password|passphrase|api[_ -]?key|access token|bearer\s+[a-z0-9._-]+|secret key|social security|credit card|bank account|medical|medication|health condition|home address|date of birth|relationship|salary|my diagnosis|my medication|i live at|i live in)\b|\b(?:password|passphrase|chiave api|token di accesso|carta di credito|conto bancario|diagnosi|farmaco|salute|indirizzo di casa|data di nascita|stipendio|vivo a|abito a)\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b\+?\d(?:[\d ()-]{7,}\d)\b|\b\d{1,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,3}\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|strasse|strasse|via)\b|sk-[a-z0-9]{12,}|gh[pousr]_[a-zA-Z0-9]{20,})/i;
const explicitPreferenceCue = /\b(prefer|prefer[s]?|please|always|never|from now|keep|avoid|i want|i need|must|should|use|in futuro|d'ora in poi|sempre|mai|preferisco|vorrei|voglio|evita|usa|mantieni|devi)\b/i;
const explicitDecisionCue = /\b(use|choose|chose|decided|decision|adopt|keep|remove|replace|switch|selected|select|prefer|in futuro|d'ora in poi|sempre|mai|scegli|scelto|deciso|decisione|adotta|rimuovi|sostituisci|passa a|preferisco)\b/i;

export function parseAutomaticMemories(raw: string, userPrompt: string): AutomaticMemoryCandidate[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { memories?: unknown }).memories)) return [];
  const items = (parsed as { memories: unknown[] }).memories;
  const result: AutomaticMemoryCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (candidate.sensitive !== false) continue;
    if (candidate.scope !== 'work' && candidate.scope !== 'project') continue;
    if (candidate.kind !== 'work-preference' && candidate.kind !== 'project-decision') continue;
    if (typeof candidate.content !== 'string') continue;
    if (typeof candidate.evidence !== 'string') continue;
    const content = candidate.content.trim();
    const evidence = candidate.evidence.trim();
    if (content.length < 12 || content.length > 400 || evidence.length < 8 || evidence.length > 200) continue;
    if (obviousSensitive.test(content) || obviousSensitive.test(evidence)) continue;
    if (!(candidate.kind === 'work-preference' ? explicitPreferenceCue : explicitDecisionCue).test(evidence)) continue;
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalize(userPrompt).includes(normalize(evidence))) continue;
    if (result.some(existing => existing.content.toLowerCase() === content.toLowerCase())) continue;
    result.push({ scope: candidate.scope, kind: candidate.kind, content });
    if (result.length === 2) break;
  }
  return result;
}

export async function extractAutomaticMemories(entry: PromptEntry, provider: LLMProvider, project?: string): Promise<AutomaticMemoryCandidate[]> {
  return parseAutomaticMemories(await provider.generate(promptFor(entry, project)), entry.prompt);
}
