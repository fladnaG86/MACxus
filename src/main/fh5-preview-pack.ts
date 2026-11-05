import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { release, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { shellQuote, type CrossOverInstall, type RuntimeDllSource } from './crossover.js';
import { run, type RunResult } from './process.js';
import { validateCompatibilityPrefix } from './compatibility-prefix.js';
import type { ProtonRunner } from './proton.js';
import { prepareFH5CompatHome } from './fh5-compat-home.js';

import { FH5_STORE_ID } from '../shared/launch-tools.js';
export { FH5_STORE_ID } from '../shared/launch-tools.js';
const assetRoot = fileURLToPath(new URL('../../assets/fh5-preview', import.meta.url));
const payloadNames = ['d3d12.dll', 'macxus-metal4-timestamps.dylib', 'windows.web.dll', 'xgameruntime.dll', 'macxus-clock.dll', 'macxus-clock.so'];
const engineNames = ['lib/apple_gptk/external/D3DMetal.framework/Versions/A/D3DMetal', 'lib/apple_gptk/external/D3DMetal.framework/Versions/A/Resources/libmetalirconverter.dylib', 'lib/apple_gptk/external/libd3dshared.dylib', 'lib/apple_gptk/wine/x86_64-windows/d3d12core.dll', 'lib/apple_gptk/wine/x86_64-windows/d3d12.dll', 'lib/apple_gptk/wine/x86_64-windows/nvapi64.dll', 'lib/apple_gptk/wine/x86_64-unix/nvapi64.so', 'lib/wine/x86_64-unix/ntdll.so', 'lib/wine/x86_64-unix/wine'];
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
interface Manifest {
  schema: 1; id: 'fh5-preview-v1'; storeId: string; version: string; buildTag: string;
  files: Record<string, string>; engineFiles: Record<string, string>; sourceLockSHA256: string; loaderEntitlementsSHA256: string; preparedLoaderSHA256: string;
}
export interface FH5PackDeps {
  assets: string;
  execute: (tool: string, args: string[]) => Promise<RunResult>;
  host?: () => Promise<{ platform: string; darwinMajor: number; chip: string }>;
  compatibilityHome?: string;
  prepare: (engine: CrossOverInstall, bottles: string, runtime: RuntimeDllSource, log: (line: string) => void, architecture?: 'win64' | 'arm64') => Promise<ProtonRunner>;
}
interface Request {
  enabled: boolean; storeId?: string; gameRoot?: string; dataRoot: string; engine?: CrossOverInstall;
  runtime: RuntimeDllSource; log: (line: string) => void;
}
const pending = new Map<string, Promise<CrossOverInstall>>();
const complete = (value: Record<string, string>, names: string[]) => value && Object.keys(value).sort().join() === [...names].sort().join() && Object.values(value).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash));
async function plainDirectory(root: string, ...parts: string[]): Promise<void> {
  let current = root;
  for (const part of ['', ...parts]) {
    current = path.join(current, part); const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('FH5 pack directories must not be links.');
  }
}
async function directory(root: string, ...parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    await fs.mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    await plainDirectory(current);
  }
  return current;
}
async function verified(file: string, expected: string, maximum = 64 * 1024 * 1024): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error(`Invalid FH5 pack file: ${path.basename(file)}.`);
  const bytes = await fs.readFile(file);
  if (digest(bytes) !== expected) throw Error(`FH5 pack checksum mismatch: ${path.basename(file)}.`);
  return bytes;
}
async function verifiedEngineFile(root: string, name: string, expected: string): Promise<Buffer> {
  const file = path.join(root, name);
  // The pinned Preview engine aliases this Unix provider to its shared bridge.
  // Accept only its exact relative target, with plain in-engine parent paths
  // and the same content hash. Other engine files and pack payloads stay plain.
  if (name === 'lib/apple_gptk/wine/x86_64-unix/nvapi64.so' && (await fs.lstat(file)).isSymbolicLink()) {
    if (await fs.readlink(file) !== '../../external/libd3dshared.dylib') throw Error('Invalid FH5 NVAPI provider alias.');
    await plainDirectory(root, 'lib', 'apple_gptk', 'wine', 'x86_64-unix');
    await plainDirectory(root, 'lib', 'apple_gptk', 'external');
    return verified(path.join(root, 'lib/apple_gptk/external/libd3dshared.dylib'), expected, 256 * 1024 * 1024);
  }
  return verified(file, expected, 256 * 1024 * 1024);
}
async function command(deps: FH5PackDeps, executable: string, args: string[]): Promise<void> {
  const result = await deps.execute(executable, args);
  if (result.code !== 0) throw Error(`FH5 private-engine preparation failed: ${path.basename(executable)}.`);
}
function installation(original: CrossOverInstall, app: string): CrossOverInstall {
  const root = path.join(app, 'Contents/SharedSupport/CrossOver');
  return { ...original, root, wine: path.join(root, 'bin/wine'), wineserver: path.join(root, 'bin/wineserver'), cxbottle: path.join(root, 'bin/cxbottle') };
}
async function prepareEngine(original: CrossOverInstall, root: string, manifest: Manifest, deps: FH5PackDeps, entitlements: Buffer): Promise<CrossOverInstall> {
  const app = path.join(root, 'MACxus FH5 Preview.app');
  const validate = async (target: string) => {
    await plainDirectory(target, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-unix');
    const engine = installation(original, target);
    for (const name of engineNames.filter(name => !name.endsWith('/wine'))) await verifiedEngineFile(engine.root, name, manifest.engineFiles[name]);
    const receipt = JSON.parse(await fs.readFile(path.join(target, 'Contents/Resources/macxus-fh5-loader.json'), 'utf8')) as { loader?: string; manifest?: string };
    if (receipt.manifest !== digest(Buffer.from(JSON.stringify(manifest))) || receipt.loader !== manifest.preparedLoaderSHA256) throw Error('FH5 private-engine receipt mismatch.');
    await verified(path.join(engine.root, 'lib/wine/x86_64-unix/wine'), receipt.loader!);
    await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
    return engine;
  };
  let exists = true;
  try { await fs.lstat(app); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
  if (exists) return validate(app);
  const sourceApp = path.resolve(original.root, '../../..');
  if (!sourceApp.endsWith('.app')) throw Error('FH5 requires an installed Preview application bundle.');
  await plainDirectory(sourceApp);
  await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--ignore-resources', sourceApp]);
  const staging = await fs.mkdtemp(path.join(root, '.prepare-'));
  const copy = path.join(staging, 'MACxus FH5 Preview.app');
  try {
    await command(deps, '/usr/bin/ditto', ['--noqtn', '--noextattr', '--norsrc', sourceApp, copy]);
    await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--strict', copy]);
    const engine = installation(original, copy);
    await plainDirectory(copy, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-unix');
    const loader = path.join(engine.root, 'lib/wine/x86_64-unix/wine');
    const bytes = await verified(loader, manifest.engineFiles['lib/wine/x86_64-unix/wine']);
    // Break a possible hard link before signing the private loader. Every
    // installed engine file remains unchanged, including its vendor signature.
    await fs.unlink(loader); await fs.writeFile(loader, bytes, { mode: 0o755, flag: 'wx' });
    const signingEntitlements = path.join(staging, 'loader-entitlements.plist');
    await fs.writeFile(signingEntitlements, entitlements, { flag: 'wx', mode: 0o600 });
    await command(deps, '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--identifier', 'io.macxus.fh5-wine-loader', '--entitlements', signingEntitlements, loader]);
    const signed = digest(await fs.readFile(loader));
    if (signed !== manifest.preparedLoaderSHA256) throw Error('Prepared FH5 loader does not match the pinned signing recipe.');
    const resources = await directory(copy, 'Contents', 'Resources');
    await fs.writeFile(path.join(resources, 'macxus-fh5-loader.json'), JSON.stringify({ loader: signed, manifest: digest(Buffer.from(JSON.stringify(manifest))) }), { flag: 'wx', mode: 0o600 });
    await command(deps, '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', copy]);
    await validate(copy); await fs.rename(copy, app);
    return installation(original, app);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
/** Explicit opt-in only: dedicated engine/bottle, guarded FH5 allocator and
 * source-locked runtime. This function never starts a game or account service. */
export async function prepareFH5PreviewPack(request: Request, deps: FH5PackDeps) {
  if (!request.enabled) return undefined;
  if (request.storeId?.toUpperCase() !== FH5_STORE_ID || !request.gameRoot) throw Error('The FH5 Preview pack is available only for the FH5 Store package.');
  const host = deps.host ? await deps.host() : { platform: process.platform, darwinMajor: Number.parseInt(release(), 10), chip: (await deps.execute('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'])).output.trim() };
  // M3 introduced hardware ray tracing; Apple's feature tables place the Metal 4
  // command/counter APIs used here below that generation. Only M5 Max has game
  // acceptance: allow other M3+ models as experimental, with native checks retained.
  const chip = /^Apple M([1-9]\d*)(?: (?:Pro|Max|Ultra))?$/.exec(host.chip);
  if (host.platform !== 'darwin' || !Number.isInteger(host.darwinMajor) || host.darwinMajor < 25 || !chip || chip[0] !== host.chip || Number(chip[1]) < 3) throw Error('This FH5 pack requires an Apple M3 or newer Mac on macOS 26 or newer. Only M5 Max has been game-tested.');
  if (host.chip !== 'Apple M5 Max') request.log('Warning: FH5 Preview compatibility pack is experimental and untested on this Mac. Only Apple M5 Max has been game-tested; startup, rendering and GPU timing may fail.');
  const original = request.engine;
  if (!original || original.supportsArm64 || original.version !== '20261015') throw Error('The FH5 pack requires CrossOver Preview Rosetta 20261015.');
  const manifest = JSON.parse(await fs.readFile(path.join(deps.assets, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.schema !== 1 || manifest.id !== 'fh5-preview-v1' || manifest.storeId !== FH5_STORE_ID || manifest.version !== original.version || manifest.buildTag !== 'cxpreview-20261015-rc1' ||
      !complete(manifest.files, payloadNames) || !complete(manifest.engineFiles, engineNames) || ![manifest.sourceLockSHA256, manifest.loaderEntitlementsSHA256, manifest.preparedLoaderSHA256].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) throw Error('Invalid FH5 pack manifest.');
  const configuration = await fs.readFile(path.join(original.root, 'etc/CrossOver.conf'), 'utf8');
  if (!configuration.split(/\r?\n/).some(line => line.trim() === `"BuildTag" = "${manifest.buildTag}"`)) throw Error('Unsupported FH5 Preview build.');
  await verified(path.join(deps.assets, 'source.lock.json'), manifest.sourceLockSHA256);
  const entitlements = await verified(path.join(deps.assets, 'loader-entitlements.plist'), manifest.loaderEntitlementsSHA256);
  for (const [name, hash] of Object.entries(manifest.engineFiles)) await verifiedEngineFile(original.root, name, hash);
  const payload = new Map<string, Buffer>();
  for (const [name, hash] of Object.entries(manifest.files)) {
    try { payload.set(name, await verified(path.join(deps.assets, 'payload', name), hash)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('This application build does not include the FH5 compatibility pack payload.'); throw error; }
  }
  await fs.mkdir(request.dataRoot, { recursive: true }); await plainDirectory(request.dataRoot);
  const managed = await directory(request.dataRoot, 'compatibility-packs', 'fh5-preview-v1');
  const root = await directory(managed, digest(Buffer.from(JSON.stringify(manifest))).slice(0, 24));
  const key = path.resolve(root);
  let preparation = pending.get(key);
  if (!preparation) { preparation = prepareEngine(original, root, manifest, deps, entitlements); pending.set(key, preparation); }
  let engine: CrossOverInstall;
  try { engine = await preparation; } finally { if (pending.get(key) === preparation) pending.delete(key); }
  // DYLD/codesign cannot read Electron's virtual ASAR paths. Materialize only
  // verified owned bytes under this managed pack before native tools use them.
  const nativeRoot = await directory(root, 'native');
  const nativeBridge = path.join(nativeRoot, 'macxus-metal4-timestamps.dylib');
  try { await verified(nativeBridge, manifest.files['macxus-metal4-timestamps.dylib']); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const temporary = nativeBridge + '.tmp-' + process.pid;
    await fs.writeFile(temporary, payload.get('macxus-metal4-timestamps.dylib')!, { flag: 'wx', mode: 0o755 });
    try { await fs.rename(temporary, nativeBridge); } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  const clockDlls = await directory(nativeRoot, 'clock-dlls');
  for (const [architecture, name] of [['x86_64-windows', 'macxus-clock.dll'], ['x86_64-unix', 'macxus-clock.so']]) {
    const destination = path.join(await directory(clockDlls, architecture), name);
    try { await verified(destination, manifest.files[name]); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const temporary = destination + '.tmp-' + process.pid;
      await fs.writeFile(temporary, payload.get(name)!, { flag: 'wx', mode: 0o644 });
      try { await fs.rename(temporary, destination); } finally { await fs.unlink(temporary).catch(() => undefined); }
    }
  }
  const bottles = await directory(root, 'bottles');
  // Validate any existing setup paths before the vendor runner can update them.
  const prefix = path.join(bottles, 'xbox');
  await validateCompatibilityPrefix(prefix, bottles);
  const nvapiTarget = path.join(prefix, 'drive_c/windows/system32/nvapi64.dll');
  const validateNvapiTarget = async () => {
    for (const file of [nvapiTarget, nvapiTarget + '.fh5-' + process.pid]) {
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('FH5 NVAPI setup files must not be links.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
  await validateNvapiTarget();
  const runner = await deps.prepare(engine, bottles, request.runtime, request.log, 'win64');
  if (path.resolve(runner.compatibilityDataPath) !== prefix) throw Error('FH5 requires its dedicated bottle.');
  await validateCompatibilityPrefix(prefix, bottles);
  await validateNvapiTarget();
  await plainDirectory(prefix, 'drive_c', 'windows', 'system32');
  // Wine normally installs a tiny builtin placeholder. Materialize the verified
  // vendor PE so the shim can identify the loaded provider by its actual bytes.
  // These bytes come from the selected engine; they are not shipped in our pack.
  payload.set('nvapi64.dll', await verified(path.join(engine.root, 'lib/apple_gptk/wine/x86_64-windows/nvapi64.dll'),
    manifest.engineFiles['lib/apple_gptk/wine/x86_64-windows/nvapi64.dll']));
  for (const name of ['d3d12.dll', 'xgameruntime.dll', 'windows.web.dll', 'macxus-clock.dll', 'nvapi64.dll']) {
    const target = path.join(prefix, 'drive_c/windows/system32', name), temporary = target + '.fh5-' + process.pid;
    await fs.writeFile(temporary, payload.get(name)!, { flag: 'wx', mode: 0o644 });
    try { await fs.rename(temporary, target); } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  const logs = await directory(root, 'logs');
  const log = await fs.mkdtemp(path.join(logs, 'session-'));
  // Preview's CXUtils removes " Preview" from the product's cellar ID.
  // Its normal Perl launcher sets CX_HOME; our direct native loader must too.
  const compatibility = await prepareFH5CompatHome(deps.compatibilityHome ?? path.join(homedir(), 'Library/Application Support/CrossOver'), await directory(root, 'compat-homes'));
  request.log(compatibility.pairs ? `FH5 copied ${compatibility.pairs} signed compatibility database pairs; Preview will verify their signatures.` : 'FH5 found no signed compatibility database cache; vendor title rules may be unavailable.');
  const native = path.join(engine.root, 'lib/wine/x86_64-unix/wine');
  const environment = {
    CX_BOTTLE_PATH: bottles, CX_BOTTLE: 'xbox', WINEPREFIX: prefix, CX_ROOT: engine.root, CX_HOME: compatibility.home,
    WINELOADER: native, WINESERVER: engine.wineserver, CX_GRAPHICS_BACKEND: 'd3dmetal', CX_ACTIVE_GRAPHICS_BACKEND: 'd3dmetal',
    CX_D3DMETALPATH: path.join(engine.root, 'lib/apple_gptk/external'),
    WINEDLLPATH: [clockDlls, path.join(engine.root, 'lib/apple_gptk/wine/x86_64-windows'), path.join(engine.root, 'lib/apple_gptk/wine'), path.join(engine.root, 'lib/wine/x86_64-windows'), path.join(engine.root, 'lib/wine')].join(':'),
    DYLD_FALLBACK_LIBRARY_PATH: [path.join(engine.root, 'lib/apple_gptk/external'), path.join(engine.root, 'lib')].join(':'),
    DYLD_INSERT_LIBRARIES: nativeBridge,
    MACXUS_GPU_BRIDGE_LOG: path.join(log, 'timestamps'), MACXUS_GPU_BRIDGE_PER_PROCESS: '1',
    MACXUS_GPU_QUERY_COOKIE: randomBytes(8).toString('hex'),
    D3DM_MTL4: '1', MACXUS_PROCESS_OBSERVER: '1', MACXUS_TIMESTAMP_ONLY: '1', MACXUS_APPEND_ONLY: '1', MACXUS_FH5_UNUSED_BLEND: '1',
    MACXUS_GPU_CLOCK_CALIBRATION: '1',
    MACXUS_FH5_DESCRIPTOR_DATA: '1', MACXUS_DUAL_UDP_TTL: '1', MACXUS_COMMIT_ACCOUNTING: '1', MACXUS_FH5_NVAPI_PROFILE: '1', MACXUS_FH5_NVAPI_MEMORY: '1', HB_TSSHIM_DEBUG: '0',
    D3DM_DEVICE_DESCRIPTION: `${host.chip} (D3DMetal)`,
    HB_D3D12_REAL: 'Z:' + path.join(engine.root, 'lib/apple_gptk/wine/x86_64-windows/d3d12.dll').replaceAll('/', '\\'),
    XODUS_CONTENT_PACKAGE_ROOT: 'Z:' + path.resolve(request.gameRoot).replaceAll('/', '\\'),
  };
  const wrapper = path.join(bottles, 'fh5-game-wine');
  const temporary = wrapper + '.tmp-' + process.pid;
  await fs.writeFile(temporary, '#!/bin/sh\n' + Object.entries(environment).map(([name, value]) => `export ${name}=${shellQuote(value)}`).join('\n') +
    // Preview's MetalFX/DLSS mode supplies its own compatibility IDs. Preserve
    // the accepted fallback when it is off: default AMD IDs previously faulted
    // in FH5's AGS startup path. Never let inherited IDs contaminate this test.
    '\nif [ "${D3DM_ENABLE_METALFX:-0}" = "1" ]; then\n  unset D3DM_VENDOR_ID D3DM_DEVICE_ID\nelse\n  export D3DM_VENDOR_ID=0x10de D3DM_DEVICE_ID=0x2786\nfi\n' +
    '\nexport WINEDLLOVERRIDES="d3d12=n,b;macxus-clock=b;${WINEDLLOVERRIDES:-}"\n' + `launch_status=0\n${shellQuote(native)} "$@" || launch_status=$?\n${shellQuote(engine.wineserver)} -w\nexit "$launch_status"\n`, { flag: 'wx', mode: 0o700 });
  await fs.rename(temporary, wrapper);
  request.log('FH5 Preview pack enabled in its dedicated bottle; Metal 4 and guarded runtime fixes active.');
  return { runner: { ...runner, launchCommand: wrapper }, addonDiscoveryParent: FH5_STORE_ID };
}
export const defaultFH5Assets = assetRoot;
export const defaultFH5Execute = run;
