import React, { useMemo } from 'react';
import { AppFooter, THEMES } from '@gi4nks/ink';
import type { HintItem } from '@gi4nks/ink';

interface FooterProps {
  cursor: number;
  total: number;
  copiedId?: number | null;
  hasProject?: boolean;
  isWide?: boolean;
  hasDetail?: boolean;
  theme?: string;
}

export const Footer: React.FC<FooterProps> = ({
  cursor,
  total,
  copiedId,
  hasProject,
  isWide,
  hasDetail,
  theme: themeName = 'dark',
}) => {
  const theme = THEMES[themeName] || THEMES.dark;
  const position = total > 0 ? `${cursor + 1}/${total}` : '0/0';

  const hints = useMemo<Array<HintItem | '|'>>(() => {
    const base: Array<HintItem | '|'> = [
      { key: '↑↓', description: 'nav' },
    ];
    if (isWide) base.push({ key: 'Tab', description: 'pane' });
    if (hasDetail) base.push({ key: '1/2/3', description: 'tab' });
    base.push(
      { key: 'y', description: 'copy' },
      { key: 's', description: '★' },
      { key: 'e', description: 'edit' },
    );
    if (hasProject) base.push({ key: 'C', description: 'chat' });
    base.push({ key: 'r', description: 'rerun' });
    base.push('|');
    base.push(
      { key: 'x', description: 'del' },
      { key: '/', description: 'search' },
      { key: 'f', description: 'filter' },
      { key: 'o', description: 'settings' },
      { key: 'q', description: 'quit' },
    );
    return base;
  }, [isWide, hasDetail, hasProject]);

  return (
    <AppFooter
      theme={theme}
      hints={hints}
      position={position}
      toast={copiedId ? 'Copied to clipboard' : undefined}
    />
  );
};
