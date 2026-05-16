import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from './themes.js';

interface SearchBarProps {
  value: string;
  isActive: boolean;
  theme: Theme;
}

export const SearchBar: React.FC<SearchBarProps> = ({ value, isActive, theme }) => {
  const isEmpty = value === '';

  const bgColor = isActive ? theme.primary : theme.dim;

  return (
    <Box paddingX={1} paddingY={0}>
      <Text color={bgColor} bold={isActive}>
        {isActive ? '⌕' : '⌕'}
      </Text>
      <Text color={isActive ? 'white' : theme.dim}>
        {' '}{isEmpty ? (isActive ? '' : 'search (/)') : value}{isActive ? '█' : ''}
      </Text>
    </Box>
  );
};
