import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertGameDeleteBoundary } from './game-delete-safety.js';

let root: string, device: bigint;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-delete-boundary-'));
  device = (await fs.lstat(root, { bigint: true })).dev;
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const linuxRoot = '1 0 8:1 / / rw shared:1 - ext4 /dev/root rw\n';
const macRoot = '/dev/root on / (apfs, sealed, local, read-only)\n';

it.each([
  ['linux', ''], ['linux', '\n'], ['linux', 'garbage'],
  ['linux', linuxRoot + 'invalid record\n'],
  ['linux', '1 0 8:1 / /not-root rw - ext4 /dev/root rw\n'],
  ['linux', linuxRoot + '2 1 8:1 / /bad\\777 rw - ext4 /dev/root rw\n'],
  ['linux', linuxRoot + '2 1 8:1 / /bad/../path rw - ext4 /dev/root rw\n'],
  ['darwin', ''], ['darwin', macRoot + '\n'], ['darwin', macRoot + 'garbage\n'],
  ['darwin', '/dev/disk on /Volumes/Data (apfs, local)\n'],
  ['darwin', macRoot + '/source on /ambiguous on /target (apfs, local)\n'],
  ['darwin', macRoot + '/source on relative (apfs, local)\n'],
] as const)('fails closed on malformed or incomplete %s inventory: %j', async (platform, value) => {
  const stat = vi.fn();
  await expect(assertGameDeleteBoundary(root, device, { platform, mountInfo: async () => value, stat })).rejects.toThrow('Could not verify');
  expect(stat).not.toHaveBeenCalled();
});

it.each(['space here', 'tab\there', 'line\nhere', 'back\\slash'] as const)('decodes Linux mount path escapes in %j', async name => {
  const nested = path.join(root, name);
  const encoded = nested.replace(/[ \t\n\\]/g, value => ({ ' ': '\\040', '\\': '\\134', '\t': '\\011', '\n': '\\012' })[value]!);
  const mountInfo = async () => linuxRoot + `2 1 8:1 /subtree ${encoded} rw master:1 - ext4 /dev/root rw\n`;
  await expect(assertGameDeleteBoundary(root, device, { platform: 'linux', mountInfo })).rejects.toThrow('mounted filesystem');
});

it('accepts macOS native records with spaces, punctuation and non-device sources', async () => {
  const mountInfo = async () => macRoot
    + 'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)\n'
    + 'devices -- file:///synthetic/ on /Volumes/Device data (devicefs, local, fskit, mounted by fixture)\n'
    + '/dev/fixture on /Volumes/External (data) (apfs, local, journaled)\n';
  await expect(assertGameDeleteBoundary(root, device, { platform: 'darwin', mountInfo })).resolves.toBeUndefined();
});

it.each(['line\nbreak', 'tab\tname', 'back\\slash'] as const)('rejects a macOS layout whose %j name cannot be inventoried unambiguously', async name => {
  await fs.mkdir(path.join(root, name));
  await expect(assertGameDeleteBoundary(root, device, { platform: 'darwin', mountInfo: async () => macRoot })).rejects.toThrow('Could not verify');
});

it('does not follow symbolic links or inspect their mounted targets', async () => {
  await fs.symlink('/unrelated/possibly-mounted', path.join(root, 'link'));
  const stat = vi.fn((file: string) => fs.lstat(file, { bigint: true }));
  await expect(assertGameDeleteBoundary(root, device, { platform: 'linux', mountInfo: async () => linuxRoot, stat })).resolves.toBeUndefined();
  expect(stat.mock.calls.map(([file]) => file)).toEqual([root, path.join(root, 'link')]);
});
