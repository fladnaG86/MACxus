import { promises as fs, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Snapshot only vendor-signed compatibility data. CrossOver verifies the
 * detached signatures against its own key when it reads this private home.
 * No account, license or bottle configuration is copied. */
export async function prepareFH5CompatHome(source: string, root: string): Promise<{ home: string; pairs: number }> {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Invalid FH5 compatibility snapshot root.');
  const files = new Map<string, Buffer>();
  try {
    const stat = await fs.lstat(source);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('FH5 compatibility database home must be a plain directory.');
    const names = (await fs.readdir(source)).filter(name => /^compatdb-\d{1,3}\.dat$/.test(name)).sort();
    if (names.length > 8) throw Error('Too many FH5 compatibility databases.');
    for (const name of names) {
      const pair = new Map<string, Buffer>();
      for (const [file, maximum] of [[name, 1024 * 1024], [name + '.sha256', 4096]] as const) {
        try {
          // O_NOFOLLOW plus fstat keeps a swapped link from redirecting reads.
          const before = await fs.lstat(path.join(source, file));
          if (!before.isFile() || before.isSymbolicLink()) throw Error('Invalid FH5 compatibility database file.');
          const handle = await fs.open(path.join(source, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || before.isSymbolicLink() || before.dev !== stat.dev || before.ino !== stat.ino || stat.size < 1 || stat.size > maximum)
              throw Error('Invalid FH5 compatibility database file.');
            const bytes = Buffer.alloc(stat.size);
            let offset = 0;
            while (offset < bytes.length) {
              const read = await handle.read(bytes, offset, bytes.length - offset, offset);
              if (!read.bytesRead) throw Error('FH5 compatibility database changed while reading.');
              offset += read.bytesRead;
            }
            const after = await handle.stat();
            if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw Error('FH5 compatibility database changed while reading.');
            pair.set(file, bytes);
          } finally { await handle.close(); }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (pair.size === 2) for (const [file, bytes] of pair) files.set(file, bytes);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const hash = createHash('sha256');
  for (const [name, bytes] of files) hash.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  const home = path.join(root, hash.digest('hex'));
  const validate = async () => {
    const stat = await fs.lstat(home);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid FH5 compatibility database snapshot.');
    const names = (await fs.readdir(home)).sort();
    if (names.join('\0') !== [...files.keys()].sort().join('\0')) throw Error('FH5 compatibility database snapshot changed.');
    for (const [name, bytes] of files) {
      const file = path.join(home, name), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== bytes.length || !(await fs.readFile(file)).equals(bytes))
        throw Error('FH5 compatibility database snapshot changed.');
    }
  };
  try { await fs.lstat(home); await validate(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const staging = await fs.mkdtemp(path.join(root, '.snapshot-'));
    try {
      for (const [name, bytes] of files) await fs.writeFile(path.join(staging, name), bytes, { flag: 'wx', mode: 0o600 });
      try { await fs.rename(staging, home); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      await validate();
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  return { home, pairs: files.size / 2 };
}
