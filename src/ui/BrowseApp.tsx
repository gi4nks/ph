import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { spawn } from 'child_process';
import type { PromptEntry, PromptMetadata } from '../types.js';
import type { PhDB } from '../db/index.js';
import { Header, type ActiveFilters } from './Header.js';
import { Footer } from './Footer.js';
import { THEMES, type Theme } from './themes.js';
import { SearchBar } from './SearchBar.js';
import { ListEntry } from './ListEntry.js';
import { PreviewPane } from './PreviewPane.js';
import { extractTopic } from '../utils/extractTopic.js';
import { load as loadConfig, save as saveConfig } from '../config/index.js';
import type { PhConfig } from '../config/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

const FILTER_CATEGORIES = ['project', 'language', 'role', 'tool', 'tag', 'starred', 'quality', 'relevance'] as const;
type FilterCategory = (typeof FILTER_CATEGORIES)[number];

// Role → color mapping
const ROLE_COLOR: Record<string, string> = {
  debug: 'red',
  refactor: 'yellow',
  explain: 'blue',
  review: 'magenta',
  architect: 'green',
  test: 'cyan',
  docs: 'white',
  generate: 'green',
  research: 'blue',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyToClipboard(text: string) {
  try {
    const platform = process.platform;
    let cmd = '';
    let args: string[] = [];
    if (platform === 'darwin') { cmd = 'pbcopy'; }
    else if (platform === 'win32') { cmd = 'clip'; }
    else { cmd = 'xclip'; args = ['-selection', 'clipboard']; }
    
    const proc = spawn(cmd, args);
    proc.stdin.write(text);
    proc.stdin.end();
  } catch {
    // ignore
  }
}

function wrapTextLines(text: string, width: number): string[] {
  const result: string[] = [];
  for (const line of text.split('\n')) {
    let current = line;
    if (current.length === 0) {
      result.push('');
      continue;
    }
    while (current.length > width) {
      result.push(current.slice(0, width));
      current = current.slice(width);
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

function useStdoutDimensions() {
  const [dimensions, setDimensions] = useState({
    columns: process.stdout.columns || 120,
    rows: process.stdout.rows || 24,
  });

  useEffect(() => {
    const handler = () => {
      setDimensions({
        columns: process.stdout.columns || 120,
        rows: process.stdout.rows || 24,
      });
    };
    process.stdout.on('resize', handler);
    return () => { process.stdout.off('resize', handler); };
  }, []);

  return dimensions;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return ts.slice(0, 16);
  }
}

function parseMeta(raw: string): PromptMetadata {
  try { return JSON.parse(raw) as PromptMetadata; } catch { return {}; }
}

function hasProject(entry: PromptEntry | undefined): boolean {
  if (!entry) return false;
  const meta = parseMeta(entry.metadata);
  return Boolean(meta.project);
}

const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

function formatDateLabel(ts: string): string {
  try {
    const d = new Date(ts);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  } catch {
    return ts.slice(0, 10);
  }
}

function needsSessionSeparator(entries: PromptEntry[], idx: number): boolean {
  if (idx <= 0) return false;
  const prev = new Date(entries[idx - 1].timestamp).getTime();
  const curr = new Date(entries[idx].timestamp).getTime();
  return (prev - curr) > SESSION_GAP_MS;
}

function getDistinctValues(entries: PromptEntry[], category: FilterCategory): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    if (category === 'tool') { set.add(e.tool); continue; }
    const meta = parseMeta(e.metadata);
    if (category === 'project' && meta.project) set.add(meta.project);
    if (category === 'language' && meta.language) set.add(meta.language);
    if (category === 'role' && meta.role) set.add(meta.role);
    if (category === 'tag') meta.tags?.forEach(t => set.add(t));
  }
  return [...set].sort();
}

function applyFilters(
  entries: PromptEntry[],
  active: ActiveFilters,
  textFilter: string
): PromptEntry[] {
  let result = entries;

  const hasActiveFilter = Object.values(active).some(v => v !== undefined && v !== false);
  if (hasActiveFilter) {
    result = result.filter(e => {
      const meta = parseMeta(e.metadata);
      if (active.tool && e.tool !== active.tool) return false;
      if (active.project && meta.project !== active.project) return false;
      if (active.language && meta.language !== active.language) return false;
      if (active.role && meta.role !== active.role) return false;
      if (active.tag && !meta.tags?.includes(active.tag)) return false;
      if (active.starred && !meta.starred) return false;
      if (active.minQuality !== undefined && (meta.quality ?? 0) < active.minQuality) return false;
      if (active.minRelevance !== undefined && (meta.relevance ?? 0) < active.minRelevance) return false;
      return true;
    });
  }

  if (textFilter) {
    const lq = textFilter.toLowerCase();
    result = result.filter(e => {
      const meta = parseMeta(e.metadata);
      return (
        e.prompt.toLowerCase().includes(lq) ||
        e.tool.toLowerCase().includes(lq) ||
        (meta.project?.toLowerCase().includes(lq) ?? false) ||
        (meta.role?.toLowerCase().includes(lq) ?? false) ||
        (meta.tags?.some(t => t.toLowerCase().includes(lq)) ?? false)
      );
    });
  }

  return result;
}

// ─── DetailView ───────────────────────────────────────────────────────────────

interface DetailProps {
  entry: PromptEntry;
  onClose: () => void;
  onEdit: () => void;
  termWidth: number;
  termHeight: number;
  theme: Theme;
}

const DetailView: React.FC<DetailProps> = ({ entry, onClose, onEdit, termWidth, termHeight, theme }) => {
  const meta = parseMeta(entry.metadata);
  const [activeTab, setActiveTab] = useState<'prompt' | 'response' | 'memory'>(entry.response ? 'response' : 'prompt');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setScrollOffset(0);
  }, [activeTab]);

  const contentWidth = Math.max(10, termWidth - 4);
  const text = activeTab === 'prompt' ? entry.prompt : (entry.response || '(no response captured)');
  
  const lines = useMemo(() => {
    if (activeTab === 'prompt' || activeTab === 'response') {
      return wrapTextLines(text, contentWidth);
    }
    
    // Memory tab logic
    const memLines: string[] = [];
    if (meta.summary) {
      memLines.push('SUMMARY:');
      memLines.push(...wrapTextLines(meta.summary, contentWidth));
      memLines.push('');
    }
    if (meta.key_insights && meta.key_insights.length > 0) {
      memLines.push('KEY INSIGHTS:');
      for (const insight of meta.key_insights) {
        memLines.push(...wrapTextLines(`• ${insight}`, contentWidth));
      }
    }
    if (memLines.length === 0) {
      memLines.push('(no AI analysis found - run ph analyze)');
    }
    return memLines;
  }, [activeTab, text, contentWidth, meta]);

  const contentHeight = Math.max(1, termHeight - 10);
  const maxScroll = Math.max(0, lines.length - contentHeight);

  useInput((char, key) => {
    if (key.escape || key.return) onClose();
    else if (char === 'e') onEdit();
    else if (key.tab || char === '1' || char === '2' || char === '3') {
      if (char === '1') setActiveTab('prompt');
      else if (char === '2') setActiveTab('response');
      else if (char === '3') setActiveTab('memory');
      else setActiveTab(t => {
        if (t === 'prompt') return 'response';
        if (t === 'response') return 'memory';
        return 'prompt';
      });
    }
    else if (char === 'y') {
      const copyText = activeTab === 'memory' ? lines.join('\n') : text;
      copyToClipboard(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    else if (key.upArrow) setScrollOffset(s => Math.max(0, s - 1));
    else if (key.downArrow) setScrollOffset(s => Math.min(maxScroll, s + 1));
    else if (key.pageUp) setScrollOffset(s => Math.max(0, s - contentHeight));
    else if (key.pageDown) setScrollOffset(s => Math.min(maxScroll, s + contentHeight));
  });

  const visibleLines = lines.slice(scrollOffset, scrollOffset + contentHeight);
  const remaining = lines.length - (scrollOffset + contentHeight);

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} flexGrow={1}>
      {/* meta1 */}
      <Box>
        <Text color={theme.primary} bold>#{entry.id}</Text>
        <Text dimColor> · {entry.tool} · {formatTimestamp(entry.timestamp)}  </Text>
        {meta.starred && <Text color={theme.warning}>★</Text>}
      </Box>

      {/* meta2 */}
      <Box>
        {meta.project && <Text color={theme.accent}>proj:{meta.project}  </Text>}
        {meta.language && <Text color={theme.dim}>lang:{meta.language}  </Text>}
        {meta.role && (
          <Text color={ROLE_COLOR[meta.role] ?? theme.primary}>role:{meta.role}  </Text>
        )}
        {meta.quality !== undefined && <Text color={theme.success}>Q:{meta.quality}  </Text>}
        {meta.relevance !== undefined && <Text color={theme.warning}>R:{meta.relevance}  </Text>}
        <Text color={entry.exit_code === 0 ? theme.dim : theme.error}>exit:{entry.exit_code}</Text>
      </Box>

      <Box height={1} />

      {/* tab bar */}
      <Box marginBottom={0} justifyContent="space-between">
        <Box>
          <Text color={theme.primary} bold underline={activeTab === 'prompt'}>
            {activeTab === 'prompt' ? '●' : '○'} 1:PROMPT
          </Text>
          <Text>   </Text>
          <Text color={theme.primary} bold underline={activeTab === 'response'}>
            {activeTab === 'response' ? '●' : '○'} 2:RESPONSE
          </Text>
          <Text>   </Text>
          <Text color={theme.primary} bold underline={activeTab === 'memory'}>
            {activeTab === 'memory' ? '●' : '○'} 3:MEMORY
          </Text>
        </Box>
        <Box>
          {copied && <Text color={theme.success}>Copied! </Text>}
          <Text dimColor>[y:copy  e:edit  ESC:back]</Text>
        </Box>
      </Box>

      {/* scroll top */}
      <Box height={1}>
        {scrollOffset > 0 && <Text dimColor>  ↑ {scrollOffset} above</Text>}
      </Box>

      {/* content */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.map((line, i) => (
          <Text key={i}>{line || ' '}</Text>
        ))}
        {Array.from({ length: Math.max(0, contentHeight - visibleLines.length) }).map((_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
      </Box>

      {/* scroll bot */}
      <Box height={1}>
        {remaining > 0 && <Text dimColor>  ↓ {remaining} more</Text>}
      </Box>
    </Box>
  );
};

// ─── EditView ─────────────────────────────────────────────────────────────────

interface EditProps {
  entry: PromptEntry;
  onSave: (meta: PromptMetadata) => void;
  onClose: () => void;
  theme: Theme;
}

const EditView: React.FC<EditProps> = ({ entry, onSave, onClose, theme }) => {
  const initMeta = parseMeta(entry.metadata);

  const [field, setField] = useState<'title' | 'role' | 'tags'>('title');
  const [titleValue, setTitleValue] = useState(initMeta.title ?? extractTopic(entry.prompt));
  const [roleValue, setRoleValue] = useState(initMeta.role ?? '');
  const [tagsValue, setTagsValue] = useState(initMeta.tags?.join(', ') ?? '');

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) {
      const newMeta: PromptMetadata = { ...initMeta };
      const trimmedTitle = titleValue.trim();
      newMeta.title = trimmedTitle || undefined;
      const trimmedRole = roleValue.trim();
      newMeta.role = trimmedRole || undefined;
      const parsedTags = tagsValue.split(',').map(t => t.trim()).filter(Boolean);
      newMeta.tags = parsedTags.length > 0 ? parsedTags : undefined;
      onSave(newMeta);
      return;
    }
    if (key.tab) {
      setField(f => {
        if (f === 'title') return 'role';
        if (f === 'role') return 'tags';
        return 'title';
      });
      return;
    }
    const setter =
      field === 'title' ? setTitleValue :
      field === 'role'  ? setRoleValue  :
                          setTagsValue;
    if (key.backspace || key.delete) {
      setter(v => v.slice(0, -1));
    } else if (char && !key.ctrl && !key.meta) {
      setter(v => v + char);
    }
  });

  const ROLES = 'debug · refactor · explain · review · architect · test · docs · generate · research';

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>Edit Metadata — Prompt #{entry.id}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} padding={1}>
        <Box marginBottom={1}>
          <Text dimColor>Title: </Text>
          <Text color={field === 'title' ? theme.primary : 'white'} bold={field === 'title'}>
            {titleValue || '(none)'}{field === 'title' ? '█' : ''}
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text dimColor>Role:  </Text>
          <Text color={field === 'role' ? theme.primary : 'white'} bold={field === 'role'}>
            {roleValue || '(none)'}{field === 'role' ? '█' : ''}
          </Text>
        </Box>
        <Box>
          <Text dimColor>Tags:  </Text>
          <Text color={field === 'tags' ? theme.primary : 'white'} bold={field === 'tags'}>
            {tagsValue || '(none)'}{field === 'tags' ? '█' : ''}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Roles: {ROLES}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Tab switch field · Enter save · ESC cancel</Text>
      </Box>
    </Box>
  );
};

// ─── RerunView ────────────────────────────────────────────────────────────────

interface RerunProps {
  entry: PromptEntry;
  onConfirm: (tool: string, prompt: string) => void;
  onClose: () => void;
  theme: Theme;
}

const RerunView: React.FC<RerunProps> = ({ entry, onConfirm, onClose, theme }) => {
  const [field, setField] = useState<'tool' | 'prompt'>('prompt');
  const [toolValue, setToolValue] = useState(entry.tool);
  const [promptValue, setPromptValue] = useState(entry.prompt);

  const meta = parseMeta(entry.metadata);
  const git = meta.git_context;

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) {
      onConfirm(toolValue.trim(), promptValue.trim());
      return;
    }
    if (key.tab) {
      setField(f => f === 'tool' ? 'prompt' : 'tool');
      return;
    }

    const setter = field === 'tool' ? setToolValue : setPromptValue;
    if (key.backspace || key.delete) {
      setter(v => v.slice(0, -1));
    } else if (char && !key.ctrl && !key.meta) {
      setter(v => v + char);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>Rerun Prompt #{entry.id}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Tool:      <Text color={theme.warning}>{entry.tool}</Text></Text>
        <Text dimColor>Date:      <Text>{formatTimestamp(entry.timestamp)}</Text></Text>
        {meta.project && <Text dimColor>Project:   <Text color={theme.accent}>{meta.project}</Text></Text>}
        {git && (
          <Text dimColor>Git:       <Text color={theme.warning}>Captured on branch: {git.branch}, {git.files?.length || 0} files modified</Text></Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} padding={1}>
        <Box marginBottom={1}>
          <Text dimColor>Tool:   </Text>
          <Text color={field === 'tool' ? theme.primary : 'white'} bold={field === 'tool'}>
            {toolValue}{field === 'tool' ? '█' : ''}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Prompt: </Text>
          <Box borderStyle="round" borderColor={field === 'prompt' ? theme.primary : theme.dim} paddingX={1}>
            <Text color={field === 'prompt' ? theme.primary : 'white'}>
              {promptValue}{field === 'prompt' ? '█' : ''}
            </Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Tab switch · Enter run · ESC cancel</Text>
      </Box>
    </Box>
  );
};

// ─── FilterPanel ──────────────────────────────────────────────────────────────

interface FilterOption {
  category: FilterCategory;
  label: string;
  count: number;
  active: boolean;
}

interface FilterPanelProps {
  allEntries: PromptEntry[];
  active: ActiveFilters;
  onUpdate: (filters: ActiveFilters) => void;
  onClose: () => void;
  theme: Theme;
}

const FilterPanel: React.FC<FilterPanelProps> = ({ allEntries, active, onUpdate, onClose, theme }) => {
  const options = useMemo<FilterOption[]>(() => {
    const opts: FilterOption[] = [];
    for (const cat of FILTER_CATEGORIES) {
      if (cat === 'starred') {
        const count = allEntries.filter(e => { try { return JSON.parse(e.metadata).starred; } catch { return false; } }).length;
        opts.push({ category: 'starred', label: '★ Only starred', count, active: !!active.starred });
      } else if (cat === 'quality') {
        const qActive = active.minQuality !== undefined;
        opts.push({ category: 'quality', label: `Q ≥ ${active.minQuality ?? '?'}`, count: 0, active: qActive });
        for (const v of [1,2,3,4,5,6,7,8,9,10]) {
          const c = allEntries.filter(e => { try { return (JSON.parse(e.metadata).quality ?? 0) >= v; } catch { return false; } }).length;
          opts.push({ category: 'quality', label: `Q ≥ ${v}`, count: c, active: active.minQuality === v });
        }
      } else if (cat === 'relevance') {
        const rActive = active.minRelevance !== undefined;
        opts.push({ category: 'relevance', label: `R ≥ ${active.minRelevance ?? '?'}`, count: 0, active: rActive });
        for (const v of [1,2,3,4,5,6,7,8,9,10]) {
          const c = allEntries.filter(e => { try { return (JSON.parse(e.metadata).relevance ?? 0) >= v; } catch { return false; } }).length;
          opts.push({ category: 'relevance', label: `R ≥ ${v}`, count: c, active: active.minRelevance === v });
        }
      } else {
        const vals = getDistinctValues(allEntries, cat);
        for (const v of vals) {
          const c = allEntries.filter(e => {
            try {
              const m = JSON.parse(e.metadata) as PromptMetadata;
              if (cat === 'project') return m.project === v;
              if (cat === 'language') return m.language === v;
              if (cat === 'role') return m.role === v;
              if (cat === 'tool') return e.tool === v;
              if (cat === 'tag') return m.tags?.includes(v);
              return false;
            } catch { return false; }
          }).length;
          const currentVal = active[cat as keyof Omit<ActiveFilters, 'starred' | 'minQuality' | 'minRelevance'>];
          opts.push({ category: cat, label: v, count: c, active: currentVal === v });
        }
      }
    }
    return opts;
  }, [allEntries, active]);

  const [cursor, setCursor] = useState(0);
  const visibleCount = Math.min(options.length, 16);
  const scrollOffset = Math.max(0, Math.min(cursor - Math.floor(visibleCount / 2), options.length - visibleCount));
  const visible = options.slice(Math.max(0, scrollOffset), scrollOffset + visibleCount);

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (char === 'c') { onUpdate({}); return; }
    if (key.return || char === ' ') {
      const opt = options[cursor];
      if (!opt) return;
      if (opt.category === 'starred') {
        onUpdate({ ...active, starred: !opt.active || undefined });
      } else if (opt.category === 'quality') {
        const v = parseInt(opt.label.replace('Q ≥ ', ''), 10);
        onUpdate({ ...active, minQuality: opt.active ? undefined : v });
      } else if (opt.category === 'relevance') {
        const v = parseInt(opt.label.replace('R ≥ ', ''), 10);
        onUpdate({ ...active, minRelevance: opt.active ? undefined : v });
      } else {
        const key = opt.category as keyof Omit<ActiveFilters, 'starred' | 'minQuality' | 'minRelevance'>;
        if (opt.active) {
          const updated = { ...active };
          delete updated[key];
          onUpdate(updated);
        } else {
          onUpdate({ ...active, [key]: opt.label });
        }
      }
      return;
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(options.length - 1, c + 1));
    if (key.pageUp) setCursor(c => Math.max(0, c - visibleCount));
    if (key.pageDown) setCursor(c => Math.min(options.length - 1, c + visibleCount));
    // Jump to category by first letter
    if (char && /^[a-z]$/.test(char)) {
      const idx = options.findIndex((o, i) => i > cursor && o.category[0] === char);
      if (idx !== -1) setCursor(idx);
    }
  });

  const activeCount = Object.values(active).filter(v => v !== undefined && v !== false).length;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>Filters  </Text>
        {activeCount > 0
          ? <Text color={theme.warning}>{activeCount} active  </Text>
          : <Text dimColor>none active  </Text>
        }
        {activeCount > 0 && <Text dimColor>(c clear)</Text>}
      </Box>

      <Box borderStyle="single" borderColor={theme.dim} flexDirection="column" padding={1} minHeight={18}>
        <Box flexDirection="column">
          {visible.map((opt, i) => {
            const absIdx = Math.max(0, scrollOffset) + i;
            const isCur = absIdx === cursor;
            const catColor = opt.category === 'project' ? 'blue' : opt.category === 'language' ? 'green' : opt.category === 'role' ? ROLE_COLOR[opt.label] || 'cyan' : opt.category === 'tool' ? 'yellow' : opt.category === 'tag' ? 'cyan' : 'white';
            return (
              <Box key={`${opt.category}-${opt.label}`}>
                <Text bold={isCur} color={isCur ? theme.primary : theme.dim}>
                  {isCur ? '❯ ' : '  '}
                </Text>
                <Text color={opt.active ? theme.warning : catColor} bold={opt.active || isCur}>
                  {opt.category}:{opt.label}
                </Text>
                <Text dimColor> [{opt.count}]</Text>
                {opt.active && <Text color={theme.success}> ✓</Text>}
              </Box>
            );
          })}
        </Box>
        {options.length > visibleCount && (
          <Box marginTop={1}>
            <Text dimColor>  {cursor + 1}/{options.length} · ↑↓ navigate · Enter toggle · c clear · ESC close</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter toggle · c clear all · ESC close · letter jumps to category</Text>
      </Box>
    </Box>
  );
};

// ─── SettingsView ─────────────────────────────────────────────────────────────

const SETTING_FIELDS: { key: keyof PhConfig; label: string; type: 'boolean' | 'string' | 'number' }[] = [
  { key: 'backgroundAnalysis', label: 'Auto-analysis on capture', type: 'boolean' },
  { key: 'ollamaUrl', label: 'Ollama URL', type: 'string' },
  { key: 'ollamaModel', label: 'Ollama model (analysis)', type: 'string' },
  { key: 'ollamaEmbedModel', label: 'Ollama model (embeddings)', type: 'string' },
  { key: 'analyzeProvider', label: 'Analysis provider', type: 'string' },
  { key: 'filterMinLength', label: 'Min prompt length filter', type: 'number' },
  { key: 'filterMinRelevance', label: 'Min relevance filter', type: 'number' },
];

interface SettingsViewProps {
  onClose: () => void;
  theme: Theme;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onClose, theme }) => {
  const [cfg, setCfg] = useState<PhConfig>(() => loadConfig());
  const [cursor, setCursor] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleField = (key: keyof PhConfig) => {
    const updated = { ...cfg };
    if (key === 'backgroundAnalysis') {
      updated[key] = !(cfg[key] as boolean);
    }
    setCfg(updated);
    setDirty(true);
    setSaved(false);
  };

  const save = () => {
    saveConfig(cfg);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (char === 'q') { onClose(); return; }
    if (char === 's' && dirty) { save(); return; }

    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(SETTING_FIELDS.length - 1, c + 1));

    if (key.return || char === ' ') {
      const field = SETTING_FIELDS[cursor];
      if (!field) return;
      if (field.type === 'boolean') {
        toggleField(field.key);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>Settings  </Text>
        {dirty && <Text color={theme.warning}>modified  </Text>}
        {saved && <Text color={theme.success}>✓ saved</Text>}
      </Box>

      <Box borderStyle="single" borderColor={theme.dim} flexDirection="column" padding={1}>
        {SETTING_FIELDS.map((field, i) => {
          const isCur = i === cursor;
          const val = cfg[field.key];
          let display: string;
          if (field.type === 'boolean') {
            display = val ? 'true' : 'false';
          } else {
            display = val !== undefined ? String(val) : '(default)';
          }
          const valColor = field.type === 'boolean'
            ? (val ? theme.success : theme.dim)
            : (val !== undefined ? 'white' : theme.dim);

          return (
            <Box key={field.key}>
              <Text bold={isCur} color={isCur ? theme.primary : theme.dim}>
                {isCur ? '❯ ' : '  '}
              </Text>
              <Text color={isCur ? theme.primary : 'white'}>
                {field.label}
              </Text>
              <Text>{'  '.repeat(Math.max(1, 30 - field.label.length))}</Text>
              <Text color={valColor} bold={field.type === 'boolean' && isCur}>
                {display}
              </Text>
              {field.type === 'boolean' && isCur && (
                <Text color={theme.warning}>  [Enter toggle]</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate · Enter toggle boolean · {dirty ? 's save · ' : ''}q/ESC close
        </Text>
      </Box>
    </Box>
  );
};

// ─── BrowseApp ────────────────────────────────────────────────────────────────

interface Props {
  db: PhDB;
  initialTextFilter?: string;
  initialFilters?: ActiveFilters;
  onRerun?: (tool: string, prompt: string) => void;
}

export const BrowseApp: React.FC<Props> = ({ db, initialTextFilter, initialFilters, onRerun }) => {
  const { exit } = useApp();

  const [allEntries, setAllEntries] = useState<PromptEntry[]>(() => db.search({ limit: 1000 }));
  const [refreshKey, setRefreshKey] = useState(0);

  const [textFilter, setTextFilter]     = useState(initialTextFilter ?? '');
  const [isTextFiltering, setTextFiltering] = useState(false);
  const [activeFilters, setActiveFilters]  = useState<ActiveFilters>(initialFilters ?? {});
  const [showFilterPanel, setFilterPanel]  = useState(false);
  const [showSettings, setShowSettings]    = useState(false);

  const [cursor, setCursor]   = useState(0);
  const [detail, setDetail]   = useState<PromptEntry | null>(null);
  const [editing, setEditing] = useState<PromptEntry | null>(null);
  const [rerunning, setRerunning] = useState<PromptEntry | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // New state for split-pane focus
  const [focusPane, setFocusPane] = useState<'list' | 'preview'>('list');
  const [scrollOffset, setScrollOffset] = useState(0);

  const currentThemeName = 'dark'; // Could be made stateful later
  const theme = THEMES[currentThemeName] || THEMES.dark;

  const { columns: termWidth, rows: termHeight } = useStdoutDimensions();
  
  const SPLIT_THRESHOLD = 100;
  const isWide = termWidth >= SPLIT_THRESHOLD;
  const leftPaneWidth = isWide ? Math.max(32, Math.min(50, Math.floor(termWidth * 0.33))) : termWidth;

  // Wide mode: header(1) + searchbar(1) + footer(1) + pane-header(1) = 4 overhead lines.
  // n list entries occupy 4n-1 lines (3 per entry + 1 separator, except last).
  // n = floor((termHeight - 4 + 1) / 4) = floor((termHeight - 3) / 4)
  const PAGE_SIZE = Math.max(1, Math.floor((termHeight - 3) / 4));

  // Derived filtered entries — recomputed when filters or refreshKey change
  const entries = useMemo(
    () => applyFilters(allEntries, activeFilters, textFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEntries, activeFilters, textFilter, refreshKey]
  );

  // Clamp cursor when entries shrink
  useEffect(() => {
    setCursor(c => Math.min(c, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  // Scroll vim-style: muovi il viewport solo quando il cursore esce dal range visibile.
  useEffect(() => {
    setScrollOffset(prev => {
      const clamped = Math.max(0, Math.min(prev, Math.max(0, entries.length - PAGE_SIZE)));
      if (cursor < clamped)                  return cursor;
      if (cursor >= clamped + PAGE_SIZE)     return cursor - PAGE_SIZE + 1;
      return clamped;
    });
  }, [cursor, PAGE_SIZE, entries.length]);

  const pageStart = scrollOffset;
  const visible   = entries.slice(pageStart, pageStart + PAGE_SIZE);

  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const toggleStar = useCallback((entry: PromptEntry) => {
    const meta = parseMeta(entry.metadata);
    meta.starred = !meta.starred;
    const newMeta = JSON.stringify(meta);
    db.updateMetadata(entry.id, newMeta);
    entry.metadata = newMeta;
    triggerRefresh();
  }, [db, triggerRefresh]);

  const handleDelete = useCallback((entry: PromptEntry) => {
    db.deleteById(entry.id);
    setAllEntries(prev => prev.filter(e => e.id !== entry.id));
    // entries and cursor will update automatically
  }, [db]);

  const handleSaveEdit = useCallback((entry: PromptEntry, meta: PromptMetadata) => {
    const newMeta = JSON.stringify(meta);
    db.updateMetadata(entry.id, newMeta);
    entry.metadata = newMeta;
    setEditing(null);
    triggerRefresh();
  }, [db, triggerRefresh]);

  const handleFilterUpdate = useCallback((filters: ActiveFilters) => {
    setActiveFilters(filters);
    setCursor(0);
    setScrollOffset(0);
  }, []);

  useInput((char, key) => {
    if (detail || editing || showFilterPanel || showSettings || rerunning) return;

    // Search mode
    if (isTextFiltering) {
      if (key.escape) { setTextFiltering(false); setTextFilter(''); }
      else if (key.return) { setTextFiltering(false); }
      else if (key.backspace || key.delete) { setTextFilter(v => v.slice(0, -1)); }
      else if (char && !key.ctrl) { setTextFilter(v => v + char); }
      return;
    }

    // Global shortcuts
    if (key.escape) {
      if (isWide && focusPane === 'preview') { setFocusPane('list'); return; }
      exit();
      return;
    }
    else if (char === 'q') { exit(); }
    else if (char === '/')           { setTextFiltering(true); }
    else if (char === 's')           { if (entries[cursor]) toggleStar(entries[cursor]); }
    else if (char === 'e')           { if (entries[cursor]) setEditing(entries[cursor]); }
    else if (char === 'r')           { if (entries[cursor]) setRerunning(entries[cursor]); }
    else if (char === 'x')           { if (entries[cursor]) handleDelete(entries[cursor]); }
    else if (char === 'f')           { setFilterPanel(true); }
    else if (char === 'o')           { setShowSettings(true); }
    else if (char === 'c')           { setActiveFilters({}); setTextFilter(''); setCursor(0); setScrollOffset(0); }
    else if (char === 'C') {
      // Chat: launch tool with project context injected
      const entry = entries[cursor];
      if (!entry) return;
      const meta = parseMeta(entry.metadata);
      const project = meta.project;
      if (!project) return;
      const memories = db.searchMemories(project, 3);
      const recent = db.getProjectMemory(project, 5);
      const ctx: string[] = [];
      if (memories.length > 0) {
        ctx.push(`## Project Knowledge: ${project}`);
        for (const mem of memories) {
          if (mem.summary) ctx.push(`\n${mem.summary}`);
          if (mem.key_insights.length > 0) {
            ctx.push('\nKey Insights:');
            for (const i of mem.key_insights) ctx.push(`  - ${i}`);
          }
          if (mem.technical_decisions.length > 0) {
            ctx.push('\nTechnical Decisions:');
            for (const d of mem.technical_decisions) ctx.push(`  - ${d}`);
          }
        }
      }
      if (recent.length > 0) {
        ctx.push('\n---\n## Recent Context');
        for (const p of recent) {
          const pm = parseMeta(p.metadata);
          ctx.push(`\n- #${p.id}: ${pm.summary || p.prompt.slice(0, 100).replace(/\n/g, ' ')}`);
        }
      }
      const fullPrompt = `Context from project "${project}":\n\n${ctx.join('\n')}\n\n---\n\n${entry.prompt}`;
      onRerun?.(entry.tool, fullPrompt);
      exit();
    }
    else if (char === 'y') {
      if (entries[cursor]) {
        copyToClipboard(entries[cursor].prompt);
        setCopiedId(entries[cursor].id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    }

    // Tab: in wide mode switch focus
    else if (key.tab && isWide) {
      setFocusPane(p => p === 'list' ? 'preview' : 'list');
    }

    // List navigation
    else if (focusPane === 'list' || !isWide) {
      if (key.upArrow)    { setCursor(c => Math.max(0, c - 1)); }
      else if (key.downArrow) { setCursor(c => Math.min(entries.length - 1, c + 1)); }
      else if (key.pageUp)    { setCursor(c => Math.max(0, c - PAGE_SIZE)); }
      else if (key.pageDown)  { setCursor(c => Math.min(entries.length - 1, c + PAGE_SIZE)); }
      else if (key.return) {
        if (isWide) {
          if (entries[cursor]) {
            copyToClipboard(entries[cursor].prompt);
            setCopiedId(entries[cursor].id);
            setTimeout(() => setCopiedId(null), 2000);
          }
        } else {
          if (entries[cursor]) setDetail(entries[cursor]);
        }
      }
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  let mainContent;
  if (showSettings) {
    mainContent = (
      <SettingsView
        onClose={() => setShowSettings(false)}
        theme={theme}
      />
    );
  } else if (showFilterPanel) {
    mainContent = (
      <FilterPanel
        allEntries={allEntries}
        active={activeFilters}
        onUpdate={handleFilterUpdate}
        onClose={() => setFilterPanel(false)}
        theme={theme}
      />
    );
  } else if (rerunning) {
    mainContent = (
      <RerunView
        entry={rerunning}
        onConfirm={(tool, prompt) => {
          onRerun?.(tool, prompt);
          setRerunning(null);
          exit();
        }}
        onClose={() => setRerunning(null)}
        theme={theme}
      />
    );
  } else if (editing) {
    mainContent = (
      <EditView
        entry={editing}
        onSave={meta => handleSaveEdit(editing, meta)}
        onClose={() => setEditing(null)}
        theme={theme}
      />
    );
  } else if (detail && !isWide) {
    mainContent = (
      <DetailView
        entry={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { setEditing(detail); setDetail(null); }}
        termWidth={termWidth}
        termHeight={termHeight}
        theme={theme}
      />
    );
  } else if (isWide) {
    const listFocused    = focusPane === 'list';
    const previewFocused = focusPane === 'preview';
    mainContent = (
      <Box flexDirection="row" flexGrow={1}>
        {/* Left Pane: List */}
        <Box flexDirection="column" width={leftPaneWidth}>
          {/* Pane header — focus indicator */}
          <Box paddingX={1}>
            <Text color={listFocused ? theme.primary : theme.dim} bold={listFocused}>
              {listFocused ? '❯ ' : '  '}HISTORY
            </Text>
            {entries.length > 0 && (
              <Text color={theme.dim}>  {cursor + 1}/{entries.length}</Text>
            )}
          </Box>
          {entries.length === 0 ? (
            <Box paddingX={1}>
              <Text dimColor>(no results)</Text>
            </Box>
          ) : (
            visible.map((entry, i) => {
              const absIdx = pageStart + i;
              const isNewSession = needsSessionSeparator(entries, absIdx);
              return (
                <React.Fragment key={entry.id}>
                  {isNewSession && (
                    <Box>
                      <Text color={theme.dim}>
                        {'╌'.repeat(2)} {formatDateLabel(entry.timestamp)} {'╌'.repeat(leftPaneWidth - 4 - formatDateLabel(entry.timestamp).length)}
                      </Text>
                    </Box>
                  )}
                  <ListEntry
                    entry={entry}
                    isSelected={absIdx === cursor}
                    paneWidth={leftPaneWidth}
                    theme={theme}
                  />
                  {i < visible.length - 1 && !needsSessionSeparator(entries, absIdx + 1) && (
                    <Box>
                      <Text color={theme.dim}>{'·'.repeat(Math.max(1, leftPaneWidth - 2))}</Text>
                    </Box>
                  )}
                </React.Fragment>
              );
            })
          )}
        </Box>
        {/* Vertical separator + Preview Pane — border color reflects focus */}
        <Box
          borderLeft
          borderStyle="single"
          borderColor={previewFocused ? theme.primary : theme.dim}
          flexGrow={1}
          flexDirection="column"
        >
          <PreviewPane
            entry={entries[cursor] ?? null}
            paneWidth={termWidth - leftPaneWidth - 1}
            paneHeight={termHeight - 3}
            isFocused={previewFocused}
            theme={theme}
            getProjectMemories={(p) => db.searchMemories(p, 3)}
          />
        </Box>
      </Box>
    );

  } else {
    // Narrow Mode List
    mainContent = (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {entries.length === 0 ? (
          <Box marginTop={1}>
            <Text color={theme.dim}>(no results)</Text>
          </Box>
        ) : (
          visible.map((entry, i) => {
            const absIdx = pageStart + i;
            const isNewSession = needsSessionSeparator(entries, absIdx);
            return (
              <React.Fragment key={entry.id}>
                  {isNewSession && (
                    <Box>
                      <Text color={theme.dim}>
                        {'╌'.repeat(2)} {formatDateLabel(entry.timestamp)} {'╌'.repeat(termWidth - 4 - formatDateLabel(entry.timestamp).length)}
                      </Text>
                    </Box>
                  )}
                  <ListEntry
                    entry={entry}
                    isSelected={absIdx === cursor}
                    paneWidth={termWidth}
                    theme={theme}
                  />
                {i < visible.length - 1 && !needsSessionSeparator(entries, absIdx + 1) && (
                  <Box>
                    <Text color={theme.dim}>{'·'.repeat(Math.max(1, termWidth - 2))}</Text>
                  </Box>
                )}
              </React.Fragment>
            );
          })
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header 
        entriesCount={entries.length} 
        allEntriesCount={allEntries.length}
        activeFilters={activeFilters}
        textFilter={textFilter}
        isTextFiltering={false} // SearchBar handles it
        theme={currentThemeName}
      />
      
      <SearchBar value={textFilter} isActive={isTextFiltering} theme={theme} />

      <Box flexGrow={1}>
        {mainContent}
      </Box>

      <Footer 
        cursor={cursor} 
        total={entries.length} 
        copiedId={copiedId} 
        isWide={isWide}
        hasDetail={Boolean(entries[cursor] && isWide)}
        hasProject={hasProject(entries[cursor])}
        theme={currentThemeName}
      />
    </Box>
  );
};
