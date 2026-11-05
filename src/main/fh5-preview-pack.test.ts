import { expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { prepareFH5PreviewPack, FH5_STORE_ID, type FH5PackDeps } from './fh5-preview-pack.js';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fh5 pack user's paths "));
  const app = path.join(root, 'Renamed Preview.app'), engine = path.join(app, 'Contents/SharedSupport/CrossOver');
  const assets = path.join(root, 'app.asar/assets/fh5-preview'), dataRoot = path.join(root, 'user data');
  await fs.mkdir(path.join(assets, 'payload'), { recursive: true });
  const source = Buffer.from('source lock fixture'), entitlements = Buffer.from('entitlements fixture');
  await fs.writeFile(path.join(assets, 'source.lock.json'), source); await fs.writeFile(path.join(assets, 'loader-entitlements.plist'), entitlements);
  const engineFiles = ['lib/apple_gptk/external/D3DMetal.framework/Versions/A/D3DMetal', 'lib/apple_gptk/external/D3DMetal.framework/Versions/A/Resources/libmetalirconverter.dylib', 'lib/apple_gptk/external/libd3dshared.dylib', 'lib/apple_gptk/wine/x86_64-windows/d3d12core.dll', 'lib/apple_gptk/wine/x86_64-windows/d3d12.dll', 'lib/apple_gptk/wine/x86_64-windows/nvapi64.dll', 'lib/apple_gptk/wine/x86_64-unix/nvapi64.so', 'lib/wine/x86_64-unix/ntdll.so', 'lib/wine/x86_64-unix/wine'];
  const files = ['d3d12.dll', 'macxus-metal4-timestamps.dylib', 'windows.web.dll', 'xgameruntime.dll', 'macxus-clock.dll', 'macxus-clock.so'];
  for (const name of engineFiles) { await fs.mkdir(path.dirname(path.join(engine, name)), { recursive: true }); await fs.writeFile(path.join(engine, name), 'vendor ' + name); }
  const providerAlias = 'lib/apple_gptk/wine/x86_64-unix/nvapi64.so';
  const providerTarget = 'lib/apple_gptk/external/libd3dshared.dylib';
  await fs.unlink(path.join(engine, providerAlias));
  await fs.symlink('../../external/libd3dshared.dylib', path.join(engine, providerAlias));
  await fs.mkdir(path.join(engine, 'etc')); await fs.writeFile(path.join(engine, 'etc/CrossOver.conf'), '"BuildTag" = "cxpreview-20261015-rc1"\n');
  for (const name of files) await fs.writeFile(path.join(assets, 'payload', name), 'owned ' + name);
  const manifest = { schema: 1, id: 'fh5-preview-v1', storeId: FH5_STORE_ID, version: '20261015', buildTag: 'cxpreview-20261015-rc1',
    files: Object.fromEntries(files.map(name => [name, hash('owned ' + name)])),
    engineFiles: Object.fromEntries(engineFiles.map(name => [name, hash('vendor ' + (name === providerAlias ? providerTarget : name))])), sourceLockSHA256: hash(source), loaderEntitlementsSHA256: hash(entitlements),
    preparedLoaderSHA256: hash('vendor lib/wine/x86_64-unix/wine' + ' signed fixture') };
  await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify(manifest));
  const installation = { root: engine, wine: path.join(engine, 'bin/wine'), wineserver: path.join(engine, 'bin/wineserver'), cxbottle: path.join(engine, 'bin/cxbottle'), version: '20261015' };
  const request = { enabled: true, storeId: FH5_STORE_ID, gameRoot: path.join(root, 'Original game'), dataRoot, engine: installation, runtime: { dir: '/selected runtime/dlls' }, log: vi.fn() };
  const execute = vi.fn(async (tool: string, args: string[]) => {
    if (tool.endsWith('/ditto')) {
      const [from, to] = args.slice(-2);
      await fs.cp(from, to, { recursive: true, verbatimSymlinks: true });
      const relative = 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-unix/wine';
      await fs.unlink(path.join(to, relative)); await fs.link(path.join(from, relative), path.join(to, relative));
    }
    if (tool.endsWith('/codesign') && args.includes('--entitlements')) {
      expect((await fs.stat(args[args.indexOf('--entitlements') + 1])).isFile()).toBe(true);
      expect(args[args.indexOf('--entitlements') + 1]).not.toContain('.asar/');
      await fs.appendFile(args.at(-1)!, ' signed fixture');
    }
    return { code: 0, output: '' };
  });
  const prepare = vi.fn(async (_engine, bottles: string) => {
    const prefix = path.join(bottles, 'xbox'); await fs.mkdir(path.join(prefix, 'drive_c/windows/system32'), { recursive: true });
    return { command: path.join(bottles, 'normal-runner'), compatibilityDataPath: prefix, stopPrefix: { command: '/stop-only-this-prefix', args: [] } };
  });
  const deps: FH5PackDeps = { assets, execute, prepare, compatibilityHome: path.join(root, 'absent vendor home'), host: async () => ({ platform: 'darwin', darwinMajor: 25, chip: 'Apple M5 Max' }) };
  return { root, app, engine, assets, manifest, request, deps, execute, prepare };
}
it('is inactive by default and rejects unrelated games without mutating their setup', async () => {
  const deps = { prepare: vi.fn() } as unknown as FH5PackDeps;
  expect(await prepareFH5PreviewPack({ enabled: false } as never, deps)).toBeUndefined();
  await expect(prepareFH5PreviewPack({ enabled: true, storeId: 'OTHER' } as never, deps)).rejects.toThrow('only for the FH5');
  expect(deps.prepare).not.toHaveBeenCalled();
});
it('prepares a relocated private engine/bottle without modifying a hard-linked vendor loader or original game', async () => {
  const f = await fixture();
  try {
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    expect(f.request.log).not.toHaveBeenCalledWith(expect.stringContaining('experimental and untested'));
    expect(pack.addonDiscoveryParent).toBe(FH5_STORE_ID);
    expect(pack.runner.compatibilityDataPath).toContain('compatibility-packs/fh5-preview-v1/');
    expect(pack.runner.launchCommand).not.toBe(pack.runner.command);
    expect(pack.runner.stopPrefix.command).toBe('/stop-only-this-prefix');
    const script = await fs.readFile(pack.runner.launchCommand!, 'utf8');
    expect(script).toContain('D3DM_MTL4='); expect(script).toContain('DYLD_INSERT_LIBRARIES='); expect(script).toContain('MACXUS_FH5_DESCRIPTOR_DATA=');
    expect(script).toContain("MACXUS_GPU_CLOCK_CALIBRATION='1'"); expect(script).toContain('macxus-clock=b');
    expect(script).toContain("MACXUS_FH5_NVAPI_PROFILE='1'");
    expect(script).toContain("MACXUS_FH5_NVAPI_MEMORY='1'");
    expect(script).toContain('CX_HOME=');
    expect(script).toContain("D3DM_DEVICE_DESCRIPTION='Apple M5 Max (D3DMetal)'");
    expect(script).toContain('unset D3DM_VENDOR_ID D3DM_DEVICE_ID');
    expect(script).not.toContain('NVIDIA GeForce RTX 4070');
    expect(script).not.toContain('.asar/'); expect(script).not.toContain('/Applications/'); expect(script).not.toContain('XODUS_BRIDGE_KEY'); expect(script).not.toContain('XODUS_BRIDGE_PORT');
    execFileSync('/bin/sh', ['-n', pack.runner.launchCommand!]);
    expect(await fs.readFile(path.join(f.engine, 'lib/wine/x86_64-unix/wine'), 'utf8')).toBe('vendor lib/wine/x86_64-unix/wine');
    expect(await fs.readFile(path.join(pack.runner.compatibilityDataPath, 'drive_c/windows/system32/xgameruntime.dll'), 'utf8')).toBe('owned xgameruntime.dll');
    expect(await fs.readFile(path.join(pack.runner.compatibilityDataPath, 'drive_c/windows/system32/macxus-clock.dll'), 'utf8')).toBe('owned macxus-clock.dll');
    expect(await fs.readFile(path.join(pack.runner.compatibilityDataPath, 'drive_c/windows/system32/nvapi64.dll'), 'utf8')).toBe('vendor lib/apple_gptk/wine/x86_64-windows/nvapi64.dll');
    const managed = path.dirname(path.dirname(pack.runner.compatibilityDataPath));
    expect(await fs.readFile(path.join(managed, 'native/clock-dlls/x86_64-windows/macxus-clock.dll'), 'utf8')).toBe('owned macxus-clock.dll');
    expect(await fs.readFile(path.join(managed, 'native/clock-dlls/x86_64-unix/macxus-clock.so'), 'utf8')).toBe('owned macxus-clock.so');
    expect(await fs.stat(f.request.gameRoot).catch(() => undefined)).toBeUndefined();
    const before = f.execute.mock.calls.length;
    await prepareFH5PreviewPack(f.request, f.deps);
    expect(f.execute.mock.calls.slice(before).some(([tool]) => tool.endsWith('/ditto'))).toBe(false);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

it.each(['Apple M3', 'Apple M3 Pro', 'Apple M3 Max', 'Apple M3 Ultra', 'Apple M4', 'Apple M4 Pro', 'Apple M4 Max', 'Apple M5', 'Apple M5 Pro', 'Apple M6', 'Apple M6 Max'])('allows %s only as an explicitly untested configuration', async chip => {
  const f = await fixture();
  try {
    f.deps.host = async () => ({ platform: 'darwin', darwinMajor: 25, chip });
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    expect(f.request.log).toHaveBeenCalledWith(expect.stringContaining('experimental and untested'));
    const script = await fs.readFile(pack.runner.launchCommand!, 'utf8');
    expect(script).toContain(`D3DM_DEVICE_DESCRIPTION='${chip} (D3DMetal)'`);
    expect(script).toContain("D3DM_MTL4='1'");
    expect(script).toContain("MACXUS_GPU_CLOCK_CALIBRATION='1'");
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
it.each([
  ['darwin', 25, 'Apple M1 Max'], ['darwin', 25, 'Apple M2 Ultra'],
  ['darwin', 24, 'Apple M3 Max'], ['darwin', NaN, 'Apple M3 Max'], ['linux', 25, 'Apple M3 Max'],
  ['darwin', 25, 'Intel Core i9'], ['darwin', 25, 'Apple M03'],
  ['darwin', 25, 'Apple M3 Max extra'], ['darwin', 25, 'Apple M3\n'],
] as const)('rejects ineligible host %s/%s/%s before changing files', async (platform, darwinMajor, chip) => {
  const f = await fixture();
  try {
    f.deps.host = async () => ({ platform, darwinMajor, chip });
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow('Apple M3 or newer');
    expect(f.execute).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
    expect(await fs.stat(f.request.dataRoot).catch(() => undefined)).toBeUndefined();
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

it('uses Preview IDs with MetalFX on and the accepted fallback off, clearing inherited identity values', async () => {
  const f = await fixture();
  try {
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    const engine = f.prepare.mock.calls[0][0] as { root: string };
    const native = path.join(engine.root, 'lib/wine/x86_64-unix/wine');
    await fs.writeFile(native, '#!/bin/sh\nprintf "%s|%s|%s" "${D3DM_VENDOR_ID-unset}" "${D3DM_DEVICE_ID-unset}" "$D3DM_DEVICE_DESCRIPTION"\n', { mode: 0o755 });
    await fs.chmod(native, 0o755);
    await fs.mkdir(path.join(engine.root, 'bin'), { recursive: true });
    await fs.writeFile(path.join(engine.root, 'bin/wineserver'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    // This fixture exercises shell environment selection, not native loading.
    // Hosted macOS can honor DYLD injection even for these shell stand-ins;
    // the fixture's text payload is deliberately not a compiled Mach-O dylib.
    // Keep the actual generated wrapper intact and disable only injection in
    // this test copy. The full wrapper/injection path has separate real probes.
    const script = await fs.readFile(pack.runner.launchCommand!, 'utf8');
    expect(script.match(/^export DYLD_INSERT_LIBRARIES=.*$/gm)).toHaveLength(1);
    const environmentOnly = path.join(path.dirname(pack.runner.launchCommand!), 'identity-environment-only');
    await fs.writeFile(environmentOnly, script.replace(/^export DYLD_INSERT_LIBRARIES=.*\n/m, ''), { mode: 0o755 });
    for (const [flag, expected] of [['1', 'unset|unset'], ['0', '0x10de|0x2786'], [undefined, '0x10de|0x2786']]) {
      const env = { ...process.env, DYLD_INSERT_LIBRARIES: '', D3DM_VENDOR_ID: 'foreign-vendor', D3DM_DEVICE_ID: 'foreign-device', D3DM_DEVICE_DESCRIPTION: 'foreign-name' };
      if (flag === undefined) delete env.D3DM_ENABLE_METALFX; else env.D3DM_ENABLE_METALFX = flag;
      expect(execFileSync(environmentOnly, [], { env, encoding: 'utf8' })).toBe(`${expected}|Apple M5 Max (D3DMetal)`);
    }
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
it('refuses linked calibration module caches without writing outside the pack', async () => {
  const f = await fixture();
  try {
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    const managed = path.dirname(path.dirname(pack.runner.compatibilityDataPath));
    const module = path.join(managed, 'native/clock-dlls/x86_64-unix/macxus-clock.so');
    const sentinel = path.join(f.root, 'outside'); await fs.writeFile(sentinel, 'preserve');
    await fs.unlink(module); await fs.symlink(sentinel, module);
    f.prepare.mockClear();
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow('Invalid FH5 pack file');
    expect(f.prepare).not.toHaveBeenCalled(); expect(await fs.readFile(sentinel, 'utf8')).toBe('preserve');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
it.each(['foreign-engine', 'wrong-build', 'bad-payload', 'linked-payload', 'bad-signature', 'unsupported-host'])('fails closed before prefix setup for %s', async kind => {
  const f = await fixture();
  try {
    if (kind === 'foreign-engine') f.request.engine.version = '20270101';
    if (kind === 'wrong-build') await fs.writeFile(path.join(f.engine, 'etc/CrossOver.conf'), '"BuildTag" = "other"\n');
    if (kind === 'bad-payload') await fs.appendFile(path.join(f.assets, 'payload/d3d12.dll'), 'tampered');
    if (kind === 'linked-payload') { const target = path.join(f.assets, 'payload/d3d12.dll'); await fs.rename(target, target + '.saved'); await fs.symlink(target + '.saved', target); }
    if (kind === 'bad-signature') f.execute.mockResolvedValue({ code: 1, output: 'private signing detail' });
    if (kind === 'unsupported-host') f.deps.host = async () => ({ platform: 'darwin', darwinMajor: 25, chip: 'Apple M1' });
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow();
    expect(f.prepare).not.toHaveBeenCalled();
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
it('refuses a damaged engine cache and linked bottle roots rather than overwriting an unknown setup', async () => {
  const f = await fixture();
  try {
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    const cached = f.prepare.mock.calls[0][0] as { root: string };
    const prefix = pack.runner.compatibilityDataPath, outside = path.join(f.root, 'other bottle'); await fs.mkdir(outside);
    await fs.rename(prefix, prefix + '.saved'); await fs.symlink(outside, prefix);
    f.prepare.mockClear();
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow(/must not be (links|symlinks)/);
    expect(f.prepare).not.toHaveBeenCalled(); expect(await fs.readdir(outside)).toEqual([]);
    await fs.unlink(prefix); await fs.rename(prefix + '.saved', prefix);
    await fs.appendFile(path.join(cached.root, 'lib/wine/x86_64-unix/wine'), 'tampered');
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow('checksum mismatch');
    expect(f.prepare).not.toHaveBeenCalled();
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

it('rejects linked registry files before vendor prefix updates', async () => {
  const f = await fixture();
  try {
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    const outside = path.join(f.root, 'other-registry'); await fs.writeFile(outside, 'unrelated');
    await fs.symlink(outside, path.join(pack.runner.compatibilityDataPath, 'system.reg'));
    f.prepare.mockClear();
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow(/must not be (links|symlinks)/);
    expect(f.prepare).not.toHaveBeenCalled(); expect(await fs.readFile(outside, 'utf8')).toBe('unrelated');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

it.each(['nvapi64.dll', `nvapi64.dll.fh5-${process.pid}`])('rejects linked NVAPI setup destination %s before vendor preparation', async name => {
  const f = await fixture();
  try {
    const pack = (await prepareFH5PreviewPack(f.request, f.deps))!;
    const outside = path.join(f.root, 'outside-nvapi'); await fs.writeFile(outside, 'preserve');
    const destination = path.join(pack.runner.compatibilityDataPath, 'drive_c/windows/system32', name);
    await fs.unlink(destination).catch(() => undefined); await fs.symlink(outside, destination);
    f.prepare.mockClear();
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow('NVAPI setup files');
    expect(f.prepare).not.toHaveBeenCalled(); expect(await fs.readFile(outside, 'utf8')).toBe('preserve');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

it.each(['absolute-alias', 'different-relative-alias', 'linked-target-parent', 'other-engine-link', 'cached-alias'])('rejects %s even with matching provider bytes', async kind => {
  const f = await fixture();
  try {
    let engine = f.engine;
    if (kind === 'cached-alias') {
      await prepareFH5PreviewPack(f.request, f.deps);
      engine = (f.prepare.mock.calls[0][0] as { root: string }).root;
      f.prepare.mockClear();
    }
    const alias = path.join(engine, 'lib/apple_gptk/wine/x86_64-unix/nvapi64.so');
    const target = path.join(engine, 'lib/apple_gptk/external/libd3dshared.dylib');
    const outside = path.join(f.root, 'outside-provider'); await fs.copyFile(target, outside);
    if (kind === 'absolute-alias' || kind === 'cached-alias') {
      await fs.unlink(alias); await fs.symlink(outside, alias);
    } else if (kind === 'different-relative-alias') {
      const other = path.join(path.dirname(target), 'other.dylib'); await fs.copyFile(target, other);
      await fs.unlink(alias); await fs.symlink('../../external/other.dylib', alias);
    } else if (kind === 'linked-target-parent') {
      const parent = path.dirname(target); await fs.rename(parent, parent + '-saved'); await fs.symlink(parent + '-saved', parent);
    } else {
      const file = path.join(engine, 'lib/wine/x86_64-unix/ntdll.so');
      await fs.rename(file, file + '.saved'); await fs.symlink(file + '.saved', file);
    }
    await expect(prepareFH5PreviewPack(f.request, f.deps)).rejects.toThrow(/alias|plain|links|Invalid FH5 pack file/);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(await fs.readFile(outside, 'utf8')).toBe('vendor lib/apple_gptk/external/libd3dshared.dylib');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
