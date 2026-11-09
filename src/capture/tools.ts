const SUPPORTED_CODING_TOOLS = new Set(['claude', 'codex', 'gemini', 'opencode', 'agy', 'antigravity']);

export function isSupportedCodingTool(tool: string): boolean {
  return SUPPORTED_CODING_TOOLS.has(tool.trim().toLowerCase());
}
