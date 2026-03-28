import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { spawn } from 'child_process';
import type { PromptEntry, PromptMetadata } from '../types.js';
import type { PhDB } from '../db/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

const FILTER_CATEGORIES = ['project', 'language', 'role', 'tool', 'tag', 'starred', 'quality', 'relevance'] as const;
type FilterCategory = (typeof FILTER_CATEGORIES)[number];

interface ActiveFilters {
  project?: string;
  language?: string;
  role?: string;
  tool?: string;
  tag?: string;
  starred?: boolean;
  minQuality?: number;
  minRelevance?: number;
}

const CATEGORY_LABEL: Record<FilterCategory, string> = {
  project: 'Project',
  language: 'Language',
  role: 'Role',
  tool: 'Tool',
  tag: 'Tag',
  starred: 'Starred',
  quality: 'Quality',
  relevance: 'Relevance',
};

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

function truncate(s: string, max: number): string {
  const flat = s.replace(/\n/g, ' ');
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

function parseMeta(raw: string): PromptMetadata {
  try { return JSON.parse(raw) as PromptMetadata; } catch { return {}; }
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

// ─── PromptRow ────────────────────────────────────────────────────────────────

interface RowProps {
  entry: PromptEntry;
  isSelected: boolean;
  termWidth: number;
}

const PromptRow: React.FC<RowProps> = ({ entry, isSelected, termWidth }) => {
  const meta = parseMeta(entry.metadata);
  const sel = isSelected;

  const star    = meta.starred ? '★ ' : '  ';
  const proj    = meta.project ? `[${meta.project}${meta.language ? ':' + meta.language : ''}] ` : '';
  const roleStr = meta.role ? `{${meta.role}} ` : '';
  const tags    = meta.tags?.length ? `(${meta.tags.join(',')}) ` : '';
  const cursor  = sel ? '❯ ' : '  ';

  const roleColor = (meta.role && ROLE_COLOR[meta.role]) || 'cyan';
  const maxPrompt = Math.max(20, termWidth - 10);

  const scores = (meta.relevance !== undefined || meta.quality !== undefined) ? (
    <Text color="gray">
      {' ['}
      <Text color={meta.relevance && meta.relevance >= 7 ? 'green' : 'gray'}>R:{meta.relevance ?? '?'}</Text>
      {'|'}
      <Text color={meta.quality && meta.quality >= 7 ? 'green' : 'gray'}>Q:{meta.quality ?? '?'}</Text>
      {'] '}
    </Text>
  ) : null;

  return (
    <Box>
      <Box width={2}>
        <Text color="cyan" bold={sel}>{cursor}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box>
          <Text color={sel ? 'yellow' : undefined} bold={sel}>{`#${entry.id}`.padEnd(7)}</Text>
          <Text color={sel ? 'white' : 'yellow'}>{star}</Text>
          <Text color={sel ? 'white' : 'gray'}>{formatTimestamp(entry.timestamp)}{'  '}</Text>
          <Text color={sel ? 'cyan' : 'blue'}>{entry.tool.padEnd(8)}</Text>
          {scores}
          {proj ? <Text color={sel ? 'white' : 'gray'}>{proj}</Text> : null}
          {meta.role ? <Text color={roleColor} dimColor={!sel}>{roleStr}</Text> : null}
          {tags ? <Text color={sel ? 'white' : 'gray'} dimColor={!sel}>{tags}</Text> : null}
        </Box>
        <Box>
          <Text color={sel ? 'white' : 'gray'} wrap="truncate">
            {truncate(entry.prompt, maxPrompt)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

// ─── DetailView ───────────────────────────────────────────────────────────────

interface DetailProps {
  entry: PromptEntry;
  onClose: () => void;
  onEdit: () => void;
  termWidth: number;
  termHeight: number;
}

interface DetailProps {
  entry: PromptEntry;
  onClose: () => void;
  onEdit: () => void;
  termWidth: number;
  termHeight: number;
}

const DetailView: React.FC<DetailProps> = ({ entry, onClose, onEdit, termWidth, termHeight }) => {
  const meta = parseMeta(entry.metadata);
  const roleColor = (meta.role && ROLE_COLOR[meta.role]) || 'cyan';

  const [activeTab, setActiveTab] = useState<'prompt' | 'response'>(entry.response ? 'response' : 'prompt');
  const [scroll, setScroll] = useState(0);
  const [copied, setCopied] = useState(false);

  // Reset scroll when switching tabs
  useEffect(() => {
    setScroll(0);
  }, [activeTab]);

  const content = activeTab === 'prompt' ? entry.prompt : (entry.response || '(no response captured)');
  const lines = useMemo(() => wrapTextLines(content, termWidth - 4), [content, termWidth]);
  const availableLines = Math.max(5, termHeight - 14);

  useInput((char, key) => {
    if (key.escape || key.return) onClose();
    else if (char === 'e') onEdit();
    else if (key.tab) {
      setActiveTab(t => t === 'prompt' ? 'response' : 'prompt');
    }
    else if (char === '1') setActiveTab('prompt');
    else if (char === '2') setActiveTab('response');
    else if (char === 'y') {
      copyToClipboard(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    else if (key.upArrow) setScroll(s => Math.max(0, s - 1));
    else if (key.downArrow) setScroll(s => Math.min(Math.max(0, lines.length - availableLines), s + 1));
    else if (key.pageUp) setScroll(s => Math.max(0, s - availableLines));
    else if (key.pageDown) setScroll(s => Math.min(Math.max(0, lines.length - availableLines), s + availableLines));
  });

  const visibleLines = lines.slice(scroll, scroll + availableLines);
  const paddedLines = [...visibleLines];
  while (paddedLines.length < availableLines) paddedLines.push(' ');

  return (
    <Box flexDirection="column" height={termHeight}>
      <Box flexDirection="column" paddingX={1} paddingTop={1} flexGrow={1}>
        {/* Header with Metadata */}
        <Box marginBottom={1} justifyContent="space-between">
          <Box flexDirection="column" flexGrow={1}>
            <Box>
              <Text color="cyan" bold>Prompt #{entry.id} </Text>
              <Text dimColor>· {entry.tool} · {formatTimestamp(entry.timestamp)}</Text>
              {meta.starred && <Text color="yellow">  ★ starred</Text>}
            </Box>
            
            <Box marginTop={0}>
              {meta.project && <Text color="blue">{meta.project} </Text>}
              {meta.language && <Text color="gray">({meta.language}) </Text>}
              {meta.role && <Text color={roleColor}>[{meta.role}] </Text>}
              {meta.relevance !== undefined && <Text color="yellow">R:{meta.relevance} </Text>}
              {meta.quality !== undefined && <Text color="green">Q:{meta.quality} </Text>}
              <Text color={entry.exit_code === 0 ? 'gray' : 'red'}>exit:{entry.exit_code}</Text>
            </Box>

            {meta.tags && meta.tags.length > 0 && (
              <Box marginTop={0}>
                <Text dimColor>tags: </Text>
                <Text color="cyan">{meta.tags.join(', ')}</Text>
              </Box>
            )}

            {entry.workdir && (
              <Box marginTop={0}>
                <Text dimColor>dir: </Text>
                <Text color="gray">{entry.workdir}</Text>
              </Box>
            )}
          </Box>
        </Box>

        {/* Tabs Header - Clean Style */}
        <Box paddingX={1}>
          <Box 
            paddingX={2} 
            backgroundColor={activeTab === 'prompt' ? 'cyan' : undefined}
          >
            <Text color={activeTab === 'prompt' ? 'black' : 'white'} bold={activeTab === 'prompt'}>
              [1] Prompt
            </Text>
          </Box>
          <Box 
            paddingX={2} 
            backgroundColor={activeTab === 'response' ? 'cyan' : undefined}
            marginLeft={1}
          >
            <Text color={activeTab === 'response' ? 'black' : 'white'} bold={activeTab === 'response'}>
              [2] Response
            </Text>
          </Box>
        </Box>

        {/* Content Box */}
        <Box borderStyle="single" borderColor="cyan" padding={1} flexDirection="column" flexGrow={1}>
          {paddedLines.map((line, i) => (
            <Text key={i}>{line || ' '}</Text>
          ))}
        </Box>
      </Box>

      {/* Footer Instructions */}
      <Box paddingX={1} borderStyle="single" borderColor="gray" justifyContent="space-between">
        <Text dimColor>TAB switch · 1/2 tabs · e edit · y copy · ↑↓ scroll · ESC back</Text>
        <Text color="green">
          {copied ? 'Copied!' : `${lines.length > 0 ? scroll + 1 : 0}-${Math.min(scroll + availableLines, lines.length)} / ${lines.length}`}
        </Text>
      </Box>
    </Box>
  );
};

// ─── EditView ─────────────────────────────────────────────────────────────────

interface EditProps {
  entry: PromptEntry;
  onSave: (meta: PromptMetadata) => void;
  onClose: () => void;
}

const EditView: React.FC<EditProps> = ({ entry, onSave, onClose }) => {
  const initMeta = parseMeta(entry.metadata);

  const [field, setField] = useState<'role' | 'tags'>('role');
  const [roleValue, setRoleValue] = useState(initMeta.role ?? '');
  const [tagsValue, setTagsValue] = useState(initMeta.tags?.join(', ') ?? '');

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) {
      const newMeta: PromptMetadata = { ...initMeta };
      const trimmedRole = roleValue.trim();
      newMeta.role = trimmedRole || undefined;
      const parsedTags = tagsValue.split(',').map(t => t.trim()).filter(Boolean);
      newMeta.tags = parsedTags.length > 0 ? parsedTags : undefined;
      onSave(newMeta);
      return;
    }
    if (key.tab) {
      setField(f => f === 'role' ? 'tags' : 'role');
      return;
    }
    const setter = field === 'role' ? setRoleValue : setTagsValue;
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
        <Text color="cyan" bold>Edit Metadata — Prompt #{entry.id}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        <Box marginBottom={1}>
          <Text dimColor>Role:  </Text>
          <Text color={field === 'role' ? 'cyan' : 'white'} bold={field === 'role'}>
            {roleValue || '(none)'}{field === 'role' ? '█' : ''}
          </Text>
        </Box>
        <Box>
          <Text dimColor>Tags:  </Text>
          <Text color={field === 'tags' ? 'cyan' : 'white'} bold={field === 'tags'}>
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
}

const RerunView: React.FC<RerunProps> = ({ entry, onConfirm, onClose }) => {
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
        <Text color="cyan" bold>Rerun Prompt #{entry.id}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Tool:      <Text color="yellow">{entry.tool}</Text></Text>
        <Text dimColor>Date:      <Text>{formatTimestamp(entry.timestamp)}</Text></Text>
        {meta.project && <Text dimColor>Project:   <Text color="blue">{meta.project}</Text></Text>}
        {git && (
          <Text dimColor>Git:       <Text color="yellow">Captured on branch: {git.branch}, {git.files?.length || 0} files modified</Text></Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        <Box marginBottom={1}>
          <Text dimColor>Tool:   </Text>
          <Text color={field === 'tool' ? 'cyan' : 'white'} bold={field === 'tool'}>
            {toolValue}{field === 'tool' ? '█' : ''}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Prompt: </Text>
          <Box borderStyle="round" borderColor={field === 'prompt' ? 'cyan' : 'gray'} paddingX={1}>
            <Text color={field === 'prompt' ? 'cyan' : 'white'}>
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

interface FilterPanelProps {
  allEntries: PromptEntry[];
  active: ActiveFilters;
  onUpdate: (filters: ActiveFilters) => void;
  onClose: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({ allEntries, active, onUpdate, onClose }) => {
  const [catIdx, setCatIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);

  const category = FILTER_CATEGORIES[catIdx];
  const isStarred = category === 'starred';
  const isQuality = category === 'quality';
  const isRelevance = category === 'relevance';

  const values = useMemo(
    () => {
      if (isStarred) return [];
      if (isQuality || isRelevance) return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
      return getDistinctValues(allEntries, category);
    },
    [allEntries, category, isStarred, isQuality, isRelevance]
  );
  const allValues = isStarred ? [] : ['(all)', ...values];

  const currentCatValue = useMemo(() => {
    if (isStarred) return active.starred ? 'yes' : undefined;
    if (isQuality) return active.minQuality?.toString();
    if (isRelevance) return active.minRelevance?.toString();
    return (active[category as keyof Omit<ActiveFilters, 'starred' | 'minQuality' | 'minRelevance'>]);
  }, [active, category, isStarred, isQuality, isRelevance]);

  const ITEMS_VISIBLE = 14;
  const pageStart = Math.max(0, Math.min(itemIdx - Math.floor(ITEMS_VISIBLE / 2), allValues.length - ITEMS_VISIBLE));
  const visibleValues = allValues.slice(pageStart, pageStart + ITEMS_VISIBLE);

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }

    if (key.tab) {
      const next = (catIdx + 1) % FILTER_CATEGORIES.length;
      setCatIdx(next);
      setItemIdx(0);
      return;
    }
    if (key.leftArrow) {
      setCatIdx(i => (i - 1 + FILTER_CATEGORIES.length) % FILTER_CATEGORIES.length);
      setItemIdx(0);
    } else if (key.rightArrow) {
      setCatIdx(i => (i + 1) % FILTER_CATEGORIES.length);
      setItemIdx(0);
    } else if (key.upArrow) {
      setItemIdx(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      if (isStarred) {
        onUpdate({ ...active, starred: !active.starred || undefined });
      } else {
        setItemIdx(i => Math.min(allValues.length - 1, i + 1));
      }
    } else if (key.return || char === ' ') {
      if (isStarred) {
        onUpdate({ ...active, starred: !active.starred || undefined });
      } else {
        const selected = allValues[itemIdx];
        if (!selected) return;
        if (selected === '(all)') {
          const updated = { ...active };
          if (isQuality) delete updated.minQuality;
          else if (isRelevance) delete updated.minRelevance;
          else delete (updated as Record<string, unknown>)[category];
          onUpdate(updated);
        } else {
          if (isQuality) onUpdate({ ...active, minQuality: Number(selected) });
          else if (isRelevance) onUpdate({ ...active, minRelevance: Number(selected) });
          else onUpdate({ ...active, [category]: selected });
        }
      }
    }
 else if (char === 'c') {
      onUpdate({});
    }
  });

  const activeCount = Object.values(active).filter(v => v !== undefined && v !== false).length;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>Filter Panel  </Text>
        {activeCount > 0
          ? <Text color="yellow">{activeCount} active filter{activeCount > 1 ? 's' : ''}  </Text>
          : <Text dimColor>no filters active  </Text>
        }
        {activeCount > 0 && <Text dimColor>(c to clear all)</Text>}
      </Box>

      {/* Category tabs */}
      <Box marginBottom={1}>
        {FILTER_CATEGORIES.map((cat, i) => {
          let catVal: string | undefined;
          if (cat === 'starred') catVal = active.starred ? '★' : undefined;
          else if (cat === 'quality') catVal = active.minQuality ? `≥${active.minQuality}` : undefined;
          else if (cat === 'relevance') catVal = active.minRelevance ? `≥${active.minRelevance}` : undefined;
          else catVal = active[cat as keyof Omit<ActiveFilters, 'starred' | 'minQuality' | 'minRelevance'>];
          
          const isActive = i === catIdx;
          return (
            <Box key={cat} marginRight={2}>
              <Text color={isActive ? 'cyan' : catVal ? 'yellow' : 'gray'} bold={isActive}>
                {CATEGORY_LABEL[cat]}{catVal ? `[${catVal}]` : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Values list */}
      <Box borderStyle="single" borderColor="gray" flexDirection="column" padding={1} minHeight={16}>
        {isStarred ? (
          <Box>
            <Text color={active.starred ? 'yellow' : 'gray'} bold={active.starred}>
              {'❯ '}{active.starred ? '★' : '☆'} Only starred prompts{active.starred ? ' ✓' : ''}
            </Text>
          </Box>
        ) : allValues.length === 0 ? (
          <Text dimColor>(no values found)</Text>
        ) : (
          visibleValues.map((val, i) => {
            const absIdx = pageStart + i;
            const isCurrent = val === currentCatValue || (val === '(all)' && !currentCatValue);
            return (
              <Box key={val}>
                <Text
                  color={absIdx === itemIdx ? 'cyan' : isCurrent ? 'yellow' : 'gray'}
                  bold={absIdx === itemIdx}
                >
                  {absIdx === itemIdx ? '❯ ' : '  '}{val}{isCurrent && val !== '(all)' ? ' ✓' : ''}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>←→/Tab switch category · ↑↓ navigate · Enter/Space select · c clear all · ESC close</Text>
      </Box>
    </Box>
  );
};

// ─── ActiveFilterBadges ───────────────────────────────────────────────────────

const FilterBadges: React.FC<{ active: ActiveFilters; textFilter: string }> = ({ active, textFilter }) => (
  <>
    {active.project  && <Text color="blue">  proj:{active.project}</Text>}
    {active.language && <Text color="green">  lang:{active.language}</Text>}
    {active.role     && <Text color={ROLE_COLOR[active.role] ?? 'cyan'}>  role:{active.role}</Text>}
    {active.tool     && <Text color="yellow">  tool:{active.tool}</Text>}
    {active.tag      && <Text color="cyan">  tag:{active.tag}</Text>}
    {active.starred  && <Text color="yellow">  ★only</Text>}
    {active.minQuality !== undefined && <Text color="green">  Q≥{active.minQuality}</Text>}
    {active.minRelevance !== undefined && <Text color="green">  R≥{active.minRelevance}</Text>}
    {textFilter      && <Text color="yellow">  /{textFilter}</Text>}
  </>
);

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

  const [cursor, setCursor]   = useState(0);
  const [detail, setDetail]   = useState<PromptEntry | null>(null);
  const [editing, setEditing] = useState<PromptEntry | null>(null);
  const [rerunning, setRerunning] = useState<PromptEntry | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { columns: termWidth, rows: termHeight } = useStdoutDimensions();
  const PAGE_SIZE = Math.max(1, Math.floor((termHeight - 10) / 2));

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

  const pageStart = Math.max(0, Math.min(cursor - Math.floor(PAGE_SIZE / 2), entries.length - PAGE_SIZE));
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
  }, []);

  const activeFilterCount = Object.values(activeFilters).filter(v => v !== undefined && v !== false).length;

  useInput((char, key) => {
    if (detail || editing || showFilterPanel || rerunning) return;

    if (isTextFiltering) {
      if (key.escape) {
        setTextFiltering(false);
        setTextFilter('');
      } else if (key.return) {
        setTextFiltering(false);
      } else if (key.backspace || key.delete) {
        setTextFilter(v => v.slice(0, -1));
      } else if (char && !key.ctrl) {
        setTextFilter(v => v + char);
      }
      return;
    }

    if (char === 'q' || key.escape)  { exit(); }
    else if (key.upArrow)            { setCursor(c => Math.max(0, c - 1)); }
    else if (key.downArrow)          { setCursor(c => Math.min(entries.length - 1, c + 1)); }
    else if (key.pageUp)             { setCursor(c => Math.max(0, c - PAGE_SIZE)); }
    else if (key.pageDown)           { setCursor(c => Math.min(entries.length - 1, c + PAGE_SIZE)); }
    else if (key.return)             { if (entries[cursor]) setDetail(entries[cursor]); }
    else if (char === 's')           { if (entries[cursor]) toggleStar(entries[cursor]); }
    else if (char === 'e')           { if (entries[cursor]) setEditing(entries[cursor]); }
    else if (char === 'r')           { if (entries[cursor]) setRerunning(entries[cursor]); }
    else if (char === 'y')           {
      if (entries[cursor]) {
        copyToClipboard(entries[cursor].prompt);
        setCopiedId(entries[cursor].id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    }
    else if (char === 'x')           { if (entries[cursor]) handleDelete(entries[cursor]); }
    else if (char === '/')           { setTextFiltering(true); }
    else if (char === 'f')           { setFilterPanel(true); }
    else if (char === 'c')           { setActiveFilters({}); setTextFilter(''); setCursor(0); }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (showFilterPanel) {
    return (
      <FilterPanel
        allEntries={allEntries}
        active={activeFilters}
        onUpdate={handleFilterUpdate}
        onClose={() => setFilterPanel(false)}
      />
    );
  }

  if (rerunning) {
    return (
      <RerunView
        entry={rerunning}
        onConfirm={(tool, prompt) => {
          onRerun?.(tool, prompt);
          setRerunning(null);
          exit();
        }}
        onClose={() => setRerunning(null)}
      />
    );
  }

  if (editing) {
    return (
      <EditView
        entry={editing}
        onSave={meta => handleSaveEdit(editing, meta)}
        onClose={() => setEditing(null)}
      />
    );
  }

  if (detail) {
    return (
      <DetailView
        entry={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { setEditing(detail); setDetail(null); }}
        termWidth={termWidth}
        termHeight={termHeight}
      />
    );
  }

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <Box paddingX={1} borderStyle="single" borderColor="cyan">
        <Text color="cyan" bold>ph — prompt history  </Text>
        <Text dimColor>
          {entries.length}{entries.length < allEntries.length ? `/${allEntries.length}` : ''} prompts
        </Text>
        <FilterBadges active={activeFilters} textFilter={textFilter} />
        {isTextFiltering && <Text color="green">  [typing…]</Text>}
        {copiedId && <Text color="green">  [Copied to clipboard!]</Text>}
      </Box>

      {/* List */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {entries.length === 0 ? (
          <Text dimColor>
            (no results{activeFilterCount > 0 || textFilter ? ' — press c to clear filters' : ''})
          </Text>
        ) : (
          visible.map((entry, i) => (
            <PromptRow
              key={entry.id}
              entry={entry}
              isSelected={pageStart + i === cursor}
              termWidth={termWidth}
            />
          ))
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1} borderStyle="single" borderColor="gray" justifyContent="space-between">
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate">
            {'↑↓ nav · Enter view · s star · e edit · r rerun · y copy · x del · f filter · / find · c clear · q quit'}
          </Text>
        </Box>
        <Box marginLeft={1} flexShrink={0}>
          <Text dimColor>
            {entries.length > 0 ? `${cursor + 1}/${entries.length}` : '0/0'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
