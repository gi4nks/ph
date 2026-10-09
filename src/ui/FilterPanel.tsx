import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptEntry } from '../types.js';
import type { ActiveFilters } from './Header.js';
import { buildFilterOptions, ROLE_COLOR, toggleFilter } from './filtering.js';
import type { FilterOption } from './filtering.js';
import type { Theme } from './themes.js';

interface Props {
  allEntries: PromptEntry[];
  active: ActiveFilters;
  onUpdate: (filters: ActiveFilters) => void;
  onClose: () => void;
  theme: Theme;
}

export const FilterPanel: React.FC<Props> = ({ allEntries, active, onUpdate, onClose, theme }) => {
  const options = useMemo<FilterOption[]>(() => buildFilterOptions(allEntries, active), [allEntries, active]);
  const [cursor, setCursor] = useState(0);
  const visibleCount = Math.min(options.length, 16);
  const scrollOffset = Math.max(0, Math.min(cursor - Math.floor(visibleCount / 2), options.length - visibleCount));
  const visible = options.slice(Math.max(0, scrollOffset), scrollOffset + visibleCount);

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (char === 'c') { onUpdate({}); return; }
    if (key.return || char === ' ') {
      const option = options[cursor];
      if (!option) return;
      onUpdate(toggleFilter(active, option));
      return;
    }
    if (key.upArrow) setCursor(value => Math.max(0, value - 1));
    if (key.downArrow) setCursor(value => Math.min(options.length - 1, value + 1));
    if (key.pageUp) setCursor(value => Math.max(0, value - visibleCount));
    if (key.pageDown) setCursor(value => Math.min(options.length - 1, value + visibleCount));
    if (char && /^[a-z]$/.test(char)) {
      const index = options.findIndex((option, i) => i > cursor && option.category[0] === char);
      if (index !== -1) setCursor(index);
    }
  });

  const activeCount = Object.values(active).filter(value => value !== undefined && value !== false).length;
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>Filters  </Text>
        {activeCount > 0 ? <Text color={theme.warning}>{activeCount} active  </Text> : <Text dimColor>none active  </Text>}
        {activeCount > 0 && <Text dimColor>(c clear)</Text>}
      </Box>
      <Box borderStyle="single" borderColor={theme.dim} flexDirection="column" padding={1} minHeight={18}>
        <Box flexDirection="column">
          {visible.map((option, index) => {
            const absoluteIndex = Math.max(0, scrollOffset) + index;
            const isCurrent = absoluteIndex === cursor;
            const categoryColor = option.category === 'project' ? 'blue'
              : option.category === 'language' ? 'green'
                : option.category === 'role' ? ROLE_COLOR[option.label] || 'cyan'
                  : option.category === 'tool' ? 'yellow' : option.category === 'tag' ? 'cyan' : 'white';
            return (
              <Box key={`${option.category}-${option.label}`}>
                <Text bold={isCurrent} color={isCurrent ? theme.primary : theme.dim}>{isCurrent ? '❯ ' : '  '}</Text>
                <Text color={option.active ? theme.warning : categoryColor} bold={option.active || isCurrent}>
                  {option.category}:{option.label}
                </Text>
                <Text dimColor> [{option.count}]</Text>
                {option.active && <Text color={theme.success}> ✓</Text>}
              </Box>
            );
          })}
        </Box>
        {options.length > visibleCount && <Box marginTop={1}><Text dimColor>  {cursor + 1}/{options.length} · ↑↓ navigate · Enter toggle · c clear · ESC close</Text></Box>}
      </Box>
      <Box marginTop={1}><Text dimColor>↑↓ navigate · Enter toggle · c clear all · ESC close · letter jumps to category</Text></Box>
    </Box>
  );
};
