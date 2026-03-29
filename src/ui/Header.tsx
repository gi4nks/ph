import React from 'react';
import { Text } from 'ink';
import { AppHeader, THEMES } from '@gi4nks/ink';
import packageJson from '../../package.json' with { type: 'json' };

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

export interface ActiveFilters {
  project?: string;
  language?: string;
  role?: string;
  tool?: string;
  tag?: string;
  starred?: boolean;
  minQuality?: number;
  minRelevance?: number;
}

interface HeaderProps {
  entriesCount: number;
  allEntriesCount: number;
  activeFilters: ActiveFilters;
  textFilter: string;
  isTextFiltering: boolean;
  theme?: string;
}

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

export const Header: React.FC<HeaderProps> = ({
  entriesCount,
  allEntriesCount,
  activeFilters,
  textFilter,
  isTextFiltering,
  theme: themeName = 'dark',
}) => {
  const theme = THEMES[themeName] || THEMES.dark;
  const version = packageJson.version;
  const rawCwd = process.cwd();
  const cwd = rawCwd.replace(process.env.HOME || '', '~');

  const leftExtra = (
    <Text color="white" dimColor>
      {'  '}{entriesCount}{entriesCount < allEntriesCount ? `/${allEntriesCount}` : ''} prompts
    </Text>
  );

  const rightContent = (
    <>
      <FilterBadges active={activeFilters} textFilter={textFilter} />
      {isTextFiltering && <Text color={theme.success}>  [typing…]</Text>}
    </>
  );

  return (
    <AppHeader
      appName="ph"
      version={version}
      theme={theme}
      cwd={cwd}
      leftExtra={leftExtra}
      rightContent={rightContent}
    />
  );
};
