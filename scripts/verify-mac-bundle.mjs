// Account-free packaged-backend smoke test. Compiler/tool lookup is disabled.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackendManager } from '../dist-electron/main/backend.js';

const app = process.argv[2];
if (!app || process.argv.length !== 3) throw Error('Usage: verify-mac-bundle.mjs MACxus.app');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-first-launch-'));
const oldPath = process.env.PATH;
try {
  process.env.PATH = '';
  const manager = new BackendManager(profile, '', () => {}, () => false, fetch, 'darwin', { root: path.resolve(app, 'Contents/Resources/backend'), arch: 'arm64' });
  const status = await manager.refresh();
  await manager.ensureSigned();
  await manager.checkUpdate();
  if (!status.available || status.source !== 'bundled' || status.delivery !== 'bundled') throw Error(status.blockReason ?? 'The packaged backend is not ready.');
  if (Object.values(status.prerequisites).some(Boolean) || (await fs.readdir(profile)).length) throw Error('Bundled startup unexpectedly needed tools or installed backend state.');
  console.log(`Packaged backend ${status.version} ready from a fresh profile with an empty PATH. No account/service/game started; no developer tools or backend installation were needed.`);
} finally {
  if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
  await fs.rm(profile, { recursive: true, force: true });
}
