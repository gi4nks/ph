import type { PromptEntry } from '../types.js';
import { cosineSimilarity } from '../db/index.js';

export interface WorkSession {
  index: number;
  entries: PromptEntry[];
  startTime: Date;
  endTime: Date;
  cohesion: number | null; // null if embeddings not available
}

/**
 * Group entries (sorted oldest-first) into work sessions.
 * A new session starts when the gap between consecutive entries exceeds gapHours.
 */
export function groupIntoSessions(
  entries: PromptEntry[],
  gapHours: number,
): WorkSession[] {
  if (entries.length === 0) return [];

  const sessions: WorkSession[] = [];
  const gapMs = gapHours * 60 * 60 * 1000;

  let current: PromptEntry[] = [entries[0]];
  let lastTime = new Date(entries[0].timestamp).getTime();

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    const entryTime = new Date(entry.timestamp).getTime();
    const gap = entryTime - lastTime;

    if (gap > gapMs) {
      // Flush current session
      sessions.push(makeSession(sessions.length + 1, current));
      current = [entry];
    } else {
      current.push(entry);
    }
    lastTime = entryTime;
  }

  // Flush last session
  if (current.length > 0) {
    sessions.push(makeSession(sessions.length + 1, current));
  }

  return sessions;
}

function makeSession(index: number, entries: PromptEntry[]): WorkSession {
  return {
    index,
    entries,
    startTime: new Date(entries[0].timestamp),
    endTime: new Date(entries[entries.length - 1].timestamp),
    cohesion: null,
  };
}

/**
 * Compute the average cosine similarity between all pairs of entries in the
 * session that have embeddings. Returns null if fewer than 2 entries have embeddings.
 */
export function computeSessionCohesion(
  session: WorkSession,
  embeddings: Map<number, Float32Array>,
): number | null {
  const vecs: Float32Array[] = [];
  for (const entry of session.entries) {
    const vec = embeddings.get(entry.id);
    if (vec) vecs.push(vec);
  }

  if (vecs.length < 2) return null;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      sum += cosineSimilarity(vecs[i], vecs[j]);
      count++;
    }
  }

  return count > 0 ? sum / count : null;
}
