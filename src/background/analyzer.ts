import { spawn } from 'child_process';
import { PhDB } from '../db/index.js';
import { patchPromptMetadata } from '../interaction/lifecycle.js';
import { decodePromptMetadata } from '../interaction/detail.js';

function setLaunchFailure(dbPath: string, id: number): void {
  try {
    const db = new PhDB(dbPath);
    try {
      const entry = db.getById(id);
      if (entry && (!decodePromptMetadata(entry.metadata).analysis_status || decodePromptMetadata(entry.metadata).analysis_status === 'pending')) {
        patchPromptMetadata(db, id, { analysis_status: 'failed', analysis_error: 'worker_launch_failed' });
      }
    } finally {
      db.close();
    }
  } catch {
    // The record remains pending and ph status will show that it did not finish.
  }
}

/**
 * Spawns a background analysis process for a prompt ID.
 * This should be called after a prompt is inserted into the DB.
 */
export function spawnBackgroundAnalysis(id: number, dbPath: string): void {
  try {
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      setLaunchFailure(dbPath, id);
      return;
    }

    // Use the same node binary as the parent
    const nodePath = process.execPath;

    // Command: node <scriptPath> _bg-analyze <id> --db <dbPath>
    const child = spawn(nodePath, [scriptPath, '_bg-analyze', String(id), '--db', dbPath], {
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', () => setLaunchFailure(dbPath, id));
    child.on('exit', code => {
      if (code !== 0) setLaunchFailure(dbPath, id);
    });

    // Let the parent process exit without waiting for the child
    child.unref();
  } catch (_err: unknown) {
    setLaunchFailure(dbPath, id);
  }
}
