import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backendLock, backendRecipeSha256 } from './backend-package.js';

export const MAC_BACKEND_FILES = ['xodus-cli', 'xodus-service', 'LICENSE', 'source.tar.xz'] as const;
export interface BundledBackendManifest {
  schema: 1; platform: 'darwin'; arch: 'arm64'; authUi: 'electron';
  version: string; commit: string; compatibility: string; recipeSha256: string;
  buildRecipeSha256: string; signingIdentity: string | null; rustc: string;
  files: Record<typeof MAC_BACKEND_FILES[number], string>;
}

export function validateBundledBackendManifest(value: unknown, arch: string): BundledBackendManifest {
  const item = value as BundledBackendManifest | undefined;
  if (!item || item.schema !== 1 || item.platform !== 'darwin' || item.arch !== arch || arch !== 'arm64' || item.authUi !== 'electron' ||
      item.version !== backendLock.version || item.commit !== backendLock.commit || item.compatibility !== backendLock.macCompatibility ||
      item.recipeSha256 !== backendRecipeSha256 || !/^[a-f0-9]{64}$/.test(item.buildRecipeSha256 ?? '') ||
      (item.signingIdentity !== null && (typeof item.signingIdentity !== 'string' || !/^[A-F\d]{40}$/.test(item.signingIdentity))) ||
      !item.rustc?.startsWith(`rustc ${backendLock.rust} `) ||
      !item.files || Object.keys(item.files).sort().join() !== [...MAC_BACKEND_FILES].sort().join() ||
      Object.values(item.files).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) {
    throw Error('The bundled backend does not match this MACxus build. Reinstall MACxus.');
  }
  return item;
}

/** Read and hash regular files through the same descriptor; never follow bundle symlinks. */
async function verifiedFile(file: string, expected: string, executable: boolean): Promise<void> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    const limit = file.endsWith('source.tar.xz') ? 512 * 1024 ** 2 : 256 * 1024 ** 2;
    if (!stat.isFile() || stat.size === 0 || stat.size > limit || executable && !(stat.mode & 0o111)) throw Error('Invalid bundled backend file.');
    if (executable) {
      const bytes = Buffer.alloc(8);
      await handle.read(bytes, 0, bytes.length, 0);
      // Thin 64-bit little-endian Mach-O, CPU_TYPE_ARM64. No ELF/x86 payloads.
      if (bytes.toString('hex') !== 'cffaedfe0c000001') throw Error('The bundled backend is not an Apple Silicon executable.');
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw Error('Bundled backend checksum mismatch. Reinstall MACxus.');
  } finally { await handle.close(); }
}

export async function readBundledBackend(root: string, arch: string = process.arch): Promise<{ manifest: BundledBackendManifest; cli: string }> {
  if ((await fs.lstat(root)).isSymbolicLink()) throw Error('The bundled backend directory must not be a symbolic link.');
  const handle = await fs.open(path.join(root, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: unknown;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) throw Error('Invalid bundled backend manifest.');
    value = JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
  const manifest = validateBundledBackendManifest(value, arch);
  for (const name of MAC_BACKEND_FILES) await verifiedFile(path.join(root, name), manifest.files[name], name.startsWith('xodus-'));
  return { manifest, cli: path.join(root, 'xodus-cli') };
}
