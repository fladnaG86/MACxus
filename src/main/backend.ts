import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { BackendCapabilities, BackendStatus } from '../shared/types.js';
import { parseBackendHelp } from '../shared/utils.js';
import { run } from './process.js';
import { findLocalSigningIdentity, isSignedWithLocalIdentity, signBackendBinary } from './codesign.js';
import { backendLock, backendRecipeSha256, backendAssets, compareVersions } from './backend-package.js';
import { readBundledBackend } from './bundled-backend.js';
import { discoverBackend, installBackend, type BackendArtifact } from './backend-releases.js';

const REPOSITORY = backendLock.repository;
/** Launch-compatibility tag a managed backend must carry. Linux keeps the release tag; macOS has its own. */
export function backendCompatibility(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? backendLock.macCompatibility : backendLock.compatibility;
}
export const LINUX_RUN_PATCH = backendCompatibility();
const LINUX_RUN_RELEASE = backendLock.patchId;
const EMPTY_CAPABILITIES: BackendCapabilities = {
  commands: [], account: false, login: false, logout: false, download: false, streaming: false, run: false,
};

export const MAC_BACKEND_BUILD_HINT = 'Su macOS il backend Nexus si compila dal codice sorgente: in Impostazioni premi «Compila il backend». Servono Git, Rust (Cargo) e protoc.';

/**
 * Apps opened from Finder get PATH=/usr/bin:/bin:/usr/sbin:/sbin, which lacks
 * rustup's ~/.cargo/bin and Homebrew. Prepend the usual macOS tool folders
 * (once each) so the build tools and cargo's own rustc/protoc lookups work.
 */
export function buildToolEnvironment(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, home = os.homedir()): NodeJS.ProcessEnv {
  if (platform !== 'darwin') return env;
  const current = (env.PATH ?? '').split(':').filter(Boolean);
  const extra = [path.join(home, '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].filter((dir) => !current.includes(dir));
  return { ...env, PATH: [...extra, ...current].join(':') };
}

interface ManagedPointer { commit: string; binaryPath: string; builtAt: string; linuxRunPatch?: string; recipeSha256?: string; version?: string; delivery?: 'release' | 'local'; preferLocal?: boolean }

export class BackendManager {
  private status: BackendStatus;
  private readonly managedRoot: string;
  private readonly pointerFile: string;
  private emitLog: (scope: string, line: string) => void;
  private isOperationActive: () => boolean;
  private artifact?: BackendArtifact;

  constructor(
    userData: string,
    externalRoot: string,
    emitLog: (scope: string, line: string) => void,
    isOperationActive: () => boolean,
    private readonly fetcher: typeof fetch = fetch,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly bundle?: { root: string; arch: string },
  ) {
    this.managedRoot = path.join(userData, 'xodus-backends');
    this.pointerFile = path.join(this.managedRoot, 'current.json');
    this.emitLog = emitLog;
    this.isOperationActive = isOperationActive;
    this.status = {
      available: false,
      source: 'none',
      updateAvailable: false,
      checking: false,
      updating: false,
      externalRoot,
      capabilities: EMPTY_CAPABILITIES,
      prerequisites: { git: false, cargo: false, rustc: false, protoc: false },
      signingIdentity: false,
    };
  }

  /**
   * macOS: sign the two backend binaries with the user's local certificate so their
   * identity is stable across rebuilds (no repeated Keychain prompts). Never throws.
   */
  private async signBinaries(cli: string, service: string, log: (line: string) => void, onlyIfUnsigned = false): Promise<void> {
    if (this.platform !== 'darwin') return;
    const identity = await findLocalSigningIdentity();
    this.status.signingIdentity = Boolean(identity);
    if (!identity) {
      log('Certificato «MACxus Local Signing» non trovato: il backend resta con firma ad-hoc e macOS chiederà di nuovo l’accesso al Portachiavi dopo ogni ricompilazione. Vedi Impostazioni per crearlo.');
      return;
    }
    for (const [binary, identifier] of [[cli, 'io.macxus.xodus-cli'], [service, 'io.macxus.xodus-service']] as const) {
      try {
        if (onlyIfUnsigned && await isSignedWithLocalIdentity(binary)) continue;
        await signBackendBinary(binary, identifier, identity);
        log(`Firmato ${path.basename(binary)} con «MACxus Local Signing».`);
      } catch (error) {
        log(`Firma di ${path.basename(binary)} non riuscita (resta la firma ad-hoc): ${(error as Error).message}`);
      }
    }
  }

  /** After cargo: sign (darwin), then validate the built backend. Signing must precede validation. */
  private async signAndValidateBuilt(builtCli: string, builtService: string, log: (line: string) => void): Promise<BackendCapabilities> {
    await this.signBinaries(builtCli, builtService, log);
    const capabilities = await this.validate(builtCli);
    if (!capabilities?.login || !capabilities.streaming || !capabilities.account || !capabilities.externalAuth || !capabilities.packageSelection) throw new Error('The built backend failed command validation.');
    const runHelp = await run(builtCli, ['run', '--help'], { maxOutput: 100_000 });
    if (runHelp.code !== 0 || !runHelp.output.includes('--materialize-chain')) throw new Error('The built backend lacks launch-chain support.');
    return capabilities;
  }

  /** macOS startup: sign the current managed backend if it is not yet signed with the local certificate. */
  async ensureSigned(onStatus: () => void = () => {}): Promise<void> {
    if (this.platform !== 'darwin' || this.status.delivery === 'bundled') return;
    try {
      if (this.status.updating || this.isOperationActive()) {
        // Re-signing rewrites the file in place; never do it under a running backend or build.
        this.status.signingIdentity = Boolean(await findLocalSigningIdentity());
        onStatus();
        return;
      }
      const binary = this.status.source === 'managed' ? this.status.binaryPath : undefined;
      if (binary) await this.signBinaries(binary, path.join(path.dirname(binary), 'xodus-service'), line => this.emitLog('backend', line), true);
      else this.status.signingIdentity = Boolean(await findLocalSigningIdentity());
    } catch (error) { this.emitLog('backend', `Controllo firma non riuscito: ${(error as Error).message}`); }
    onStatus();
  }

  get current(): BackendStatus { return structuredClone(this.status); }

  setExternalRoot(root: string): void { this.status.externalRoot = root; }

  private toolEnvironment(): NodeJS.ProcessEnv { return buildToolEnvironment(process.env, this.platform); }

  private async commandExists(command: string): Promise<boolean> {
    try { return (await run(command, ['--version'], { maxOutput: 20_000, env: this.toolEnvironment() })).code === 0; } catch { return false; }
  }

  private async validate(binaryPath: string): Promise<BackendCapabilities | null> {
    try {
      await fs.access(binaryPath, constants.X_OK);
      const result = await run(binaryPath, ['--help'], { maxOutput: 100_000 });
      if (result.code !== 0) return null;
      const capabilities = parseBackendHelp(result.output);
      if (capabilities.streaming) {
        const streaming = await run(binaryPath, ['streaming', '--help'], { maxOutput: 100_000 });
        capabilities.streamingProgressJson = streaming.code === 0 && /(?:^|\s)--progress-json(?:\s|$)/m.test(streaming.output);
        capabilities.streamingControls = Boolean(capabilities.streamingProgressJson && /(?:^|\s)--control-stdin(?:\s|$)/m.test(streaming.output));
        capabilities.streamingBandwidthLimit = Boolean(capabilities.streamingControls && /(?:^|\s)--download-limit-kib(?:\s|$)/m.test(streaming.output));
        capabilities.packageSelection = streaming.code === 0 && capabilities.commands.includes('resolve-package') && /(?:^|\s)--selected-content-id(?:\s|$)/m.test(streaming.output);
      }
      return capabilities.login && capabilities.streaming ? capabilities : null;
    } catch { return null; }
  }

  private async gitCommit(root: string): Promise<string | undefined> {
    try {
      const result = await run('git', ['-C', root, 'rev-parse', 'HEAD'], { maxOutput: 10_000 });
      return result.code === 0 ? result.output.trim() : undefined;
    } catch { return undefined; }
  }

  private async readPointer(): Promise<ManagedPointer | null> {
    try { return JSON.parse(await fs.readFile(this.pointerFile, 'utf8')) as ManagedPointer; } catch { return null; }
  }

  async refresh(): Promise<BackendStatus> {
    if (this.platform === 'darwin' && this.bundle) {
      // An explicit developer checkout is preserved. Otherwise use the shipped
      // backend before probing Git/Cargo: /usr/bin/git can open an Xcode-tools
      // install prompt on a clean Mac, even for --version.
      const external = this.status.externalRoot ? path.join(this.status.externalRoot, 'target', 'release', 'xodus-cli') : undefined;
      const capabilities = external ? await this.validate(external) : undefined;
      if (external && capabilities) {
        Object.assign(this.status, { available: true, source: 'external', binaryPath: external, capabilities,
          commit: undefined, version: undefined, delivery: undefined, linuxRunPatch: undefined, blockReason: undefined });
        return this.current;
      }
      const local = await this.readPointer();
      if (local?.preferLocal && local.delivery === 'local' && local.recipeSha256 === backendRecipeSha256 && local.linuxRunPatch === backendCompatibility(this.platform)) {
        const capabilities = await this.validate(local.binaryPath);
        if (capabilities) {
          Object.assign(this.status, { available: true, source: 'managed', binaryPath: local.binaryPath, capabilities,
            commit: local.commit, version: local.version, delivery: 'local', linuxRunPatch: local.linuxRunPatch, blockReason: undefined });
          return this.current;
        }
      }
      try {
        const bundled = await readBundledBackend(this.bundle.root, this.bundle.arch);
        const capabilities = await this.validate(bundled.cli);
        const runHelp = await run(bundled.cli, ['run', '--help'], { maxOutput: 100_000 });
        if (!capabilities?.account || !capabilities.externalAuth || !capabilities.packageSelection || !capabilities.run ||
            !capabilities.streamingProgressJson || !capabilities.streamingControls || !capabilities.streamingBandwidthLimit ||
            runHelp.code !== 0 || !runHelp.output.includes('--materialize-chain')) throw Error('Bundled backend command validation failed. Reinstall MACxus.');
        Object.assign(this.status, { available: true, source: 'bundled', binaryPath: bundled.cli, capabilities,
          commit: bundled.manifest.commit, version: bundled.manifest.version, delivery: 'bundled',
          linuxRunPatch: bundled.manifest.compatibility, blockReason: undefined, updateAvailable: false });
      } catch (error) {
        Object.assign(this.status, { available: false, source: 'none', binaryPath: undefined, capabilities: EMPTY_CAPABILITIES,
          commit: undefined, version: undefined, delivery: 'bundled', linuxRunPatch: undefined,
          blockReason: `Bundled backend could not be verified. Reinstall MACxus. ${(error as Error).message}` });
      }
      return this.current;
    }
    const [git, cargo, rustc, protoc] = await Promise.all([
      this.commandExists('git'), this.commandExists('cargo'), this.commandExists('rustc'), this.commandExists('protoc'),
    ]);
    this.status.prerequisites = { git, cargo, rustc, protoc };

    const pointer = await this.readPointer();
    if (pointer) {
      const capabilities = await this.validate(pointer.binaryPath);
      if (capabilities) {
        Object.assign(this.status, {
          available: true, source: 'managed', binaryPath: pointer.binaryPath,
          commit: pointer.commit, capabilities, blockReason: undefined,
          linuxRunPatch: pointer.linuxRunPatch,
          version: pointer.version, delivery: pointer.delivery,
        });
        return this.current;
      }
    }

    const externalBinary = path.join(this.status.externalRoot, 'target', 'release', 'xodus-cli');
    // An empty externalRoot would make this a cwd-relative path; never look there.
    const capabilities = this.status.externalRoot ? await this.validate(externalBinary) : undefined;
    if (capabilities) {
      Object.assign(this.status, {
        available: true, source: 'external', binaryPath: externalBinary,
        commit: await this.gitCommit(this.status.externalRoot), capabilities, blockReason: undefined,
        linuxRunPatch: undefined,
        version: undefined, delivery: undefined,
      });
    } else {
      Object.assign(this.status, {
        available: false, source: 'none', binaryPath: undefined, commit: undefined,
        version: undefined, delivery: undefined, linuxRunPatch: undefined,
        capabilities: EMPTY_CAPABILITIES,
        blockReason: 'No validated xodus-cli with login and streaming commands was found.',
      });
    }
    return this.current;
  }

  async externalDownloadRunning(): Promise<boolean> {
    try {
      const result = await run('ps', ['-eo', 'args='], { maxOutput: 2_000_000 });
      return result.output.split('\n').some((line) => {
        const lower = line.toLowerCase();
        return lower.includes('xodus-cli') && /\s(streaming|download)\s/.test(lower);
      });
    } catch { return false; }
  }

  private async assertUpdateAllowed(): Promise<void> {
    if (this.isOperationActive()) throw new Error('The backend cannot be updated while authentication, a download, or a game is active.');
    if (await this.externalDownloadRunning()) throw new Error('An external Xodus download is active. The update was blocked.');
  }

  async checkUpdate(): Promise<BackendStatus> {
    if (this.platform === 'darwin') {
      // Packaged Macs update the backend with the app. Developer builds retain
      // the local-build hint; preserve verification errors for packaged apps.
      this.artifact = undefined;
      Object.assign(this.status, { releaseAvailable: false, updateAvailable: false, releaseVersion: undefined,
        blockReason: this.status.available ? undefined : this.bundle ? this.status.blockReason : MAC_BACKEND_BUILD_HINT });
      return this.current;
    }
    this.status.checking = true;
    try {
      this.artifact = await discoverBackend(this.fetcher);
      const pointer = await this.readPointer();
      this.status.releaseAvailable = true;
      this.status.releaseVersion = this.artifact.manifest.version;
      this.status.updateAvailable = !this.status.available || pointer?.delivery !== 'release' ||
        !pointer?.version || compareVersions(pointer.version, this.artifact.manifest.version) < 0;
      this.status.blockReason = undefined;
    } catch (error) {
      this.artifact = undefined;
      this.status.releaseAvailable = false;
      this.status.updateAvailable = false;
      const message = (error as Error).message;
      this.status.blockReason = message.startsWith('No compatible Nexus backend release')
        ? message : `Backend release check failed: ${message}`;
    } finally { this.status.checking = false; }
    return this.current;
  }

  async update(onStatus: () => void): Promise<void> {
    if (this.platform === 'darwin') throw new Error(MAC_BACKEND_BUILD_HINT);
    await this.assertUpdateAllowed();
    if (this.status.updating) throw new Error('A backend installation is already running.');
    this.status.updating = true;
    this.status.blockReason = undefined;
    onStatus();
    try {
      // Refresh discovery at install time; do not use a stale candidate.
      this.artifact = await discoverBackend(this.fetcher);
      const binaryPath = await installBackend(this.managedRoot, this.artifact, this.fetcher, async cli => {
        const caps = await this.validate(cli);
        if (!caps?.account || !caps.run || !caps.streaming || !caps.login || !caps.logout || !caps.download || !caps.externalAuth || !caps.packageSelection) {
          throw new Error('Backend validation failed. The prebuilt build requires glibc 2.35 or newer, OpenSSL 3 and D-Bus runtime libraries.');
        }
        const help = await run(cli, ['run', '--help'], { maxOutput: 100_000 });
        if (help.code !== 0 || !help.output.includes('--materialize-chain')) throw new Error('Backend launch-chain validation failed.');
      }, () => this.assertUpdateAllowed(), message => {
        this.status.phase = message; this.emitLog('backend', message); onStatus();
      });
      await this.assertUpdateAllowed();
      const manifest = this.artifact.manifest;
      const pointer: ManagedPointer = { commit: manifest.commit, binaryPath, builtAt: new Date().toISOString(),
        linuxRunPatch: manifest.compatibility, recipeSha256: manifest.recipeSha256, version: manifest.version, delivery: 'release' };
      const temporary = `${this.pointerFile}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(pointer, null, 2)); await fs.rename(temporary, this.pointerFile); }
      finally { await fs.rm(temporary, { force: true }); }
      await this.refresh();
      Object.assign(this.status, { releaseAvailable: true, releaseVersion: manifest.version, updateAvailable: false, phase: 'Backend is ready.' });
    } catch (error) {
      this.status.blockReason = (error as Error).message;
      this.status.phase = 'Backend update failed; the previous backend was kept.';
      throw error;
    } finally { this.status.updating = false; onStatus(); }
  }

  async rebuild(onStatus: () => void): Promise<void> {
    await this.assertUpdateAllowed();
    if (this.status.updating) throw new Error('A backend installation is already running.');
    // Developer rebuild is explicit; bundled startup never probes these tools.
    if (this.bundle) {
      const [git, cargo, rustc, protoc] = await Promise.all(['git', 'cargo', 'rustc', 'protoc'].map(command => this.commandExists(command)));
      this.status.prerequisites = { git, cargo, rustc, protoc };
    }
    if (!this.status.prerequisites.git || !this.status.prerequisites.cargo || !this.status.prerequisites.rustc || !this.status.prerequisites.protoc) {
      throw new Error('Git, Cargo, Rust, or protoc is missing. Check the build dependencies in Settings.');
    }
    this.status.updating = true;
    this.status.blockReason = undefined;
    onStatus();
    await fs.mkdir(path.join(this.managedRoot, 'releases'), { recursive: true });
    const staging = path.join(this.managedRoot, `.staging-${randomUUID()}`);
    const log = (line: string) => this.emitLog('backend', line);
    try {
      for (const patch of backendLock.patches) {
        if (createHash('sha256').update(await fs.readFile(path.join(backendAssets, patch.file))).digest('hex') !== patch.sha256) throw new Error('Backend patch checksum mismatch.');
      }
      log(`Cloning the pinned Xodus source ${backendLock.commit}…`);
      const env = this.toolEnvironment();
      let result = await run('git', ['clone', '--no-checkout', REPOSITORY, staging], { onLine: log, env });
      if (result.code !== 0) throw new Error(`git clone exited with code ${result.code}`);
      result = await run('git', ['-C', staging, 'checkout', '--detach', backendLock.commit], { onLine: log, env });
      if (result.code !== 0) throw new Error('Pinned backend checkout failed.');
      const commit = (await run('git', ['-C', staging, 'rev-parse', 'HEAD'], { env })).output.trim();
      if (commit !== backendLock.commit || createHash('sha256').update(await fs.readFile(path.join(staging, 'Cargo.lock'))).digest('hex') !== backendLock.cargoLockSha256) throw new Error('Backend source lock mismatch.');
      for (const patch of backendLock.patches) {
        const patchFile = path.join(staging, `.nexus-${patch.file}`);
        await fs.writeFile(patchFile, await fs.readFile(path.join(backendAssets, patch.file)));
        log(`Applying ${patch.file}…`);
        result = await run('git', ['-C', staging, 'apply', '--check', patchFile], { onLine: log, maxOutput: 100_000, env });
        if (result.code !== 0) throw new Error(`The pinned backend patch ${patch.file} does not apply; the previous backend remains active.`);
        result = await run('git', ['-C', staging, 'apply', patchFile], { onLine: log, maxOutput: 100_000, env });
        if (result.code !== 0) throw new Error(`Backend patch ${patch.file} could not be applied.`);
      }
      const target = path.join(staging, 'target');
      log(`Building ${commit.slice(0, 10)} with Cargo…`);
      result = await run('cargo', ['build', '--locked', '--release', '--no-default-features', '-p', 'xodus-cli', '-p', 'xodus-service'], {
        cwd: staging,
        env: { ...env, CARGO_TARGET_DIR: target },
        onLine: log,
        maxOutput: 5_000_000,
      });
      if (result.code !== 0) throw new Error(`cargo build exited with code ${result.code}`);
      const builtCli = path.join(target, 'release', 'xodus-cli');
      const capabilities = await this.signAndValidateBuilt(builtCli, path.join(target, 'release', 'xodus-service'), log);
      await this.assertUpdateAllowed();

      const releaseDir = path.join(this.managedRoot, 'releases', `${commit}-${LINUX_RUN_RELEASE}-local-${randomUUID()}`);
      await fs.mkdir(releaseDir, { recursive: true });
      const managedCli = path.join(releaseDir, 'xodus-cli');
      await fs.copyFile(builtCli, managedCli);
      await fs.chmod(managedCli, 0o755);
      const builtService = path.join(target, 'release', 'xodus-service');
      await fs.copyFile(builtService, path.join(releaseDir, 'xodus-service'));
      await fs.chmod(path.join(releaseDir, 'xodus-service'), 0o755);
      await fs.writeFile(path.join(releaseDir, 'metadata.json'), JSON.stringify({ commit, builtAt: new Date().toISOString(), capabilities, linuxRunPatch: backendCompatibility(this.platform) }, null, 2));
      const pointer: ManagedPointer = { commit, binaryPath: managedCli, builtAt: new Date().toISOString(), linuxRunPatch: backendCompatibility(this.platform),
        recipeSha256: backendRecipeSha256, version: backendLock.version, delivery: 'local', preferLocal: Boolean(this.bundle) };
      const pointerTmp = `${this.pointerFile}.tmp`;
      await fs.writeFile(pointerTmp, JSON.stringify(pointer, null, 2));
      await fs.rename(pointerTmp, this.pointerFile);
      Object.assign(this.status, {
        available: true, source: 'managed', binaryPath: managedCli, commit,
        upstreamCommit: commit, updateAvailable: false, capabilities, linuxRunPatch: backendCompatibility(this.platform),
        version: backendLock.version, delivery: 'local',
      });
      log('The new backend passed validation and was activated atomically. Older builds were preserved.');
    } catch (error) {
      this.status.blockReason = (error as Error).message;
      throw error;
    } finally {
      this.status.updating = false;
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      onStatus();
    }
  }
}
