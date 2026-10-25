import { expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePackageFile } from './windows-path.js';
import { inspectGameDirectory } from './store.js';

it('imports mixed-case Windows manifest paths without renaming files or changing the manifest entry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-case-'));
  try {
    await fs.mkdir(path.join(root, 'bin/gaming.desktop.x64'), { recursive: true });
    const manifest = 'bin\\Gaming.Desktop.x64\\witcher3.exe';
    await fs.writeFile(path.join(root, 'MicrosoftGame.Config'), `<Game><ExecutableList><Executable Name="${manifest}" /></ExecutableList></Game>`);
    await fs.writeFile(path.join(root, '.xodus-streaming.msixvc'), 'inspection fixture');
    await fs.writeFile(path.join(root, 'bin/gaming.desktop.x64/WITCHER3.EXE'), 'encrypted fixture');
    expect(await resolvePackageFile(root, manifest)).toBe('bin/gaming.desktop.x64/WITCHER3.EXE');
    const game = await inspectGameDirectory(root);
    expect(game.installState).toBe('ready'); expect(game.executable).toBe(manifest);
    expect(await fs.readdir(path.join(root, 'bin'))).toEqual(['gaming.desktop.x64']);
    expect(await fs.readFile(path.join(root, 'bin/gaming.desktop.x64/WITCHER3.EXE'), 'utf8')).toBe('encrypted fixture');
    await fs.unlink(path.join(root, '.xodus-streaming.msixvc'));
    expect((await inspectGameDirectory(root)).installState).toBe('imported');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('prefers an exact name and refuses ambiguous fallbacks, traversal, directories and escaping symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-case-safe-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-case-outside-'));
  try {
    await fs.writeFile(path.join(root, 'Game.exe'), 'A');
    await fs.writeFile(path.join(root, 'GAME.EXE'), 'B');
    expect(await resolvePackageFile(root, 'Game.exe')).toBe('Game.exe');
    // Model the ambiguous Windows directory listing even on a case-insensitive
    // APFS host; all traversal and symlink assertions below still use real files.
    const listing = vi.spyOn(fs, 'readdir').mockResolvedValueOnce(['Game.exe', 'GAME.EXE'] as never);
    try { expect(await resolvePackageFile(root, 'game.exe')).toBeUndefined(); }
    finally { listing.mockRestore(); }
    for (const invalid of ['../Game.exe', 'C:\\Game.exe', '.', 'missing.exe']) expect(await resolvePackageFile(root, invalid)).toBeUndefined();
    await fs.mkdir(path.join(root, 'directory.exe'));
    expect(await resolvePackageFile(root, 'directory.exe')).toBeUndefined();
    await fs.writeFile(path.join(outside, 'external.exe'), 'outside');
    await fs.symlink(outside, path.join(root, 'External'));
    expect(await resolvePackageFile(root, 'external/EXTERNAL.exe')).toBeUndefined();
    await fs.symlink('Game.exe', path.join(root, 'alias.exe'));
    expect(await resolvePackageFile(root, 'ALIAS.EXE')).toBe('alias.exe');
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});
