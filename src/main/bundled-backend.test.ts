import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backendLock, backendRecipeSha256 } from './backend-package';
import { MAC_BACKEND_FILES, readBundledBackend, validateBundledBackendManifest } from './bundled-backend';
import { BackendManager } from './backend';
import { run } from './process';

vi.mock('./process.js', () => ({ run: vi.fn() }));
const roots: string[] = [];
const help = 'xodus-cli\n  account    Account\n  login    Login\n  logout    Logout\n  streaming    Streaming\n  run    Run\n  resolve-package    Packages\n\nOptions:\n  --external-webview-stdio  External UI';
beforeEach(() => { vi.mocked(run).mockReset(); vi.mocked(run).mockImplementation(async (command, args) => {
  if (!command.endsWith('/xodus-cli') || !args.includes('--help')) throw Error('The bundle must not start tools, authentication or service processes.');
  return { code: 0, output: args[0] === 'streaming' ? '--progress-json --control-stdin --selected-content-id --download-limit-kib' : args[0] === 'run' ? '--materialize-chain' : help };
}); });
afterEach(async () => { vi.mocked(run).mockReset(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-bundle-')); roots.push(root);
  const files: Record<string, string> = {};
  for (const name of MAC_BACKEND_FILES) {
    const bytes = name.startsWith('xodus-') ? Buffer.concat([Buffer.from('cffaedfe0c000001', 'hex'), Buffer.alloc(120)]) : Buffer.from('synthetic ' + name);
    await fs.writeFile(path.join(root, name), bytes, { mode: name.startsWith('xodus-') ? 0o755 : 0o644 });
    files[name] = createHash('sha256').update(bytes).digest('hex');
  }
  const manifest = { schema: 1, platform: 'darwin', arch: 'arm64', authUi: 'electron', version: backendLock.version,
    commit: backendLock.commit, compatibility: backendLock.macCompatibility, recipeSha256: backendRecipeSha256,
    buildRecipeSha256: 'a'.repeat(64), signingIdentity: null, rustc: `rustc ${backendLock.rust} (fixture)`, files };
  const save = () => fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await save(); return { root, manifest, save };
}
it('makes a fresh Mac profile ready without probing developer tools or writing an installed backend', async () => {
  const f = await fixture();
  const profile = path.join(f.root, 'fresh-profile');
  const manager = new BackendManager(profile, '', () => {}, () => false, fetch, 'darwin', { root: f.root, arch: 'arm64' });
  const status = await manager.refresh();
  expect(status).toMatchObject({ available: true, source: 'bundled', delivery: 'bundled', linuxRunPatch: backendLock.macCompatibility });
  expect(status.capabilities.streamingBandwidthLimit).toBe(true);
  await manager.ensureSigned(); await manager.checkUpdate();
  expect(vi.mocked(run).mock.calls.every(([command, args]) => command.endsWith('/xodus-cli') && args.includes('--help'))).toBe(true);
  await expect(fs.stat(profile)).rejects.toThrow();
});
it.each(['xodus-cli', 'xodus-service', 'source.tar.xz', 'LICENSE'])('rejects tampered %s before executing any binary', async name => {
  const f = await fixture(); await fs.appendFile(path.join(f.root, name), 'changed');
  const status = await new BackendManager('/unused', '', () => {}, () => false, fetch, 'darwin', { root: f.root, arch: 'arm64' }).refresh();
  expect(status.available).toBe(false); expect(status.blockReason).toContain('checksum'); expect(run).not.toHaveBeenCalled();
});
it('rejects symlinks and an executable for a different architecture', async () => {
  const f = await fixture(), cli = path.join(f.root, 'xodus-cli');
  await fs.rename(cli, cli + '.outside'); await fs.symlink(cli + '.outside', cli);
  await expect(readBundledBackend(f.root, 'arm64')).rejects.toThrow();
  await fs.unlink(cli); await fs.rename(cli + '.outside', cli);
  const bytes = Buffer.alloc(128); await fs.writeFile(cli, bytes);
  f.manifest.files['xodus-cli'] = createHash('sha256').update(bytes).digest('hex'); await f.save();
  await expect(readBundledBackend(f.root, 'arm64')).rejects.toThrow('Apple Silicon');
});
it('binds bundles to the exact pinned source, recipe, platform and full source/license payload', async () => {
  const f = await fixture();
  for (const patch of [{ commit: 'b'.repeat(40) }, { recipeSha256: 'b'.repeat(64) }, { compatibility: 'old' }, { arch: 'x64' }, { platform: 'linux' }, { signingIdentity: undefined }, { signingIdentity: 'unknown' }, { files: { 'xodus-cli': 'a'.repeat(64) } }]) {
    expect(() => validateBundledBackendManifest({ ...f.manifest, ...patch }, 'arm64')).toThrow();
  }
  expect(validateBundledBackendManifest({ ...f.manifest, signingIdentity: 'AB'.repeat(20) }, 'arm64').signingIdentity).toBe('AB'.repeat(20));
});
it('preserves an explicitly selected developer checkout without changing the bundle', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.root, 'target/release'), { recursive: true });
  await fs.copyFile(path.join(f.root, 'xodus-cli'), path.join(f.root, 'target/release/xodus-cli'));
  const manager = new BackendManager('/unused', f.root, () => {}, () => false, fetch, 'darwin', { root: f.root, arch: 'arm64' });
  expect((await manager.refresh()).source).toBe('external');
  expect(vi.mocked(run).mock.calls[0][0]).toBe(path.join(f.root, 'target/release/xodus-cli'));
});
it('fails closed when a packaged app is missing its backend instead of asking users to install Rust', async () => {
  const f = await fixture();
  const manager = new BackendManager('/unused', '', () => {}, () => false, fetch, 'darwin', { root: path.join(f.root, 'missing'), arch: 'arm64' });
  await manager.refresh(); await manager.ensureSigned();
  const status = await manager.checkUpdate();
  expect(status.available).toBe(false); expect(status.delivery).toBe('bundled'); expect(status.blockReason).toContain('Reinstall MACxus'); expect(run).not.toHaveBeenCalled();
});

it('uses the bundle in preference to an old automatically discovered local build', async () => {
  const f = await fixture(), profile = path.join(f.root, 'profile');
  await fs.mkdir(path.join(profile, 'xodus-backends'), { recursive: true });
  await fs.writeFile(path.join(profile, 'xodus-backends/current.json'), JSON.stringify({ binaryPath: path.join(f.root, 'xodus-cli'), delivery: 'local' }));
  expect((await new BackendManager(profile, '', () => {}, () => false, fetch, 'darwin', { root: f.root, arch: 'arm64' }).refresh()).source).toBe('bundled');
});
it('preserves a developer rebuild explicitly selected with the current recipe', async () => {
  const f = await fixture(), profile = path.join(f.root, 'profile');
  await fs.mkdir(path.join(profile, 'xodus-backends'), { recursive: true });
  await fs.writeFile(path.join(profile, 'xodus-backends/current.json'), JSON.stringify({ binaryPath: path.join(f.root, 'xodus-cli'), delivery: 'local', preferLocal: true, recipeSha256: backendRecipeSha256, linuxRunPatch: backendLock.macCompatibility }));
  expect((await new BackendManager(profile, '', () => {}, () => false, fetch, 'darwin', { root: f.root, arch: 'arm64' }).refresh()).source).toBe('managed');
});
