import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface WorkerLockPayload {
  pid?: number;
  startedAt?: number;
}

const DEFAULT_STALE_MS = 120_000;
const RETRY_INTERVAL_MS = 50;

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return errorCode(err) === 'EPERM';
  }
}

function tryRemoveIfStale(lockPath: string, staleMs: number): boolean {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw) as WorkerLockPayload;
    const ageMs = typeof parsed.startedAt === 'number' ? Date.now() - parsed.startedAt : staleMs + 1;
    const deadOwner = typeof parsed.pid === 'number' ? !isPidAlive(parsed.pid) : true;
    if (ageMs > staleMs || deadOwner) {
      fs.unlinkSync(lockPath);
      return true;
    }
    return false;
  } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return true;
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > 5_000) {
        fs.unlinkSync(lockPath);
        return true;
      }
    } catch {
      return true;
    }
    return false;
  }
}

function tryAcquireLock(lockPath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err: unknown) {
    if (errorCode(err) === 'EEXIST') return false;
    throw err;
  }
  try {
    const payload = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
    fs.writeSync(fd, payload);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/** Serialize background worker execution per database and worker name via an exclusive lock file. */
export async function withWorkerLock<T>(
  dbPath: string,
  workerName: string,
  fn: () => Promise<T>,
  maxWaitMs = 30_000,
): Promise<T> {
  const hash = createHash('sha256').update(path.resolve(dbPath)).digest('hex').slice(0, 12);
  const lockPath = path.join(os.tmpdir(), `ph-${workerName}-${hash}.lock`);
  const deadline = Date.now() + maxWaitMs;

  while (!tryAcquireLock(lockPath)) {
    if (tryRemoveIfStale(lockPath, DEFAULT_STALE_MS)) continue;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${workerName} worker lock (${lockPath})`);
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
  }

  try {
    return await fn();
  } finally {
    try {
      const raw = fs.readFileSync(lockPath, 'utf-8');
      const parsed = JSON.parse(raw) as WorkerLockPayload;
      if (parsed.pid === process.pid) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      try { fs.unlinkSync(lockPath); } catch { /* lock already removed */ }
    }
  }
}
