import { spawn } from 'child_process';

/**
 * Spawns a background analysis process for a prompt ID.
 * This should be called after a prompt is inserted into the DB.
 */
export function spawnBackgroundAnalysis(id: number, dbPath: string): void {
  try {
    const scriptPath = process.argv[1];
    if (!scriptPath) return;

    // Use the same node binary as the parent
    const nodePath = process.execPath;

    // Command: node <scriptPath> _bg-analyze <id> --db <dbPath>
    const child = spawn(nodePath, [scriptPath, '_bg-analyze', String(id), '--db', dbPath], {
      detached: true,
      stdio: 'ignore',
    });

    // Let the parent process exit without waiting for the child
    child.unref();
  } catch (_err: unknown) {
    // Silently ignore spawn errors
  }
}
