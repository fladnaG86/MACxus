import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Game } from '../shared/types.js';
import { validateGameDeleteTarget } from './game-removal.js';
import { deleteGameDirectory } from './game-delete.js';

let root: string, game: Game;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-delete-test-'));
  const directory = path.join(root, 'Game with spaces; literal');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game/>');
  await fs.writeFile(path.join(directory, 'data.bin'), 'fixture');
  game = { id: 'fixture', title: 'Fixture', path: directory, installState: 'ready', addedAt: '' };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('permanently deletes only the validated game folder, preserving outside saves and linked targets', async () => {
  const saves = path.join(root, 'outside-saves'); await fs.mkdir(saves);
  await fs.writeFile(path.join(saves, 'save.txt'), 'keep');
  await fs.symlink(saves, path.join(game.path, 'linked-saves'));
  await fs.mkdir(path.join(game.path, 'nested')); await fs.writeFile(path.join(game.path, 'nested', 'save.txt'), 'inside');
  await deleteGameDirectory(await validateGameDeleteTarget(game, [], [os.homedir()]));
  await expect(fs.access(game.path)).rejects.toThrow();
  expect(await fs.readFile(path.join(saves, 'save.txt'), 'utf8')).toBe('keep');
});

it.each(['directory', 'symlink', 'file', 'missing'] as const)('rejects a %s replacement after confirmation/validation', async kind => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const old = path.join(root, 'original'); await fs.rename(game.path, old);
  if (kind === 'directory') await fs.mkdir(game.path);
  if (kind === 'symlink') await fs.symlink(old, game.path);
  if (kind === 'file') await fs.writeFile(game.path, 'replacement');
  await expect(deleteGameDirectory(target, remove)).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(old, 'data.bin'), 'utf8')).toBe('fixture');
});

it('rejects an ancestor replaced by a symbolic link even if the folder identity remains the same', async () => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const parent = path.join(root, 'parent'); await fs.mkdir(parent);
  const moved = path.join(parent, path.basename(game.path)); await fs.rename(game.path, moved);
  const altered = { ...target, path: moved };
  const renamed = path.join(root, 'renamed'); await fs.rename(parent, renamed); await fs.symlink(renamed, parent);
  await expect(deleteGameDirectory(altered, remove)).rejects.toThrow('folder changed');
  expect(remove).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(renamed, path.basename(game.path), 'data.bin'), 'utf8')).toBe('fixture');
});

it('reports partial failure honestly without retrying or pretending the files were kept', async () => {
  const target = await validateGameDeleteTarget(game, [], []);
  const remove = vi.fn(async (directory: string) => { await fs.unlink(path.join(directory, 'data.bin')); throw Error('Permission denied'); });
  await expect(deleteGameDirectory(target, remove)).rejects.toThrow('some files may already have been deleted');
  expect(remove).toHaveBeenCalledOnce();
  expect(await fs.readFile(path.join(game.path, 'MicrosoftGame.config'), 'utf8')).toBe('<Game/>');
});

it('rejects overlapping parent games and aliases, not just literal nested paths', async () => {
  const parent = { ...game, id: 'parent', path: root };
  await expect(validateGameDeleteTarget(game, [parent], [])).rejects.toThrow('another library game');
  const alias = path.join(root, 'alias'); await fs.symlink(game.path, alias);
  await expect(validateGameDeleteTarget(game, [{ ...game, id: 'alias', path: alias }], [])).rejects.toThrow('another library game');
  await expect(validateGameDeleteTarget(game, [], [alias])).rejects.toThrow('protected');
});

it.each(['symlink', 'directory'] as const)('rejects a %s masquerading as the game manifest', async kind => {
  const manifest = path.join(game.path, 'MicrosoftGame.config'); await fs.unlink(manifest);
  if (kind === 'directory') await fs.mkdir(manifest);
  else { const outside = path.join(root, 'outside.xml'); await fs.writeFile(outside, '<Game/>'); await fs.symlink(outside, manifest); }
  await expect(validateGameDeleteTarget(game, [], [])).rejects.toThrow('manifest');
});

const linuxMount = (mount: string) => `42 1 8:1 / ${mount.replace(/[ \t\n\\]/g, value => ({ ' ': '\\040', '\\': '\\134', '\t': '\\011', '\n': '\\012' })[value]!)} rw - ext4 /dev/fixture rw`;
const inventory = (platform: 'linux' | 'darwin', mounts: string[] = []) => platform === 'linux'
  ? [linuxMount('/'), ...mounts.map(linuxMount)].join('\n') + '\n'
  : ['root on / (apfs, local)', ...mounts.map(mount => `/dev/fixture on ${mount} (apfs, local, journaled)`)].join('\n') + '\n';

async function expectPayloadsKept(nested?: string) {
  expect(await fs.readFile(path.join(game.path, 'data.bin'), 'utf8')).toBe('fixture');
  expect(await fs.readFile(path.join(game.path, 'MicrosoftGame.config'), 'utf8')).toBe('<Game/>');
  if (nested) expect(await fs.readFile(path.join(nested, 'sentinel'), 'utf8')).toBe('keep mounted payload');
}

it.each(['linux', 'darwin'] as const)('rejects a nested %s mount, including same-device layouts, before deleting any payload', async platform => {
  const nested = path.join(game.path, 'mounted saves'); await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'sentinel'), 'keep mounted payload');
  const target = await validateGameDeleteTarget(game, [], []);
  expect((await fs.lstat(nested, { bigint: true })).dev).toBe(target.device);
  // This callback would destroy the sentinels if the guard accidentally allowed it.
  const remove = vi.fn(async (directory: string) => fs.rm(directory, { recursive: true }));
  await expect(deleteGameDirectory(target, remove, { platform, mountInfo: async () => inventory(platform, [nested]) })).rejects.toThrow('mounted filesystem');
  expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept(nested);
});

it.each(['linux', 'darwin'] as const)('rejects a %s mount at the game root before deleting its contents', async platform => {
  const remove = vi.fn();
  await expect(deleteGameDirectory(await validateGameDeleteTarget(game, [], []), remove,
    { platform, mountInfo: async () => inventory(platform, [game.path]) })).rejects.toThrow('mounted filesystem');
  expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept();
});

it.each(['linux', 'darwin'] as const)('allows ordinary %s deletion beside a sibling mount without following links', async platform => {
  const saves = path.join(root, 'outside'); await fs.mkdir(saves); await fs.writeFile(path.join(saves, 'sentinel'), 'keep');
  await fs.symlink(saves, path.join(game.path, 'linked-saves'));
  await deleteGameDirectory(await validateGameDeleteTarget(game, [], []), undefined,
    { platform, mountInfo: async () => inventory(platform, [`${game.path}-other`, saves]) });
  await expect(fs.access(game.path)).rejects.toThrow();
  expect(await fs.readFile(path.join(saves, 'sentinel'), 'utf8')).toBe('keep');
});

it.each(['linux', 'darwin'] as const)('rejects a different-device child on %s even if absent from the inventory', async platform => {
  const nested = path.join(game.path, 'nested'); await fs.mkdir(nested); await fs.writeFile(path.join(nested, 'sentinel'), 'keep mounted payload');
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const stat = vi.fn(async (file: string) => {
    const entry = await fs.lstat(file, { bigint: true });
    return { dev: file === nested ? target.device + 1n : entry.dev,
      isDirectory: () => entry.isDirectory(), isSymbolicLink: () => entry.isSymbolicLink() };
  });
  await expect(deleteGameDirectory(target, remove, { platform, mountInfo: async () => inventory(platform), stat })).rejects.toThrow('mounted filesystem');
  expect(stat).not.toHaveBeenCalledWith(path.join(nested, 'sentinel'));
  expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept(nested);
});

it.each(['linux', 'darwin'] as const)('rechecks %s mount inventory after the walk before deleting any payload', async platform => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const mountInfo = vi.fn().mockResolvedValueOnce(inventory(platform)).mockResolvedValueOnce(inventory(platform, [game.path]));
  await expect(deleteGameDirectory(target, remove, { platform, mountInfo })).rejects.toThrow('mounted filesystem');
  expect(mountInfo).toHaveBeenCalledTimes(2); expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept();
});

it.each(['linux', 'darwin'] as const)('fails closed on unavailable %s mount inventory', async platform => {
  const remove = vi.fn();
  await expect(deleteGameDirectory(await validateGameDeleteTarget(game, [], []), remove,
    { platform, mountInfo: async () => { throw Error('Synthetic unavailable inventory'); } })).rejects.toThrow('Nothing was deleted');
  expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept();
});

it.each(['win32', 'freebsd'] as const)('declines permanent deletion on %s without consulting a Linux inventory', async platform => {
  const remove = vi.fn(), mountInfo = vi.fn(async () => inventory('linux'));
  await expect(deleteGameDirectory(await validateGameDeleteTarget(game, [], []), remove, { platform, mountInfo })).rejects.toThrow('Could not verify');
  expect(remove).not.toHaveBeenCalled(); expect(mountInfo).not.toHaveBeenCalled(); await expectPayloadsKept();
});

it('rechecks the root identity after boundary inspection', async () => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn(), original = path.join(root, 'original');
  let checks = 0;
  const mountInfo = async () => {
    if (++checks === 2) {
      await fs.rename(game.path, original); await fs.mkdir(game.path);
      await fs.writeFile(path.join(game.path, 'replacement'), 'keep');
    }
    return inventory('linux');
  };
  await expect(deleteGameDirectory(target, remove, { platform: 'linux', mountInfo })).rejects.toThrow('folder changed');
  expect(remove).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(original, 'data.bin'), 'utf8')).toBe('fixture');
  expect(await fs.readFile(path.join(game.path, 'replacement'), 'utf8')).toBe('keep');
});

it.each(['linux', 'darwin'] as const)('keeps every sentinel if the %s inventory is malformed or becomes unreadable', async platform => {
  const target = await validateGameDeleteTarget(game, [], []);
  for (const mountInfo of [
    async () => inventory(platform) + 'unparseable record\n',
    vi.fn().mockResolvedValueOnce(inventory(platform)).mockRejectedValueOnce(Error('Synthetic read failure')),
  ]) {
    const remove = vi.fn();
    await expect(deleteGameDirectory(target, remove, { platform, mountInfo })).rejects.toThrow('Nothing was deleted');
    expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept();
  }
});

it('keeps every sentinel if a child cannot be inspected', async () => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const stat = async (file: string) => {
    if (file.endsWith('data.bin')) throw Error('Synthetic stat failure');
    return fs.lstat(file, { bigint: true });
  };
  await expect(deleteGameDirectory(target, remove, { platform: 'linux', mountInfo: async () => inventory('linux'), stat })).rejects.toThrow('Synthetic stat failure');
  expect(remove).not.toHaveBeenCalled(); await expectPayloadsKept();
});
