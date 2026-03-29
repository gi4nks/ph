import React from 'react';
import { Text } from 'ink';
import { AppFooter, THEMES } from '@gi4nks/ink';
import type { HintItem } from '@gi4nks/ink';

const HINTS: Array<HintItem | '|'> = [
  { key: '↑↓', description: 'nav' },
  { key: '↵', description: 'view' },
  { key: 's', description: 'star' },
  { key: 'e', description: 'edit' },
  { key: 'r', description: 'rerun' },
  '|',
  { key: 'y', description: 'copy' },
  { key: 'x', description: 'del' },
  { key: 'f', description: 'filter' },
  { key: '/', description: 'find' },
  { key: 'c', description: 'clear' },
  { key: 'q', description: 'quit' },
];

interface FooterProps {
  cursor: number;
  total: number;
  copiedId?: number | null;
  theme?: string;
}

export const Footer: React.FC<FooterProps> = ({
  cursor,
  total,
  copiedId,
  theme: themeName = 'dark',
}) => {
  const theme = THEMES[themeName] || THEMES.dark;
  const position = total > 0 ? `${cursor + 1}/${total}` : '0/0';

  return (
    <AppFooter
      theme={theme}
      hints={HINTS}
      position={position}
      toast={copiedId ? 'Copied to clipboard' : undefined}
    />
  );
};
