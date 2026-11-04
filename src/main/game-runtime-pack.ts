import { validateCompatibilityPrefix } from './compatibility-prefix.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRuntimePack } from '../shared/runtime-pack-schema.mjs';
import type { CompatibilityPack, CompatibilityPackRequest } from './game-compatibility-pack.js';
const ASSET_ROOT = fileURLToPath(new URL('../../assets/compatibility-packs/bond-public-config-v1/', import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function file(name: string, expected: string): Promise<Buffer> {
  const stat = await fs.lstat(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw Error('Invalid runtime pack file.');
  const bytes = await fs.readFile(name);
  if (sha(bytes) !== expected) throw Error(`Runtime pack checksum mismatch: ${path.basename(name)}.`);
  return bytes;
}
async function directories(root: string, parts: string[], create: boolean): Promise<string> {
  let target = root;
  for (const part of ['', ...parts]) {
    target = path.join(target, part);
    if (create && part) await fs.mkdir(target, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
    try {
      const stat = await fs.lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Runtime pack paths must be plain directories.');
    } catch (e) {
      if (!create && (e as NodeJS.ErrnoException).code === 'ENOENT') return target;
      throw e;
    }
  }
  return target;
}
async function existing(name: string): Promise<Buffer | undefined> {
  try {
    const stat = await fs.lstat(name);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) throw Error('Invalid runtime pack destination.');
    return await fs.readFile(name);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
/** Separate 007 bottle; runtime DLLs are installed after ordinary Wine setup.
 * Never use the global runtime override directory or alter an engine bundle.
 */
export async function prepareGameRuntimePack(request: CompatibilityPackRequest, assetRoot = ASSET_ROOT): Promise<CompatibilityPack | undefined> {
  if (request.storeId?.toUpperCase() !== '9PN198B459VB' || request.engine !== 'crossover-preview' || request.installation.supportsArm64) return undefined;
  let metadata: string;
  try { metadata = await fs.readFile(path.join(assetRoot, 'manifest.json'), 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    try { await fs.lstat(assetRoot); }
    catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing;
      request.log('007 public configuration pack is unavailable; using the selected engine.'); return undefined;
    }
    throw Error('007 public configuration pack manifest is missing.');
  }
  const manifest = parseRuntimePack(JSON.parse(metadata));
  const config = await fs.readFile(path.join(request.installation.root, 'etc/CrossOver.conf'), 'utf8');
  if (manifest.version !== request.installation.version || !config.split(/\r?\n/).some(l => l.trim() === `"BuildTag" = "${manifest.buildTag}"`)) {
    request.log('007 public configuration pack does not match this Preview build; using the selected engine.'); return undefined;
  }
  let payload: Buffer;
  try { payload = await file(path.join(assetRoot, 'payload/winhttp.dll'), manifest.dllSHA256); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    request.log('007 public configuration pack is not built; using the selected engine.'); return undefined;
  }
  for (const [name, expected] of Object.entries(manifest.sources)) await file(path.join(assetRoot, 'source', name), expected);
  await file(path.join(assetRoot, 'LICENSE'), manifest.licenseSHA256);
  await fs.mkdir(request.dataRoot, { recursive: true });
  const parts = ['compatibility-packs', manifest.id, 'bottles'];
  const bottlesRoot = await directories(request.dataRoot, parts, true);
  const prefix = path.join(bottlesRoot, 'xbox');
  const validatePrefix = async (actual: string) => {
    if (path.resolve(actual) !== prefix) throw Error('007 runtime pack requires its dedicated bottle.');
    await directories(request.dataRoot, parts, false);
    await validateCompatibilityPrefix(prefix, bottlesRoot);
    const system = path.join(prefix, 'drive_c/windows/system32');
    const current = await existing(path.join(system, 'winhttp.dll'));
    const alias = await existing(path.join(system, 'mxhttp.dll'));
    // A reused wrapper may be loaded by Wine setup helpers. Validate its
    // dependency before starting Wine, not only before publishing the overlay.
    if ((current && ![manifest.baseNativeSHA256, manifest.dllSHA256].includes(sha(current)))
        || (alias && sha(alias) !== manifest.baseNativeSHA256)) throw Error('007 pack requires its exact unmodified runtime WinHTTP.');
  };
  return {
    installation: request.installation, bottlesRoot, environment: { ...manifest.environment }, validatePrefix,
    configurePrefix: async actual => {
      await validatePrefix(actual);
      const system = await directories(request.dataRoot, [...parts, 'xbox', 'drive_c', 'windows', 'system32'], false);
      if (system !== path.join(prefix, 'drive_c/windows/system32')) throw Error('Runtime pack setup is incomplete.');
      const target = path.join(system, 'winhttp.dll'), alias = path.join(system, 'mxhttp.dll');
      const current = await existing(target), previous = await existing(alias);
      if (!current || ![manifest.baseNativeSHA256, manifest.dllSHA256].includes(sha(current))
          || (previous && sha(previous) !== manifest.baseNativeSHA256)) throw Error('007 pack requires its exact unmodified runtime WinHTTP.');
      const original = sha(current) === manifest.baseNativeSHA256 ? current : previous;
      if (!original) throw Error('Missing original WinHTTP for 007 pack.');
      const stage = await fs.mkdtemp(path.join(system, '.007-runtime-'));
      try {
        await fs.writeFile(path.join(stage, 'mxhttp.dll'), original, { flag: 'wx', mode: 0o644 });
        await fs.writeFile(path.join(stage, 'winhttp.dll'), payload, { flag: 'wx', mode: 0o644 });
        // Verify everything first. Publish the dependency before the wrapper.
        await file(path.join(stage, 'mxhttp.dll'), manifest.baseNativeSHA256);
        await file(path.join(stage, 'winhttp.dll'), manifest.dllSHA256);
        await fs.rename(path.join(stage, 'mxhttp.dll'), alias);
        await fs.rename(path.join(stage, 'winhttp.dll'), target);
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
      request.log('007 public configuration compatibility enabled in its dedicated bottle.');
    },
  };
}
