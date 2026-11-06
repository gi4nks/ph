import { spawn } from 'child_process';
import { PhDB } from '../db/index.js';
import { patchPromptMetadata } from '../interaction/lifecycle.js';
import { decodePromptMetadata } from '../interaction/detail.js';

function setFailure(dbPath: string, id: number): void {
  try {
    const db = new PhDB(dbPath);
    try {
      const entry = db.getById(id);
      if (entry && decodePromptMetadata(entry.metadata).automatic_memory_status === 'pending') {
        patchPromptMetadata(db, id, { automatic_memory_status: 'failed', automatic_memory_error: 'worker_launch_failed' });
      }
    } finally { db.close(); }
  } catch { /* status stays visible as pending */ }
}

export function spawnAutomaticMemoryExtraction(id: number, dbPath: string): void {
  const scriptPath = process.argv[1];
  if (!scriptPath) return setFailure(dbPath, id);
  const child = spawn(process.execPath, [scriptPath, '_bg-memory', String(id), '--db', dbPath], { detached: true, stdio: 'ignore' });
  child.on('error', () => setFailure(dbPath, id));
  child.on('exit', code => { if (code !== 0) setFailure(dbPath, id); });
  child.unref();
}
