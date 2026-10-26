import { promises as fs, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const inventoryError = () => Error('Could not verify mounted filesystems. Nothing was deleted. Remove the entry from the library instead.');
const boundaryError = () => Error('The game folder contains a mounted filesystem. Nothing was deleted. Remove the entry from the library instead.');

/** Injectable native-format inventory and stat fixtures; production callers use defaults. */
export type GameDeleteSafety = Readonly<{
  platform?: NodeJS.Platform;
  mountInfo?: () => Promise<string>;
  stat?: (file: string) => Promise<Pick<BigIntStats, 'dev' | 'isDirectory' | 'isSymbolicLink'>>;
}>;

async function nativeMountInfo(platform: NodeJS.Platform): Promise<string> {
  if (platform === 'linux') return fs.readFile('/proc/self/mountinfo', 'utf8');
  if (platform === 'darwin') {
    // No arguments: list mounts only. Never invoke a shell or mount a filesystem.
    const result = await execute('/sbin/mount', [], { encoding: 'utf8', timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.stderr) throw inventoryError();
    return result.stdout;
  }
  throw inventoryError();
}

function mountPaths(inventory: string, platform: NodeJS.Platform): string[] {
  if (!inventory || inventory.length > 4 * 1024 * 1024 || inventory.includes('\0')) throw inventoryError();
  const lines = inventory.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const mounts = lines.map(line => {
    let mount: string;
    if (platform === 'linux') {
      const parts = line.split(' - '), fields = parts[0].split(' '), tail = parts[1]?.split(' ');
      if (parts.length !== 2 || fields.length < 6 || fields.some(field => !field)
        || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1]) || !/^\d+:\d+$/.test(fields[2])
        || tail?.length !== 3 || tail.some(field => !field)) throw inventoryError();
      // procfs escapes spaces, tabs, newlines and backslashes in path fields.
      if (/\\(?!040|011|012|134)/.test(fields[4])) throw inventoryError();
      mount = fields[4].replace(/\\(040|011|012|134)/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
    } else if (platform === 'darwin') {
      // mount(8) prints raw names. Reject ambiguous records rather than skip them.
      const parts = line.split(' on '), match = parts[1]?.match(/^(\/.*) \([\w.-]+(?:, [^()\r\n]*)?\)$/);
      if (parts.length !== 2 || !parts[0] || !match) throw inventoryError();
      mount = match[1];
    } else throw inventoryError();
    if (!path.posix.isAbsolute(mount) || path.posix.normalize(mount) !== mount) throw inventoryError();
    return mount;
  });
  // An empty/truncated listing must not silently authorize deletion.
  if (!mounts.includes('/')) throw inventoryError();
  return mounts;
}

function contains(directory: string, mount: string): boolean {
  const relative = path.relative(directory, mount);
  return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Complete preflight before fs.rm can delete any child. Symlinks are unlinked,
 * never followed. st_dev alone cannot identify Linux same-device bind mounts.
 * This is a preflight, not isolation against concurrent external mount changes. */
export async function assertGameDeleteBoundary(directory: string, device: bigint, safety: GameDeleteSafety = {}): Promise<void> {
  const platform = safety.platform ?? process.platform;
  if (platform !== 'linux' && platform !== 'darwin') throw inventoryError();
  const readInventory = safety.mountInfo ?? (() => nativeMountInfo(platform));
  const checkMounts = async () => {
    let mounts: string[];
    try { mounts = mountPaths(await readInventory(), platform); }
    catch { throw inventoryError(); }
    if (mounts.some(mount => contains(directory, mount))) throw boundaryError();
  };
  await checkMounts();
  const stat = safety.stat ?? (file => fs.lstat(file, { bigint: true }));
  let count = 0;
  const visit = async (file: string): Promise<void> => {
    if (++count > 200_000) throw Error('Too many files to verify safely. Nothing was deleted.');
    // Raw macOS mount output cannot represent control-character names reliably.
    // Refuse such layouts (and escape-like names), even if a listing looks valid.
    if (platform === 'darwin' && /[\x00-\x1f\x7f\\]/.test(file)) throw inventoryError();
    const entry = await stat(file);
    if (entry.isSymbolicLink()) return;
    if (entry.dev !== device) throw boundaryError();
    if (entry.isDirectory()) for (const name of await fs.readdir(file)) await visit(path.join(file, name));
  };
  await visit(directory);
  // Re-read after walking so a mount added during verification is rejected too.
  await checkMounts();
}
