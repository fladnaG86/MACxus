// One bounded native forwarding recipe; metadata cannot name commands or paths.
import { parseCompatibilityCatalog } from './compatibility-pack-schema.mjs';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function parseRuntimePack(value) {
  const fail = () => { throw Error('Invalid runtime compatibility pack metadata.'); };
  if (!value || typeof value !== 'object') fail();
  parseCompatibilityCatalog({ schemaVersion: 1, packs: [value] });
  if (value.schemaVersion !== 1 || value.id !== 'bond-public-config-v1' || value.storeId !== '9PN198B459VB'
      || value.engine !== 'crossover-preview' || value.recipe !== 'winhttp-forwarder-v1'
      || value.environment?.MACXUS_007_PUBLIC_CONFIG !== '1' || Object.keys(value.environment).length !== 1
      || !hash(value.dllSHA256) || !hash(value.baseNativeSHA256) || !hash(value.licenseSHA256)
      || typeof value.toolchain?.gcc !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.toolchain.gcc)) fail();
  const names = ['winhttp.c', 'winhttp.def', 'build.mjs', 'test.c'];
  if (!value.sources || Object.keys(value.sources).length !== names.length || !names.every(n => hash(value.sources[n]))) fail();
  return value;
}
