import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MAC_RUNTIME_DLLS } from './crossover.js';
import { configurationPath, type UnrealIniAction } from '../shared/compatibility-pack-schema.mjs';

/** Read-only preflight before either Wine engine may create/update the bottle.
 * Missing paths are allowed for first boot; existing setup destinations must
 * stay inside this bottle. Normal Wine drive/user-document links are not
 * recursively traversed. This is not isolation from concurrent external edits. */
export async function validateCompatibilityPrefix(prefix: string, bottlesRoot: string, configuration: readonly UnrealIniAction[] = []): Promise<void> {
  const directories = async (root: string, relative: string): Promise<boolean> => {
    let current = root;
    for (const part of ['', ...relative.split('/').filter(Boolean)]) {
      current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Compatibility bottle setup directories must not be symlinks.');
    }
    return true;
  };
  const file = async (target: string) => {
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error(`Compatibility bottle setup files must not be links: ${path.basename(target)}.`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  };
  await file(path.join(bottlesRoot, 'xodus-crossover-wine'));
  await file(path.join(bottlesRoot, `xodus-crossover-wine.tmp-${process.pid}`));
  if (!await directories(prefix, '')) return;
  // Registry, bottle configuration and Wine's temporary registry files live
  // at the top level; linked hives could otherwise update another bottle.
  for (const entry of await fs.readdir(prefix, { withFileTypes: true })) {
    if (!entry.isDirectory()) await file(path.join(prefix, entry.name));
  }
  for (const relative of ['dosdevices', 'drive_c/windows/system32', 'drive_c/windows/syswow64',
    ...configuration.map(configurationPath)]) {
    await directories(prefix, relative);
  }
  for (const action of configuration) {
    if (await directories(prefix, configurationPath(action))) await file(path.join(prefix, configurationPath(action), action.file));
  }
  if (await directories(prefix, 'drive_c/windows/system32')) {
    for (const name of MAC_RUNTIME_DLLS) {
      await file(path.join(prefix, 'drive_c/windows/system32', name));
      await file(path.join(prefix, 'drive_c/windows/system32', `${name}.nexus-${process.pid}`));
    }
  }
  if (await directories(prefix, 'dosdevices')) {
    const drive = path.join(prefix, 'dosdevices/c:');
    try {
      const stat = await fs.lstat(drive);
      if (!stat.isSymbolicLink() || path.resolve(path.dirname(drive), await fs.readlink(drive)) !== path.join(prefix, 'drive_c')) {
        throw Error('The compatibility bottle C: drive must point to its own drive_c.');
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
