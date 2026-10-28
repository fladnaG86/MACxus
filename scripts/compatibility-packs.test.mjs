import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createPackage } from '@electron/asar';
import { stageCompatibilityPackSources, verifyCompatibilityPacksDirectory, verifyPackagedCompatibilityPacks } from './compatibility-packs.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');
const reference = JSON.parse(await fs.readFile(new URL('../assets/compatibility-packs/halo-preview-media-v1/manifest.json', import.meta.url), 'utf8'));

async function fixture(temp) {
  const app = path.join(temp, 'app'), assets = path.join(app, 'assets/compatibility-packs');
  const routes = [];
  for (const [id, storeId, dll] of [['synthetic-alpha-v1', '111111111111', 'alpha.dll'], ['synthetic-beta-v1', '222222222222', 'beta.dll']]) {
    const root = path.join(assets, id), manifest = structuredClone(reference);
    Object.assign(manifest, { id, storeId, dlls: { [dll]: sha(`test-${dll}`) }, originalDLLs: { [dll]: sha(`original-${dll}`) }, buildTimestamps: { [dll]: 42 } });
    const data = {
      [`payload/${dll}`]: `test-${dll}`,
      [`source/${manifest.source.archive}`]: 'test-complete-source',
      'COPYING.LIB': 'test-license',
      'source/build-scripts/prepare-compatibility-packs.mjs': 'test-build-recipe',
      'source/build-scripts/compatibility-packs.mjs': 'test-verifier',
      'source/build-scripts/compatibility-pack-build.mjs': 'test-relative-build-policy',
      'source/src/shared/compatibility-pack-schema.mjs': 'test-schema',
      'README.md': 'test-attribution-and-instructions',
      [`source/${path.posix.basename(manifest.patch.path)}`]: 'test-source-patch',
    };
    manifest.source.sha256 = sha('test-complete-source'); manifest.licenseSHA256 = sha('test-license'); manifest.patch.sha256 = sha('test-source-patch');
    for (const [file, bytes] of Object.entries(data)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), bytes); }
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    routes.push(Object.fromEntries(['id', 'storeId', 'engine', 'version', 'buildTag'].map(key => [key, manifest[key]])));
  }
  await fs.writeFile(path.join(assets, 'catalog.json'), JSON.stringify({ schemaVersion: 1, packs: routes }));
  return { app, assets };
}

test('verifies every registered pack inside the actual ASAR, with complete sources kept out of the app', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'compatibility-package-'));
  try {
    const { app, assets } = await fixture(temp);
    await verifyCompatibilityPacksDirectory(assets);
    const bundled = path.join(temp, 'bundled.asar'); await createPackage(app, bundled);
    await assert.rejects(verifyPackagedCompatibilityPacks(bundled), /must be a release asset/);
    const sources = path.join(temp, 'sources');
    await fs.mkdir(sources);
    for (const id of ['synthetic-alpha-v1', 'synthetic-beta-v1']) await fs.rename(path.join(assets, id, 'source', reference.source.archive), path.join(sources, id));
    const archive = path.join(temp, 'good.asar'); await createPackage(app, archive); await verifyPackagedCompatibilityPacks(archive);
    await assert.rejects(verifyCompatibilityPacksDirectory(assets));
    await fs.writeFile(path.join(assets, 'synthetic-beta-v1/payload/beta.dll'), 'corrupt');
    const corrupt = path.join(temp, 'corrupt.asar'); await createPackage(app, corrupt); await assert.rejects(verifyPackagedCompatibilityPacks(corrupt), /checksum mismatch/);
    for (const id of ['synthetic-alpha-v1', 'synthetic-beta-v1']) await fs.rename(path.join(sources, id), path.join(assets, id, 'source', reference.source.archive));
    await assert.rejects(verifyCompatibilityPacksDirectory(assets), /checksum mismatch/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('stages each verified complete source archive once as a release asset', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'compatibility-package-'));
  try {
    const { assets } = await fixture(temp), output = path.join(temp, 'release');
    const staged = await stageCompatibilityPackSources(assets, output);
    assert.deepEqual(staged, [{ file: path.join(output, reference.source.archive), sha256: sha('test-complete-source') }]);
    assert.equal(await fs.readFile(staged[0].file, 'utf8'), 'test-complete-source');
    await fs.writeFile(path.join(assets, 'synthetic-beta-v1/source', reference.source.archive), 'tampered');
    await assert.rejects(stageCompatibilityPackSources(assets, output), /checksum mismatch/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('rejects an incomplete second pack and catalog/manifest routing mismatches', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'compatibility-package-'));
  try {
    const { assets } = await fixture(temp), file = path.join(assets, 'synthetic-beta-v1/manifest.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8')); manifest.storeId = '333333333333';
    await fs.writeFile(file, JSON.stringify(manifest));
    await assert.rejects(verifyCompatibilityPacksDirectory(assets), /manifest\/catalog mismatch/);
    manifest.storeId = '222222222222'; await fs.writeFile(file, JSON.stringify(manifest));
    await fs.unlink(path.join(assets, 'synthetic-beta-v1/source/src/shared/compatibility-pack-schema.mjs'));
    await assert.rejects(verifyCompatibilityPacksDirectory(assets));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
