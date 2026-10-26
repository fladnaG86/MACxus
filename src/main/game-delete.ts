import { promises as fs } from 'node:fs';
import { assertGameDeleteBoundary, type GameDeleteSafety } from './game-delete-safety.js';
import type { GameDeleteTarget } from './game-removal.js';

/** Called only after explicit permanent-delete confirmation and validation,
 * while the caller holds the removal lock. Never follows a replaced root. */
export async function deleteGameDirectory(target: GameDeleteTarget,
  remove: (directory: string) => Promise<void> = directory => fs.rm(directory, { recursive: true, force: false, maxRetries: 0 }),
  safety: GameDeleteSafety = {}): Promise<void> {
  await assertTargetUnchanged(target);
  await assertGameDeleteBoundary(target.path, target.device, safety);
  await assertTargetUnchanged(target);
  try { await remove(target.path); }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'Filesystem operation failed.';
    throw Error(`Could not completely delete the game folder. The library entry was kept, but some files may already have been deleted. ${reason}`);
  }
}

async function assertTargetUnchanged(target: GameDeleteTarget): Promise<void> {
  const current = await fs.lstat(target.path, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== target.device || current.ino !== target.inode || await fs.realpath(target.path) !== target.path) {
    throw Error('The game folder changed before deletion. Nothing was deleted. Try removing the game again.');
  }
}
