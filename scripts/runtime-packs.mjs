import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';
import { parseRuntimePack } from '../src/shared/runtime-pack-schema.mjs';
export const runtimePackRoot = 'assets/compatibility-packs/bond-public-config-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyRuntimePack(read) {
  const m = parseRuntimePack(JSON.parse((await read('manifest.json')).toString('utf8')));
  const files = { 'payload/winhttp.dll': m.dllSHA256, LICENSE: m.licenseSHA256,
    ...Object.fromEntries(Object.entries(m.sources).map(([name, digest]) => [`source/${name}`, digest])) };
  for (const [name, digest] of Object.entries(files)) {
    if (hash(await read(name)) !== digest) throw Error(`Runtime compatibility checksum mismatch: ${name}.`);
  }
  if (!(await read('README.md')).length) throw Error('Runtime compatibility instructions are missing.');
  return m;
}
export const verifyRuntimePackDirectory = root => verifyRuntimePack(name => fs.readFile(path.join(root, name)));
export const verifyPackagedRuntimePack = archive => verifyRuntimePack(async name => extractFile(archive, `${runtimePackRoot}/${name}`));
