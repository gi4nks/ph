import React from 'react';
import { Box, Text } from 'ink';
import type { PromptEntry, PromptMetadata } from '../types.js';
import type { Theme } from './themes.js';
import { extractTopic } from '../utils/extractTopic.js';

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

function toolIndicator(tool: string): { char: string; color: string } {
  if (tool === 'claude') return { char: '●', color: '#f5a623' };
  if (tool === 'gemini') return { char: '●', color: '#4fc3f7' };
  return { char: '○', color: 'gray' };
}

function truncate(str: string, width: number): string {
  if (str.length <= width) return str;
  return str.slice(0, width - 1) + '…';
}

interface ListEntryProps {
  entry: PromptEntry;
  isSelected: boolean;
  paneWidth: number;
  theme: Theme;
}

export const ListEntry: React.FC<ListEntryProps> = ({ entry, isSelected, paneWidth, theme }) => {
  let meta: PromptMetadata = {};
  try {
    meta = JSON.parse(entry.metadata || '{}') as PromptMetadata;
  } catch {
    /* ignore */
  }
  const indicator = toolIndicator(entry.tool);

  const date = new Date(entry.timestamp);
  const hhmm = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const role = meta.role ? truncate(meta.role, 6) : '';
  const roleColor = meta.role ? ROLE_COLOR[meta.role] || 'white' : 'white';

  const rawTitle = meta.title || extractTopic(entry.prompt);
  // Truncate to paneWidth - 3 to leave room for ' ❯ ' prefix
  const displayPrompt = truncate(rawTitle, paneWidth - 3);

  return (
    <Box flexDirection="column">
      {/* Row 1 — info contestuali in dimColor per gerarchia visiva */}
      <Box flexDirection="row" width={paneWidth} overflow="hidden">
        <Text color={indicator.color}>{indicator.char} </Text>
        <Text dimColor>{entry.tool.padEnd(7)}</Text>
        {meta.starred ? <Text color={theme.warning}>★ </Text> : <Text>  </Text>}
        <Text dimColor>{hhmm}  </Text>
        {role && (
          <Text color={roleColor} dimColor>
            {role}
          </Text>
        )}
      </Box>

      {/* Row 2 — titolo con inverse video su selezione (barra a piena larghezza) */}
      <Box flexDirection="row">
        {isSelected ? (
          <Text inverse bold>
            {' ❯ '}
            {displayPrompt.padEnd(paneWidth - 3)}
          </Text>
        ) : (
          <Text>
            {'  '}
            {displayPrompt}
          </Text>
        )}
      </Box>
    </Box>
  );
};
