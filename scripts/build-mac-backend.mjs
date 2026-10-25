// Build an account-free, pinned Apple Silicon backend for the app bundle.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { backendLock as lock, backendRecipeSha256 } from '../dist-electron/main/backend-package.js';
import { MAC_BACKEND_FILES, readBundledBackend } from '../dist-electron/main/bundled-backend.js';
import { resolveMacSigningIdentity, signMacBackend, verifyMacBackendSigning } from './mac-backend-signing.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Build the bundled backend on an Apple Silicon Mac.');
const root = fileURLToPath(new URL('../', import.meta.url));
const checkOnly = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Usage: build-mac-backend.mjs [--check]');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const buildRecipeSha256 = sha(Buffer.concat([await fs.readFile(fileURLToPath(import.meta.url)), await fs.readFile(new URL('./mac-backend-signing.mjs', import.meta.url))]));
const signingIdentity = checkOnly ? null : resolveMacSigningIdentity(process.env.MACXUS_SIGNING_IDENTITY);
const output = path.join(root, 'bundled/mac-backend');
if (!checkOnly) {
  try {
    const current = await readBundledBackend(output, 'arm64');
    if (current.manifest.buildRecipeSha256 !== buildRecipeSha256) throw Error('The cached backend has an older build recipe. Remove the generated bundled/mac-backend directory and rebuild.');
    if (current.manifest.signingIdentity !== signingIdentity) throw Error('The cached backend uses another signing identity. Remove the generated bundled/mac-backend directory and rebuild.');
    verifyMacBackendSigning(output, signingIdentity);
    console.log('Reusing the verified backend built from the current pinned recipe.');
    process.exit(0);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const work = path.join(root, 'work', 'mac-backend-' + randomUUID());
const source = path.join(work, 'source');
const target = path.join(root, 'work/mac-backend-target');
const env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4', MACOSX_DEPLOYMENT_TARGET: '13.0' };
const command = (tool, args, capture = false, cwd = source) => execFileSync(tool, args, { cwd, env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 });
const cargo = args => command('rustup', ['run', lock.rust, 'cargo', ...args]);
const rustc = command('rustup', ['run', lock.rust, 'rustc', '--version'], true, root).trim();
if (!rustc.startsWith(`rustc ${lock.rust} `)) throw Error('Use the Rust version in backend-source.lock.json.');
for (const patch of lock.patches) {
  if (!/^xodus-[a-z-]+\.patch$/.test(patch.file) || sha(await fs.readFile(path.join(root, 'assets', patch.file))) !== patch.sha256) throw Error('Backend patch checksum mismatch.');
}
await fs.mkdir(work, { recursive: true });
command('git', ['clone', '--no-checkout', lock.repository, source], false, root);
command('git', ['checkout', '--detach', lock.commit]);
if (command('git', ['rev-parse', 'HEAD'], true).trim() !== lock.commit || sha(await fs.readFile(path.join(source, 'Cargo.lock'))) !== lock.cargoLockSha256) throw Error('Backend source lock mismatch.');
for (const patch of lock.patches) {
  const file = path.join(root, 'assets', patch.file);
  command('git', ['apply', '--check', file]); command('git', ['apply', file]);
}
const features = ['--locked', '--release', '--no-default-features'];
// Upstream's ambiguity/security fixtures require two names differing only in
// case. Run them on a disposable APFSX image instead of skipping those checks
// on the usual case-insensitive macOS filesystem.
const image = path.join(work, 'fixtures.sparseimage');
const fixtureRoot = path.join(work, 'fixtures');
await fs.mkdir(fixtureRoot);
command('hdiutil', ['create', '-size', '8g', '-type', 'SPARSE', '-fs', 'Case-sensitive APFS', '-volname', 'MACxus backend tests', image], false, root);
command('hdiutil', ['attach', image, '-nobrowse', '-mountpoint', fixtureRoot], false, root);
const oldTmp = env.TMPDIR;
try {
  env.TMPDIR = fixtureRoot + path.sep;
  cargo(['test', ...features, '-p', 'xodus-cli']);
  for (const filter of ['credential_', 'content_license_', 'content_ticket_', 'ticket_diagnostic_']) cargo(['test', ...features, '-p', 'xodus', filter]);
  cargo(['test', ...features, '-p', 'xodus-service', 'store_']);
} finally {
  if (oldTmp === undefined) delete env.TMPDIR; else env.TMPDIR = oldTmp;
  command('hdiutil', ['detach', fixtureRoot], false, root);
  await fs.rm(image);
}
cargo(['build', ...features, '-p', 'xodus-cli', '-p', 'xodus-service']);
const cli = path.join(target, 'release/xodus-cli');
const help = command(cli, ['--help'], true);
for (const name of ['account', 'login', 'logout', 'streaming', 'run', 'resolve-package', 'game-activity', 'achievements']) {
  if (!new RegExp(`^\\s{2}${name}\\s{2,}`, 'm').test(help)) throw Error(`Backend lacks ${name}.`);
}
if (!help.includes('--external-webview-stdio')) throw Error('The backend lacks Electron sign-in support.');
if (!command(cli, ['run', '--help'], true).includes('--materialize-chain')) throw Error('The backend lacks macOS launch-chain support.');
const streaming = command(cli, ['streaming', '--help'], true);
for (const flag of ['--progress-json', '--control-stdin', '--selected-content-id', '--download-limit-kib']) if (!streaming.includes(flag)) throw Error(`Backend lacks ${flag}.`);
for (const name of ['xodus-cli', 'xodus-service']) {
  const binary = path.join(target, 'release', name);
  const libraries = command('otool', ['-L', binary], true).split('\n').slice(1).filter(line => line.trim());
  if (!libraries.length || libraries.some(line => !/^\s+(?:\/System\/Library\/|\/usr\/lib\/)/.test(line))) throw Error(`${name} depends on a non-system library. Bundle its dependencies before shipping.`);
  command('codesign', ['--verify', '--strict', binary]);
}
if (checkOnly) {
  console.log('Native backend tests, pinned source, command capabilities, signatures and system-only libraries verified. No account, service or game was started.');
  process.exit(0);
}
const bundle = path.join(work, 'bundle');
await fs.mkdir(bundle);
for (const name of ['xodus-cli', 'xodus-service']) {
  await fs.copyFile(path.join(target, 'release', name), path.join(bundle, name));
  await fs.chmod(path.join(bundle, name), 0o755);
}
signMacBackend(bundle, signingIdentity);
await fs.copyFile(path.join(source, 'LICENSE'), path.join(bundle, 'LICENSE'));
// Include complete corresponding source, vendored dependencies and exact recipe.
const vendor = command('rustup', ['run', lock.rust, 'cargo', 'vendor', '--locked', 'vendor'], true);
await fs.mkdir(path.join(source, '.cargo'), { recursive: true });
await fs.writeFile(path.join(source, '.cargo/config.toml'), vendor);
const recipe = path.join(work, 'recipe');
await fs.mkdir(path.join(recipe, 'assets'), { recursive: true });
await fs.mkdir(path.join(recipe, 'scripts'));
await fs.copyFile(path.join(root, 'assets/backend-source.lock.json'), path.join(recipe, 'assets/backend-source.lock.json'));
for (const patch of lock.patches) await fs.copyFile(path.join(root, 'assets', patch.file), path.join(recipe, 'assets', patch.file));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(recipe, 'scripts/build-mac-backend.mjs'));
await fs.copyFile(new URL('./mac-backend-signing.mjs', import.meta.url), path.join(recipe, 'scripts/mac-backend-signing.mjs'));
await fs.writeFile(path.join(recipe, 'BUILD.txt'), `GPL-3.0 backend; dependency licenses retained in source/vendor.\nRust ${lock.rust}; macOS SDK and protoc required for rebuilding only.\nFrom source/: MACOSX_DEPLOYMENT_TARGET=13.0 cargo +${lock.rust} build --locked --offline --release --no-default-features -p xodus-cli -p xodus-service\nAuth UI: Electron. Never run xodus-service to inspect it; it accesses account services.\n`);
// Supply an explicit file list instead of BSD/GNU tar exclusion semantics. Preserve
// nested dependency directories named target while excluding checkout metadata.
const entries = (await fs.readdir(source)).filter(name => !['.git', 'target'].includes(name));
command('tar', ['-cJf', path.join(bundle, 'source.tar.xz'), '-C', work, 'recipe', ...entries.map(name => 'source/' + name)], false, root);
const files = {};
for (const name of MAC_BACKEND_FILES) files[name] = sha(await fs.readFile(path.join(bundle, name)));
const manifest = { schema: 1, platform: 'darwin', arch: 'arm64', authUi: 'electron', version: lock.version,
  commit: lock.commit, recipeSha256: backendRecipeSha256, compatibility: lock.macCompatibility, buildRecipeSha256, signingIdentity, rustc, files };
await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await readBundledBackend(bundle, 'arm64');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.rename(bundle, output);
console.log(`Verified backend and complete corresponding source ready at ${output}. No account/service/game started.`);
