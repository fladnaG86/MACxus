// Release step: the complete compatibility pack source archives are published
// as assets of the same release as the DMG instead of inside app.asar.
import { stageCompatibilityPackSources } from './compatibility-packs.mjs';

const output = process.argv[2];
if (!output || process.argv.length !== 3) throw Error('Usage: stage-compatibility-pack-sources.mjs OUTPUT_DIRECTORY');
for (const { file, sha256 } of await stageCompatibilityPackSources('assets/compatibility-packs', output)) {
  console.log(`Release asset (complete LGPL source, upload with the DMG): ${file} sha256 ${sha256}`);
}
