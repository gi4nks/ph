import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { getProjectContext } from '../index.js';

describe('project context retrieval golden set', () => {
  let dir: string;
  let db: PhDB;

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ranks judged project evidence and reports Recall@2 and MRR', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-context-eval-'));
    db = new PhDB(path.join(dir, 'eval.db'));
    const add = (project: string, prompt: string, vector: Float32Array) => {
      const id = db.insert({
        timestamp: new Date().toISOString(), tool: 'claude', prompt, response: '', args: '',
        workdir: `/work/${project}`, hostname: 'eval', exit_code: 0,
        metadata: JSON.stringify({ project }),
      });
      db.saveEmbedding(id, vector);
      return id;
    };
    const targetNearest = new Float32Array(768); targetNearest[0] = 0.8; targetNearest[1] = 0.2;
    const targetSecond = new Float32Array(768); targetSecond[0] = 0.3; targetSecond[1] = 0.7;
    const unrelatedNearest = new Float32Array(768); unrelatedNearest[0] = 1;
    const expectedIds = new Set([
      add('ph', 'How project summaries store technical decisions', targetNearest),
      add('ph', 'How sqlite vec retrieval ranks project memories', targetSecond),
    ]);
    add('other', 'Unrelated vector closest to the query', unrelatedNearest);

    const result = await getProjectContext(db, { project: 'ph', query: 'project memory retrieval', limit: 2 }, async () => {
      const query = new Float32Array(768); query[0] = 1;
      return query;
    });
    const rankedRelevant = result.prompts.map((prompt, index) => ({ prompt, rank: index + 1 }))
      .filter(item => expectedIds.has(item.prompt.id));
    const recallAt2 = rankedRelevant.length / expectedIds.size;
    const reciprocalRank = rankedRelevant.length ? 1 / rankedRelevant[0].rank : 0;

    expect({ recallAt2, reciprocalRank }).toEqual({ recallAt2: 1, reciprocalRank: 1 });
  });
});
