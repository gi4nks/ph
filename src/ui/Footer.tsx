import React from 'react';
import { AppFooter, THEMES } from '@gi4nks/ink';
import type { HintItem } from '@gi4nks/ink';

const HINTS: Array<HintItem | '|'> = [
  { key: '↑↓',  description: 'nav' },
  { key: 'Tab', description: 'pane' },
  { key: '1/2', description: 'tab' },
  { key: 'y',   description: 'copy' },
  { key: 's',   description: '★' },
  { key: 'e',   description: 'edit' },
  { key: 'r',   description: 'rerun' },
  '|',
  { key: 'x',   description: 'del' },
  { key: '/',   description: 'search' },
  { key: 'f',   description: 'filter' },
  { key: 'q',   description: 'quit' },
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
