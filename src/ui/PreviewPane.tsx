import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptEntry, PromptMetadata } from '../types.js';
import type { Theme } from './themes.js';

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

function wrapTextLines(text: string, width: number): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      result.push('');
      continue;
    }
    let current = line;
    while (current.length > width) {
      result.push(current.substring(0, width));
      current = current.substring(width);
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
  } catch {
    return ts.slice(0, 16);
  }
}

function parseMeta(raw: string): PromptMetadata {
  try {
    return JSON.parse(raw) as PromptMetadata;
  } catch {
    return {};
  }
}

interface PreviewPaneProps {
  entry: PromptEntry | null;
  paneWidth: number;
  paneHeight: number;
  isFocused: boolean;
  theme: Theme;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  entry,
  paneWidth,
  paneHeight,
  isFocused,
  theme,
}) => {
  const [activeTab, setActiveTab] = useState<'prompt' | 'response'>('prompt');
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    setActiveTab('prompt');
    setScrollOffset(0);
  }, [entry?.id]);

  useEffect(() => {
    setScrollOffset(0);
  }, [activeTab]);

  const meta = useMemo(() => (entry ? parseMeta(entry.metadata) : {}), [entry]);
  const contentWidth = Math.max(10, paneWidth - 4);
  const contentHeight = Math.max(3, paneHeight - 6);

  const allLines = useMemo(() => {
    if (!entry) return [];
    const text = activeTab === 'prompt' ? entry.prompt : (entry.response || '(no response captured)');
    return wrapTextLines(text, contentWidth);
  }, [entry, activeTab, contentWidth]);

  const maxScroll = Math.max(0, allLines.length - contentHeight);

  useInput((_char, key) => {
    if (!isFocused) return;

    if (_char === '1') {
      setActiveTab('prompt');
      return;
    }
    if (_char === '2') {
      setActiveTab('response');
      return;
    }

    if (key.upArrow) setScrollOffset((s) => Math.max(0, s - 1));
    if (key.downArrow) setScrollOffset((s) => Math.min(maxScroll, s + 1));
    if (key.pageUp) setScrollOffset((s) => Math.max(0, s - contentHeight));
    if (key.pageDown) setScrollOffset((s) => Math.min(maxScroll, s + contentHeight));
  });

  if (!entry) {
    return (
      <Box width={paneWidth} height={paneHeight} paddingX={2} flexDirection="column" justifyContent="center">
        <Text dimColor>(select an entry to preview)</Text>
      </Box>
    );
  }

  const visibleLines = allLines.slice(scrollOffset, scrollOffset + contentHeight);
  const paddedLines = [...visibleLines];
  while (paddedLines.length < contentHeight) paddedLines.push('');

  const topIndicator = scrollOffset > 0 ? `  ↑ ${scrollOffset} above` : '  ';
  const remaining = allLines.length - scrollOffset - contentHeight;
  const botIndicator = scrollOffset < maxScroll ? `  ↓ ${remaining} more` : '  ';

  const isPromptActive = activeTab === 'prompt';
  const isResponseActive = activeTab === 'response';

  const tabPromptColor = isPromptActive && isFocused ? theme.primary : theme.dim;
  const tabResponseColor = isResponseActive && isFocused ? theme.primary : theme.dim;

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* meta1 */}
      <Box>
        <Text color={theme.primary} bold>#{entry.id}</Text>
        <Text dimColor> · {entry.tool} · {formatTimestamp(entry.timestamp)}</Text>
        {meta.starred && <Text color={theme.warning}>  ★</Text>}
      </Box>

      {/* meta2 */}
      <Box marginBottom={1}>
        {meta.project && <Text color={theme.accent}>proj:{meta.project}  </Text>}
        {meta.language && <Text color={theme.dim}>lang:{meta.language}  </Text>}
        {meta.role && (
          <Text color={ROLE_COLOR[meta.role] || theme.primary}>role:{meta.role}  </Text>
        )}
        {meta.quality !== undefined && <Text color={theme.success}>Q:{meta.quality}  </Text>}
        {meta.relevance !== undefined && <Text color={theme.warning}>R:{meta.relevance}  </Text>}
        <Text color={entry.exit_code === 0 ? theme.dim : theme.error}>exit:{entry.exit_code}</Text>
      </Box>

      {/* tab bar */}
      <Box>
        <Text
          color={tabPromptColor}
          bold={isPromptActive && isFocused}
          underline={isPromptActive && isFocused}
        >
          {isPromptActive ? '● ' : '○ '}PROMPT
        </Text>
        <Text>{'   '}</Text>
        <Text
          color={tabResponseColor}
          bold={isResponseActive && isFocused}
          underline={isResponseActive && isFocused}
        >
          {isResponseActive ? '● ' : '○ '}RESPONSE
        </Text>
      </Box>

      {/* scroll-top indicator */}
      <Text dimColor>{topIndicator}</Text>

      {/* content lines */}
      {paddedLines.map((line, i) => (
        <Text key={i}>{line || ' '}</Text>
      ))}

      {/* scroll-bot indicator */}
      <Text dimColor>{botIndicator}</Text>
    </Box>
  );
};
