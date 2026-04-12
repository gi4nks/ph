import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from './themes.js';

interface SearchBarProps {
  value: string;
  isActive: boolean;
  theme: Theme;
}

export const SearchBar: React.FC<SearchBarProps> = ({ value, isActive, theme }) => {
  if (isActive) {
    return (
      <Box paddingX={1}>
        <Text color={theme.primary}>⌕  {value}█</Text>
      </Box>
    );
  }

  const content = value === '' ? 'type / to search…' : value;

  return (
    <Box paddingX={1}>
      <Text dimColor>⌕  {content}</Text>
    </Box>
  );
};
