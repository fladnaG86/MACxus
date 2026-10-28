import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractFile } from '@electron/asar';
import { parseCompatibilityCatalog, parseCompatibilityManifest } from '../src/shared/compatibility-pack-schema.mjs';

const relative = 'assets/compatibility-packs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// The complete source archive stays in the repository pack directory and is
// published as an asset of the same release; the app bundle must not carry it.
export async function verifyCompatibilityPack(read, entry, { packaged = false } = {}) {
  const manifest = parseCompatibilityManifest(JSON.parse((await read('manifest.json')).toString('utf8')), entry);
  const archive = `source/${manifest.source.archive}`;
  if (packaged && await read(archive).then(() => true, () => false)) throw Error(`Compatibility pack source archive must be a release asset, not bundled: ${archive}`);
  const files = {
    ...Object.fromEntries(Object.entries(manifest.dlls).map(([name, hash]) => [`payload/${name}`, hash])),
    ...(packaged ? {} : { [archive]: manifest.source.sha256 }),
    'COPYING.LIB': manifest.licenseSHA256,
    [`source/${path.posix.basename(manifest.patch.path)}`]: manifest.patch.sha256,
  };
  for (const [file, expected] of Object.entries(files)) {
    if (digest(await read(file)) !== expected) throw Error(`Compatibility pack checksum mismatch: ${file}`);
  }
  for (const file of ['source/build-scripts/prepare-compatibility-packs.mjs', 'source/build-scripts/compatibility-packs.mjs', 'source/build-scripts/compatibility-pack-build.mjs', 'source/src/shared/compatibility-pack-schema.mjs', 'README.md']) {
    if (!(await read(file)).length) throw Error(`Missing compatibility pack source instructions: ${file}`);
  }
  return manifest;
}
export function verifyCompatibilityPackDirectory(root, entry) { return verifyCompatibilityPack(file => fs.readFile(path.join(root, file)), entry); }
async function verifyAll(read, options) {
  const catalog = parseCompatibilityCatalog(JSON.parse((await read('catalog.json')).toString('utf8')));
  const manifests = [];
  for (const entry of catalog.packs) manifests.push(await verifyCompatibilityPack(file => read(`${entry.id}/${file}`), entry, options));
  return Object.assign(catalog, { manifests });
}
export function verifyCompatibilityPacksDirectory(root) { return verifyAll(file => fs.readFile(path.join(root, file))); }
export function verifyPackagedCompatibilityPacks(archive) { return verifyAll(async file => extractFile(archive, `${relative}/${file}`), { packaged: true }); }
// Copies each verified complete source archive next to the release artifacts.
export async function stageCompatibilityPackSources(root, output) {
  const { packs, manifests } = await verifyCompatibilityPacksDirectory(root);
  await fs.mkdir(output, { recursive: true });
  const staged = new Map();
  for (const [index, manifest] of manifests.entries()) {
    const name = manifest.source.archive, target = path.join(output, name);
    if (staged.has(name)) { if (staged.get(name) !== manifest.source.sha256) throw Error(`Conflicting source archives named ${name}`); continue; }
    await fs.copyFile(path.join(root, packs[index].id, 'source', name), target);
    if (digest(await fs.readFile(target)) !== manifest.source.sha256) throw Error(`Compatibility pack checksum mismatch: ${target}`);
    staged.set(name, manifest.source.sha256);
  }
  return [...staged].map(([name, sha256]) => ({ file: path.join(output, name), sha256 }));
}
