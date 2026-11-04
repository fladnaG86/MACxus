import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MacEngine } from '../shared/types.js';
import { bundledRuntimeDllDirectory, findCrossOver, findCrossOverPreview, findCrossOverPreviewFex, prepareCrossOverRunner, runtimeOverrideDirectory, type CrossOverInstall, type RuntimeDllSource } from './crossover.js';
import { highballEngineInstalled, highballOverrideDirectory, highballShimDirectory, prepareHighballRunner } from './highball-engine.js';
import { CROSSOVER_MISSING } from './mac-launch.js';
import { effectiveMacEngine, loadMacProfiles, macProfileFor, type MacProfiles } from './mac-profiles.js';
import type { ProtonRunner } from './proton.js';
import { prepareGameRuntimePack } from './game-runtime-pack.js';
import { prepareGameCompatibilityPack, type CompatibilityPack, type CompatibilityPackRequest } from './game-compatibility-pack.js';

export const D3DMETAL_MISSING = 'D3DMetal non trovato: serve CrossOver installato';
export const HIGHBALL_MISSING = 'Il motore Highball non è installato. Installalo in Impostazioni → Motore Wine, oppure scegli CrossOver.';

/** D3DMetal ships with CrossOver: <CrossOver>/lib64/apple_gptk/{external,wine}. */
export function appleGptkRoot(cx: CrossOverInstall | undefined): string {
  if (!cx) throw new Error(D3DMETAL_MISSING);
  const root = path.join(cx.root, 'lib64', 'apple_gptk');
  if (!existsSync(path.join(root, 'external')) || !existsSync(path.join(root, 'wine'))) throw new Error(D3DMETAL_MISSING);
  return root;
}

export interface MacRunnerDeps {
  findCrossOver: () => Promise<CrossOverInstall | undefined>;
  findCrossOverPreview?: () => Promise<CrossOverInstall | undefined>;
  findCrossOverPreviewFex?: () => Promise<CrossOverInstall | undefined>;
  highballInstalled: (dataRoot: string) => string | undefined;
  prepareCrossOver: (cx: CrossOverInstall, bottlesRoot: string, runtimeDlls: RuntimeDllSource, log: (line: string) => void, architecture?: 'win64' | 'arm64') => Promise<ProtonRunner>;
  prepareHighball: (engineRoot: string, appleGptk: string, crossOverLib64: string, bottlesRoot: string, runtimeDlls: RuntimeDllSource, extraEnv: Record<string, string>, log: (line: string) => void, engineOverrideDir: string, d3d12ShimDir: string) => Promise<ProtonRunner>;
  profiles: () => Promise<MacProfiles>;
  prepareRuntimeCompatibility?: (request: CompatibilityPackRequest) => Promise<CompatibilityPack | undefined>;
  prepareCompatibility?: (request: CompatibilityPackRequest) => Promise<CompatibilityPack | undefined>;
}

const defaultDeps: MacRunnerDeps = {
  findCrossOver: () => findCrossOver(),
  findCrossOverPreview: () => findCrossOverPreview(),
  findCrossOverPreviewFex: () => findCrossOverPreviewFex(),
  highballInstalled: (dataRoot) => highballEngineInstalled(dataRoot),
  prepareCrossOver: (cx, bottlesRoot, runtimeDlls, log, architecture) => prepareCrossOverRunner(cx, bottlesRoot, runtimeDlls, 'd3dmetal', log, architecture),
  prepareHighball: prepareHighballRunner,
  profiles: () => loadMacProfiles(),
  prepareCompatibility: prepareGameCompatibilityPack,
  prepareRuntimeCompatibility: request => prepareGameRuntimePack(request),
};

export interface MacRunnerRequest {
  setting: MacEngine | undefined;
  storeId: string | undefined;
  dataRoot: string;
  runtimeDllDir: string;
  log: (line: string) => void;
}

export interface MacRunner {
  runner: ProtonRunner;
  engine: MacEngine;
  /** Whitelisted per-game environment to add to the launch. */
  profileEnv: Record<string, string>;
}

/**
 * Picks the engine for a game (profile engine if installed, else the global
 * setting) and prepares its runner. Used by both launch and VC++ install, so
 * they always share the same prefix.
 */
export async function prepareMacRunner(request: MacRunnerRequest, deps: MacRunnerDeps = defaultDeps): Promise<MacRunner> {
  const profile = macProfileFor(await deps.profiles(), request.storeId);
  const [stable, preview, previewFex] = await Promise.all([deps.findCrossOver(), deps.findCrossOverPreview?.(), deps.findCrossOverPreviewFex?.()]);
  const highball = deps.highballInstalled(request.dataRoot);
  const engine = effectiveMacEngine(request.setting, profile, { crossover: Boolean(stable), 'crossover-preview': Boolean(preview), 'crossover-preview-fex': Boolean(previewFex?.supportsArm64), highball: Boolean(highball) });
  const isPreview = engine === 'crossover-preview' || engine === 'crossover-preview-fex';
  const crossOver = engine === 'crossover-preview-fex' ? previewFex : isPreview ? preview : stable;
  const profileEnv = { ...(profile?.env ?? {}) };
  const bottlesRoot = path.join(request.dataRoot, 'bottles');
  const runtimeDlls: RuntimeDllSource = { dir: request.runtimeDllDir, overrideDir: runtimeOverrideDirectory(request.dataRoot), bundledDir: await bundledRuntimeDllDirectory(request.runtimeDllDir) };
  if (!runtimeDlls.bundledDir) request.log('Le DLL patchate di MACxus non corrispondono a questo runtime: uso quelle del runtime (alcuni giochi potrebbero non funzionare).');
  const profileText = profile
    ? `profilo ${request.storeId?.toUpperCase()}${profile.note ? ` (${profile.note})` : ''}${Object.keys(profileEnv).length ? `, variabili: ${Object.keys(profileEnv).join(', ')}` : ''}`
    : 'nessun profilo';
  if (engine === 'highball') {
    if (!highball) throw new Error(HIGHBALL_MISSING);
    const gptk = appleGptkRoot(crossOver);
    request.log(`Motore Wine: Highball (${highball}); D3DMetal da ${gptk}; ${profileText}.`);
    return { runner: await deps.prepareHighball(highball, gptk, path.join(crossOver!.root, 'lib64'), bottlesRoot, runtimeDlls, profileEnv, request.log, highballOverrideDirectory(request.dataRoot), highballShimDirectory(request.dataRoot)), engine, profileEnv };
  }
  if (!crossOver) throw new Error(engine === 'crossover-preview-fex' ? 'CrossOver FEX/ARM Preview was not found. Install the ARM64 edition or choose another Wine engine.' : isPreview ? 'CrossOver Preview was not found. Install it in Applications or choose another Wine engine.' : CROSSOVER_MISSING);
  if (engine === 'crossover-preview-fex' && !crossOver.supportsArm64) throw Error('This CrossOver Preview installation does not include the FEX/ARM engine.');
  const label = engine === 'crossover-preview-fex' ? 'CrossOver Preview (FEX/ARM)' : isPreview ? 'CrossOver Preview (Rosetta)' : 'CrossOver';
  request.log(`Motore Wine: ${label} ${crossOver.version || ''}`.trimEnd() + `; ${profileText}.`);
  // Preview must never upgrade the user's regular CrossOver bottle in place.
  const selectedBottles = isPreview ? path.join(request.dataRoot, engine === 'crossover-preview-fex' ? 'bottles-crossover-preview-fex' : 'bottles-crossover-preview') : bottlesRoot;
  const packRequest = { storeId: request.storeId, engine, installation: crossOver, dataRoot: request.dataRoot, log: request.log };
  const pack = await deps.prepareCompatibility?.(packRequest) ?? await deps.prepareRuntimeCompatibility?.(packRequest);
  // Register a new bottle's Windows components with the matching vendor engine.
  // The media replacement is validated for decoding, not first-boot registration.
  // Existing bottles take the normal idempotent setup path; none are shared with
  // other games. The packed runner is written last and used only after setup.
  if (pack) {
    await pack.validatePrefix(path.join(pack.bottlesRoot, 'xbox'));
    if (pack.installation !== crossOver) {
      await deps.prepareCrossOver(crossOver, pack.bottlesRoot, runtimeDlls, request.log, 'win64');
      await pack.validatePrefix(path.join(pack.bottlesRoot, 'xbox'));
    }
  }
  const runner = await deps.prepareCrossOver(pack?.installation ?? crossOver, pack?.bottlesRoot ?? selectedBottles, runtimeDlls, request.log, engine === 'crossover-preview-fex' ? 'arm64' : 'win64');
  if (pack) await pack.configurePrefix(runner.compatibilityDataPath);
  return { runner, engine, profileEnv: { ...profileEnv, ...pack?.environment } };
}
