export interface TextSegment {
  text: string;
  color?: string;
  dim?: boolean;
}

export interface RichLine {
  segments: TextSegment[];
}

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'function', 'class', 'struct', 'interface', 'enum', 'type',
  'const', 'let', 'var', 'import', 'export', 'from', 'default', 'async',
  'await', 'yield', 'throw', 'try', 'catch', 'finally', 'new', 'delete',
  'typeof', 'instanceof', 'void', 'null', 'undefined', 'true', 'false',
  'this', 'super', 'extends', 'implements', 'package', 'namespace', 'using',
  'def', 'in', 'not', 'is', 'and', 'or', 'with', 'as', 'pass', 'raise', 'lambda',
  'pub', 'fn', 'let', 'mut', 'impl', 'trait', 'use', 'mod', 'where', 'ref',
  'func', 'go', 'defer', 'select', 'chan', 'range', 'map',
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'TABLE',
  'INTO', 'VALUES', 'SET', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
  'AND', 'OR', 'NOT', 'IN', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'static', 'public', 'private', 'protected', 'readonly', 'abstract', 'virtual',
  'override', 'final', 'sealed', 'internal', 'extern',
  'module', 'requires', 'exports', 'opens', 'provides', 'to', 'transitive',
  'match', 'enum', 'macro', 'unsafe',
]);

function tokenizeLine(line: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let i = 0;

  while (i < line.length) {
    const rest = line.slice(i);

    const strMatch = rest.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
    if (strMatch) {
      segments.push({ text: strMatch[1], color: 'green' });
      i += strMatch[1].length;
      continue;
    }

    const commentMatch = rest.match(/^(\/\/.*)/);
    if (commentMatch) {
      segments.push({ text: commentMatch[1], dim: true });
      i += commentMatch[1].length;
      continue;
    }

    if (rest[0] === '#') {
      segments.push({ text: rest.slice(i), dim: true });
      break;
    }

    const numMatch = rest.match(/^(\d+(?:\.\d+)?)/);
    if (numMatch) {
      segments.push({ text: numMatch[1], color: 'yellow' });
      i += numMatch[1].length;
      continue;
    }

    const wordMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (wordMatch) {
      const word = wordMatch[1];
      if (KEYWORDS.has(word)) {
        segments.push({ text: word, color: 'blue' });
      } else if (/^[A-Z]/.test(word)) {
        segments.push({ text: word, color: 'cyan' });
      } else {
        segments.push({ text: word });
      }
      i += word.length;
      continue;
    }

    segments.push({ text: rest[0] });
    i++;
  }

  return segments;
}

export function wrapTextLines(text: string, width: number): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      result.push('');
      continue;
    }
    let current = line;
    while (current.length > width) {
      result.push(current.slice(0, width));
      current = current.slice(width);
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

function wrapRichLines(lines: RichLine[], width: number): RichLine[] {
  const result: RichLine[] = [];

  for (const line of lines) {
    const totalLen = line.segments.reduce((sum, s) => sum + s.text.length, 0);

    if (totalLen <= width) {
      result.push(line);
      continue;
    }

    let currentSegs: TextSegment[] = [];
    let currentLen = 0;

    for (const seg of line.segments) {
      let remaining = seg.text;
      while (remaining.length > 0) {
        const space = width - currentLen;
        if (remaining.length <= space) {
          currentSegs.push({ text: remaining, color: seg.color, dim: seg.dim });
          currentLen += remaining.length;
          remaining = '';
        } else {
          currentSegs.push({ text: remaining.slice(0, space), color: seg.color, dim: seg.dim });
          result.push({ segments: currentSegs });
          currentSegs = [];
          currentLen = 0;
          remaining = remaining.slice(space);
        }
      }
    }

    if (currentLen > 0) {
      result.push({ segments: currentSegs });
    }
  }

  return result;
}

export function buildRichLines(text: string, width: number): RichLine[] {
  const rawLines = text.split('\n');
  let inCode = false;
  const parsed: RichLine[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      parsed.push({ segments: tokenizeLine(rawLine) });
    } else {
      parsed.push({ segments: [{ text: rawLine }] });
    }
  }

  return wrapRichLines(parsed, width);
}
