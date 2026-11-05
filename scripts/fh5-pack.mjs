import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile, listPackage } from '@electron/asar';
const names = ['d3d12.dll', 'macxus-metal4-timestamps.dylib', 'windows.web.dll', 'xgameruntime.dll', 'macxus-clock.dll', 'macxus-clock.so'];
async function plainDirectory(folder) {
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('FH5 staging directories must not be links');
}
const archiveName = 'fh5-preview-v1-source.tar.gz';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function readDirectory(root, name) {
  try {
    const file = path.join(root, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Invalid FH5 pack file: ${name}`);
    return await fs.readFile(file);
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
export async function verifyFH5Pack(read, { packaged = false } = {}) {
  const bytes = await read('manifest.json');
  if (!bytes) return { enabled: false };
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || manifest.id !== 'fh5-preview-v1' || manifest.storeId !== '9NNX1VVR3KNQ' ||
      Object.keys(manifest.files ?? {}).sort().join() !== [...names].sort().join() || Object.values(manifest.files).some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Invalid FH5 pack manifest');
  const payload = await Promise.all(names.map(name => read(`payload/${name}`)));
  if (payload.every(bytes => !bytes)) return { enabled: false };
  for (const [index, name] of names.entries()) if (!payload[index] || sha(payload[index]) !== manifest.files[name]) throw Error(`FH5 pack checksum mismatch: ${name}`);
  const files = { 'source.lock.json': manifest.sourceLockSHA256, 'loader-entitlements.plist': manifest.loaderEntitlementsSHA256 };
  for (const [name, expected] of Object.entries(files)) {
    const bytes = await read(name);
    if (!/^[a-f0-9]{64}$/.test(expected ?? '') || !bytes || sha(bytes) !== expected) throw Error(`FH5 pack checksum mismatch: ${name}`);
  }
  for (const name of ['README.md', 'COPYING.GPL-3.0', 'COPYING.LGPL-2.1']) if (!(await read(name))?.length) throw Error(`Missing FH5 pack source/license instructions: ${name}`);
  if (manifest.sourceArchive?.name !== archiveName || !/^[a-f0-9]{64}$/.test(manifest.sourceArchive?.sha256 ?? '')) throw Error('Missing FH5 corresponding-source archive lock');
  const archive = await read(`source-release/${archiveName}`);
  if (packaged ? Boolean(archive) : !archive || sha(archive) !== manifest.sourceArchive.sha256) throw Error(packaged ? 'FH5 complete source archive must be a release asset, not bundled' : 'FH5 corresponding-source checksum mismatch');
  return { enabled: true, manifest };
}
export const verifyFH5Directory = root => verifyFH5Pack(name => readDirectory(root, name));
export function verifyPackagedFH5(asar) {
  const files = new Set(listPackage(asar).map(name => name.replaceAll('\\', '/').replace(/^\//, '')));
  return verifyFH5Pack(async name => files.has(`assets/fh5-preview/${name}`) ? extractFile(asar, `assets/fh5-preview/${name}`) : undefined, { packaged: true });
}
export async function stageFH5Bundle(bundle, assets) {
  await plainDirectory(assets);
  const manifest = JSON.parse(await fs.readFile(path.join(assets, 'manifest.json'), 'utf8'));
  const receipt = JSON.parse(await fs.readFile(path.join(bundle, 'build.json'), 'utf8'));
  if (receipt.sourceLockSHA256 !== manifest.sourceLockSHA256 || JSON.stringify(Object.entries(receipt.files).sort()) !== JSON.stringify(Object.entries(manifest.files).sort()) ||
      (receipt.sourceArchive?.name !== manifest.sourceArchive?.name || receipt.sourceArchive?.sha256 !== manifest.sourceArchive?.sha256)) throw Error('FH5 build does not match the accepted source/payload manifest');
  const payload = new Map();
  for (const name of names) {
    const bytes = await readDirectory(bundle, `payload/${name}`);
    if (!bytes || sha(bytes) !== manifest.files[name]) throw Error('FH5 build payload checksum mismatch');
    payload.set(name, bytes);
  }
  const archive = await readDirectory(bundle, archiveName);
  if (!archive || sha(archive) !== manifest.sourceArchive.sha256) throw Error('FH5 source archive checksum mismatch');
  // Verify everything before changing the packaged source/payload cache.
  const source = path.join(assets, 'source-release'); await fs.mkdir(source, { recursive: true }); await plainDirectory(source);
  const sourceFile = path.join(source, archiveName), existingSource = await readDirectory(source, archiveName);
  if (existingSource && sha(existingSource) !== manifest.sourceArchive.sha256) throw Error('Refusing to overwrite an unknown FH5 source archive');
  if (!existingSource) await fs.writeFile(sourceFile, archive, { flag: 'wx', mode: 0o644 });
  const destination = path.join(assets, 'payload');
  const exists = await fs.lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) { await plainDirectory(destination); await verifyFH5Directory(assets); return; }
  const staging = await fs.mkdtemp(path.join(assets, '.stage-'));
  try {
    for (const [name, bytes] of payload) await fs.writeFile(path.join(staging, name), bytes, { flag: 'wx', mode: 0o644 });
    await fs.rename(staging, destination);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  await verifyFH5Directory(assets);
}
export async function stageFH5Source(assets, output) {
  const result = await verifyFH5Directory(assets);
  if (!result.enabled) return [];
  await fs.mkdir(output, { recursive: true }); await plainDirectory(output);
  const target = path.join(output, archiveName);
  const bytes = await fs.readFile(path.join(assets, 'source-release', archiveName));
  const existing = await readDirectory(output, archiveName);
  if (existing && sha(existing) !== result.manifest.sourceArchive.sha256) throw Error('Refusing to overwrite an unknown release source archive');
  if (!existing) await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
  return [{ file: target, sha256: result.manifest.sourceArchive.sha256 }];
}
