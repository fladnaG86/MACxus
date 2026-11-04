import type { CompatibilityRoute } from './compatibility-pack-schema.mjs';
export interface RuntimePackManifest extends CompatibilityRoute {
  schemaVersion: 1; id: 'bond-public-config-v1'; storeId: '9PN198B459VB'; engine: 'crossover-preview';
  recipe: 'winhttp-forwarder-v1'; environment: { MACXUS_007_PUBLIC_CONFIG: '1' };
  dllSHA256: string; baseNativeSHA256: string; licenseSHA256: string;
  toolchain: { gcc: string }; sources: Record<string, string>;
}
export function parseRuntimePack(value: unknown): RuntimePackManifest;
