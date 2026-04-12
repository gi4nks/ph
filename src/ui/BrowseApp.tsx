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

// ─── Types ────────────────────────────────────────────────────────────────────

const FILTER_CATEGORIES = ['project', 'language', 'role', 'tool', 'tag', 'starred', 'quality', 'relevance'] as const;
type FilterCategory = (typeof FILTER_CATEGORIES)[number];

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
  const [activeTab, setActiveTab] = useState<'prompt' | 'response'>(entry.response ? 'response' : 'prompt');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setScrollOffset(0);
  }, [activeTab]);

  const contentWidth = Math.max(10, termWidth - 4);
  const text = activeTab === 'prompt' ? entry.prompt : (entry.response || '(no response captured)');
  const lines = useMemo(() => wrapTextLines(text, contentWidth), [text, contentWidth]);

  // overhead = meta1(1) + meta2(1) + blank(1) + tabbar(1) + scroll-top(1) + scroll-bot(1) = 6
  // But we also have Header(1), SearchBar(1), Footer(1) = 3
  // Plus paddingTop(1) = 1.
  // Total overhead = 10.
  const contentHeight = Math.max(1, termHeight - 10);
  const maxScroll = Math.max(0, lines.length - contentHeight);

  useInput((char, key) => {
    if (key.escape || key.return) onClose();
    else if (char === 'e') onEdit();
    else if (key.tab || char === '1' || char === '2') {
      if (char === '1') setActiveTab('prompt');
      else if (char === '2') setActiveTab('response');
      else setActiveTab(t => t === 'prompt' ? 'response' : 'prompt');
    }
    else if (char === 'y') {
      copyToClipboard(text);
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
          <Text color={theme.primary} bold underline>
            {activeTab === 'prompt' ? '●' : '○'} PROMPT
          </Text>
          <Text>   </Text>
          <Text color={theme.primary} bold underline>
            {activeTab === 'response' ? '●' : '○'} RESPONSE
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

interface FilterPanelProps {
  allEntries: PromptEntry[];
  active: ActiveFilters;
  onUpdate: (filters: ActiveFilters) => void;
  onClose: () => void;
  theme: Theme;
}

const FilterPanel: React.FC<FilterPanelProps> = ({ allEntries, active, onUpdate, onClose, theme }) => {
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
        <Text color={theme.primary} bold>Filter Panel  </Text>
        {activeCount > 0
          ? <Text color={theme.warning}>{activeCount} active filter{activeCount > 1 ? 's' : ''}  </Text>
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
              <Text color={isActive ? theme.primary : catVal ? theme.warning : theme.dim} bold={isActive}>
                {CATEGORY_LABEL[cat]}{catVal ? `[${catVal}]` : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Values list */}
      <Box borderStyle="single" borderColor={theme.dim} flexDirection="column" padding={1} minHeight={16}>
        {isStarred ? (
          <Box>
            <Text color={active.starred ? theme.warning : theme.dim} bold={active.starred}>
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
                  color={absIdx === itemIdx ? theme.primary : isCurrent ? theme.warning : theme.dim}
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
  // n list entries occupy 3n-1 lines (2 per entry + 1 separator, except last).
  // n = floor((termHeight - 4 + 1) / 3) = floor((termHeight - 3) / 3)
  const PAGE_SIZE = Math.max(1, Math.floor((termHeight - 3) / 3));

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
    if (detail || editing || showFilterPanel || rerunning) return;

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
    else if (char === 'c')           { setActiveFilters({}); setTextFilter(''); setCursor(0); setScrollOffset(0); }
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
  if (showFilterPanel) {
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
            visible.map((entry, i) => (
              <React.Fragment key={entry.id}>
                <ListEntry
                  entry={entry}
                  isSelected={pageStart + i === cursor}
                  paneWidth={leftPaneWidth}
                  theme={theme}
                />
                {i < visible.length - 1 && (
                  <Box>
                    <Text color={theme.dim}>{'─'.repeat(leftPaneWidth)}</Text>
                  </Box>
                )}
              </React.Fragment>
            ))
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
          visible.map((entry, i) => (
            <React.Fragment key={entry.id}>
               <ListEntry
                entry={entry}
                isSelected={pageStart + i === cursor}
                paneWidth={termWidth}
                theme={theme}
              />
              {i < visible.length - 1 && (
                <Box>
                  <Text color={theme.dim}>{'─'.repeat(termWidth)}</Text>
                </Box>
              )}
            </React.Fragment>
          ))
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
        theme={currentThemeName}
      />
    </Box>
  );
};
