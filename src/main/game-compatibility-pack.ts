import { validateCompatibilityPrefix } from './compatibility-prefix.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CrossOverInstall } from './crossover.js';
import { run, type RunResult } from './process.js';

import { parseCompatibilityCatalog, parseCompatibilityManifest, configurationPath, type CompatibilityManifest as Manifest } from '../shared/compatibility-pack-schema.mjs';

const ASSET_ROOT = fileURLToPath(new URL('../../assets/compatibility-packs/', import.meta.url));
const pending = new Map<string, Promise<CrossOverInstall>>();

export interface CompatibilityPackRequest {
  storeId?: string; engine: string; installation: CrossOverInstall; dataRoot: string;
  log: (line: string) => void;
}
export interface CompatibilityPack {
  installation: CrossOverInstall;
  bottlesRoot: string;
  environment: Record<string, string>;
  validatePrefix: (prefix: string) => Promise<void>;
  configurePrefix: (prefix: string) => Promise<void>;
}
export interface CompatibilityPackDeps {
  assetRoot: string;
  execute: (command: string, args: string[]) => Promise<RunResult>;
}
const defaultDeps: CompatibilityPackDeps = { assetRoot: ASSET_ROOT, execute: run };

async function plainDirectories(root: string, ...parts: string[]): Promise<void> {
  let current = root;
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Compatibility engine directories must not be symlinks.');
  }
}

async function directory(root: string, ...parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    await fs.mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Compatibility pack directories must not be symlinks.');
  }
  return current;
}
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function verifiedFile(file: string, expected: string): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw Error(`Invalid compatibility component: ${path.basename(file)}.`);
  const data = await fs.readFile(file);
  if (sha256(data) !== expected) throw Error(`Compatibility component checksum mismatch: ${path.basename(file)}.`);
  return data;
}
async function command(deps: CompatibilityPackDeps, name: string, args: string[]): Promise<void> {
  const result = await deps.execute(name, args);
  if (result.code !== 0) throw Error(`Game compatibility engine preparation failed (${path.basename(name)}): ${result.output.trim().slice(-500)}`);
}
function engineAt(installation: CrossOverInstall, app: string): CrossOverInstall {
  const root = path.join(app, 'Contents/SharedSupport/CrossOver');
  return { ...installation, root, wine: path.join(root, 'bin/wine'), wineserver: path.join(root, 'bin', path.basename(installation.wineserver)), cxbottle: path.join(root, 'bin/cxbottle') };
}
async function validateEngine(app: string, manifest: Manifest, deps: CompatibilityPackDeps): Promise<void> {
  const stat = await fs.lstat(app);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid compatibility engine directory.');
  await plainDirectories(app, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-windows');
  await plainDirectories(app, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-unix');
  const wine = path.join(app, 'Contents/SharedSupport/CrossOver/lib/wine');
  for (const name of Object.keys(manifest.dlls)) await verifiedFile(path.join(wine, 'x86_64-windows', name), manifest.dlls[name]);
  for (const [name, expected] of Object.entries(manifest.unixLibraries)) await verifiedFile(path.join(wine, 'x86_64-unix', name), expected);
  await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
}
async function prepareEngine(request: CompatibilityPackRequest, manifest: Manifest, payload: Map<string, Buffer>, root: string, deps: CompatibilityPackDeps): Promise<CrossOverInstall> {
  const app = path.join(root, manifest.appName);
  let exists = true;
  try {
    await fs.lstat(app);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
  if (exists) {
    // A damaged cache is an error, never permission to overwrite an unknown app.
    await validateEngine(app, manifest, deps);
    return engineAt(request.installation, app);
  }
  request.log(`Preparing ${manifest.name} engine…`);
  const original = path.resolve(request.installation.root, '../../..');
  if (!original.endsWith('.app')) throw Error('Game compatibility requires a CrossOver application bundle.');
  await plainDirectories(original);
  // The installed copy may have harmless Finder metadata. Its code is checked
  // here; the metadata-free copy must also pass the original vendor resource
  // seal below, before any component is changed or a new seal is created.
  await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--ignore-resources', original]);
  const staging = await fs.mkdtemp(path.join(root, '.prepare-'));
  const staged = path.join(staging, manifest.appName);
  try {
    await command(deps, '/usr/bin/ditto', ['--noqtn', '--noextattr', '--norsrc', original, staged]);
    await plainDirectories(staged, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-windows');
    await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    for (const name of Object.keys(manifest.dlls)) {
      const target = path.join(staged, 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows', name);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unexpected compatibility DLL destination.');
      // Never modify a hard-linked copy of the installed engine.
      await fs.unlink(target);
      await fs.writeFile(target, payload.get(name)!, { flag: 'wx', mode: 0o644 });
    }
    const plist = path.join(staged, 'Contents/Info.plist');
    const plistBytes = await fs.readFile(plist);
    const plistStat = await fs.lstat(plist);
    if (!plistStat.isFile() || plistStat.isSymbolicLink()) throw Error('Invalid compatibility engine property list.');
    await fs.unlink(plist);
    await fs.writeFile(plist, plistBytes, { flag: 'wx', mode: 0o644 });
    for (const [key, value] of [['CFBundleIdentifier', `io.macxus.compat.${manifest.id}`], ['CFBundleName', manifest.appName.slice(0, -4)]]) {
      await command(deps, '/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
    }
    await command(deps, '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', staged]);
    await validateEngine(staged, manifest, deps);
    await fs.rename(staged, app);
    return engineAt(request.installation, app);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

/** Only the selected Store ID and exact Rosetta build may activate an overlay.
 * Unrelated manifests are never loaded; corrupt selected metadata fails closed. */
export async function prepareGameCompatibilityPack(request: CompatibilityPackRequest, deps: CompatibilityPackDeps = defaultDeps): Promise<CompatibilityPack | undefined> {
  if (!request.storeId || !['crossover', 'crossover-preview'].includes(request.engine) || request.installation.supportsArm64) return undefined;
  const catalog = parseCompatibilityCatalog(JSON.parse(await fs.readFile(path.join(deps.assetRoot, 'catalog.json'), 'utf8')));
  const routes = catalog.packs.filter(entry => entry.storeId === request.storeId!.toUpperCase() && entry.engine === request.engine);
  const candidates = routes.filter(entry => entry.version === request.installation.version);
  if (!candidates.length) {
    if (routes.length) request.log('No compatibility pack matches this engine version; using the selected engine.');
    return undefined;
  }
  const cx = request.installation;
  const config = await fs.readFile(path.join(cx.root, 'etc/CrossOver.conf'), 'utf8');
  const matching = candidates.filter(entry => config.split(/\r?\n/).some(line => line.trim() === `"BuildTag" = "${entry.buildTag}"`));
  if (!matching.length) {
    request.log('No compatibility pack matches this engine build; using the selected engine.');
    return undefined;
  }
  if (matching.length !== 1) throw Error('Ambiguous compatibility pack engine build.');
  const entry = matching[0], assetRoot = path.join(deps.assetRoot, entry.id);
  const manifest = parseCompatibilityManifest(JSON.parse(await fs.readFile(path.join(assetRoot, 'manifest.json'), 'utf8')), entry);
  for (const name of Object.keys(manifest.dlls)) await verifiedFile(path.join(cx.root, 'lib/wine/x86_64-windows', name), manifest.originalDLLs[name]);
  for (const [name, expected] of Object.entries(manifest.unixLibraries)) await verifiedFile(path.join(cx.root, 'lib/wine/x86_64-unix', name), expected);
  const payload = new Map<string, Buffer>();
  for (const name of Object.keys(manifest.dlls)) {
    try { payload.set(name, await verifiedFile(path.join(assetRoot, 'payload', name), manifest.dlls[name])); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      request.log(`${manifest.name} payload is unavailable in this build; using the selected engine.`);
      return undefined;
    }
  }
  await fs.mkdir(request.dataRoot, { recursive: true });
  const managed = await directory(request.dataRoot, 'compatibility-packs');
  const root = await directory(managed, manifest.id);
  // Copies sealed by the older implementation did not prove the vendor's
  // resource integrity. Ignore those copies, retaining the same game bottle.
  const engineRoot = await directory(root, manifest.engineDirectory);
  const key = path.resolve(engineRoot);
  let installation = pending.get(key);
  if (!installation) {
    installation = prepareEngine(request, manifest, payload, engineRoot, deps);
    pending.set(key, installation);
  }
  let prepared: CrossOverInstall;
  try { prepared = await installation; } finally { if (pending.get(key) === installation) pending.delete(key); }
  const bottlesRoot = await directory(root, 'bottles');
  const validatePrefix = async (prefix: string) => {
    if (path.resolve(prefix) !== path.join(bottlesRoot, 'xbox')) throw Error('Game compatibility settings require the dedicated bottle.');
    await plainDirectories(request.dataRoot, 'compatibility-packs', manifest.id, 'bottles');
    await validateCompatibilityPrefix(prefix, bottlesRoot, manifest.configuration);
  };
  request.log(`${manifest.name} pack enabled for this game only.`);
  return {
    installation: prepared, bottlesRoot, environment: { ...manifest.environment }, validatePrefix,
    configurePrefix: async prefix => {
      await validatePrefix(prefix);
      const stat = await fs.lstat(prefix);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid game compatibility bottle.');
      for (const action of manifest.configuration) {
        const dir = await directory(prefix, ...configurationPath(action).split('/'));
        const ini = path.join(dir, action.file);
        let before = '';
        try {
          const stat = await fs.lstat(ini);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw Error(`Invalid compatibility ${action.file}.`);
          before = await fs.readFile(ini, 'utf8');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const after = updateIniSettings(before, action.section, action.values);
        if (after !== before) {
          const temp = await fs.mkdtemp(path.join(dir, '.compat-ini-'));
          try {
            const file = path.join(temp, action.file);
            await fs.writeFile(file, after, { flag: 'wx', mode: action.readOnly ? 0o444 : 0o644 });
            await fs.rename(file, ini);
          } finally { await fs.rm(temp, { recursive: true, force: true }); }
        }
        await fs.chmod(ini, action.readOnly ? 0o444 : 0o644);
      }
    },
  };
}

/** Replace only the declared keys in the selected section, including duplicate
 * sections. Other sections/settings survive, and repeated application is stable. */
export function updateIniSettings(text: string, sectionName: string, values: Record<string, string>): string {
  const settings = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  const keys = new Set(Object.keys(values).map(key => key.toLowerCase()));
  const output: string[] = []; let selected = false, found = false;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      selected = section[1].toLowerCase() === sectionName.toLowerCase();
      output.push(line);
      if (selected && !found) { output.push(...settings); found = true; }
    } else {
      const key = line.match(/^\s*([^=]+?)\s*=/)?.[1].toLowerCase();
      if (!selected || !key || !keys.has(key)) output.push(line);
    }
  }
  if (!found) output.push('', `[${sectionName}]`, ...settings);
  return output.join('\n').replace(/\n*$/, '\n');
}
