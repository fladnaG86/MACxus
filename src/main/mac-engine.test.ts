import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CrossOverInstall } from './crossover.js';
import { CROSSOVER_MISSING } from './mac-launch.js';
import { appleGptkRoot, D3DMETAL_MISSING, HIGHBALL_MISSING, prepareMacRunner, type MacRunnerDeps } from './mac-engine.js';
import type { ProtonRunner } from './proton.js';

const temporary: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-eng-'));
  temporary.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function crossOverWithGptk(base: string, withGptk = true): Promise<CrossOverInstall> {
  const root = path.join(base, 'CrossOver');
  if (withGptk) {
    await mkdir(path.join(root, 'lib64/apple_gptk/external'), { recursive: true });
    await mkdir(path.join(root, 'lib64/apple_gptk/wine'), { recursive: true });
  } else await mkdir(root, { recursive: true });
  return { root, wine: `${root}/bin/wine`, wineserver: `${root}/bin/wineserver`, cxbottle: `${root}/bin/cxbottle`, version: '26.3' };
}

function deps(cx: CrossOverInstall | undefined, highball: string | undefined, calls: string[]): MacRunnerDeps {
  const runner = (name: string): ProtonRunner => ({ command: `/${name}`, compatibilityDataPath: `/${name}-prefix`, stopPrefix: { command: `/${name}`, args: ['--nexus-stop-prefix'] } });
  return {
    findCrossOver: async () => cx,
    highballInstalled: () => highball,
    prepareCrossOver: async (_cx, bottles, dlls) => { calls.push(`crossover ${bottles}`, `dlls ${dlls.dir} ${dlls.overrideDir}`); return runner('cx'); },
    prepareHighball: async (engine, gptk, lib64, bottles, dlls, env, _log, engineOverrides, shim) => { calls.push(`highball ${engine} ${gptk} ${lib64} ${bottles} ${JSON.stringify(env)}`, `dlls ${dlls.dir} ${dlls.overrideDir}`, `engine overrides ${engineOverrides}`, `d3d12 shim ${shim}`); return runner('hb'); },
    profiles: async () => ({ FH6: { engine: 'highball', env: { D3DM_VENDOR_ID: '0x10de' }, note: 'Profilo da highball-db (CC0)' } }),
  };
}

describe('appleGptkRoot', () => {
  it('returns CrossOver lib64/apple_gptk when present', async () => {
    const cx = await crossOverWithGptk(await tmp());
    expect(appleGptkRoot(cx)).toBe(path.join(cx.root, 'lib64/apple_gptk'));
  });
  it('throws the Italian D3DMetal error without CrossOver or without apple_gptk', async () => {
    expect(() => appleGptkRoot(undefined)).toThrow(D3DMETAL_MISSING);
    const bare = await crossOverWithGptk(await tmp(), false);
    expect(() => appleGptkRoot(bare)).toThrow(D3DMETAL_MISSING);
    expect(D3DMETAL_MISSING).toBe('D3DMetal non trovato: serve CrossOver installato');
  });
});

describe('prepareMacRunner', () => {
  it('routes a Halo pack through its own engine and prefix for launch and prerequisite setup', async () => {
    const stable = await crossOverWithGptk(await tmp()), preview = await crossOverWithGptk(await tmp());
    const packed = { ...preview, wine: '/private-pack/bin/wine' };
    const options = deps(stable, undefined, []);
    options.findCrossOverPreview = async () => preview;
    options.profiles = async () => ({ '9N683TDT5M7R': { engine: 'crossover-preview', env: {} } });
    const selected: unknown[] = [], configured: string[] = [];
    options.prepareCompatibility = async request => {
      if (request.storeId !== '9N683TDT5M7R') return undefined;
      expect(request.installation).toBe(preview);
      return { installation: packed, bottlesRoot: '/private-pack/bottles', environment: { MACXUS_MF_SOFTWARE_OUTPUT: '1' }, validatePrefix: async () => {}, configurePrefix: async prefix => { configured.push(prefix); } };
    };
    options.prepareCrossOver = async (cx, bottles) => {
      selected.push([cx, bottles]); return { command: `${bottles}/runner`, compatibilityDataPath: `${bottles}/xbox` };
    };
    const request = { setting: 'crossover' as const, storeId: '9N683TDT5M7R', dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} };
    for (let i = 0; i < 2; i++) {
      const result = await prepareMacRunner(request, options);
      expect(result.profileEnv).toEqual({ MACXUS_MF_SOFTWARE_OUTPUT: '1' });
      expect(result.runner.compatibilityDataPath).toBe('/private-pack/bottles/xbox');
    }
    expect(selected).toEqual([[preview, '/private-pack/bottles'], [packed, '/private-pack/bottles'], [preview, '/private-pack/bottles'], [packed, '/private-pack/bottles']]);
    expect(configured).toEqual(['/private-pack/bottles/xbox', '/private-pack/bottles/xbox']);
    const other = await prepareMacRunner({ ...request, storeId: 'another-game' }, options);
    expect(other.profileEnv).toEqual({}); expect(selected.at(-1)).toEqual([stable, '/d/bottles']);
  });
  it('stages a native runtime pack after one ordinary setup in its dedicated bottle', async () => {
    const cx = await crossOverWithGptk(await tmp()); cx.version = '20261015';
    const options = deps(cx, undefined, []); options.findCrossOverPreview = async () => cx;
    const events: string[] = [];
    options.prepareRuntimeCompatibility = async () => ({ installation: cx, bottlesRoot: '/private-runtime/bottles',
      environment: { MACXUS_007_PUBLIC_CONFIG: '1' }, validatePrefix: async () => { events.push('validate'); },
      configurePrefix: async () => { events.push('overlay'); } });
    options.prepareCrossOver = async (engine, bottles) => {
      expect(engine).toBe(cx); expect(bottles).toBe('/private-runtime/bottles'); events.push('ordinary setup');
      return { command: '/runner', compatibilityDataPath: `${bottles}/xbox` };
    };
    const result = await prepareMacRunner({ setting: 'crossover-preview', storeId: '9PN198B459VB', dataRoot: '/data', runtimeDllDir: '/runtime', log: () => {} }, options);
    expect(events).toEqual(['validate', 'ordinary setup', 'overlay']);
    expect(result.profileEnv.MACXUS_007_PUBLIC_CONFIG).toBe('1');
  });
  it('selects the separate FEX app and asks for an ARM64 bottle, independently of regular Preview', async () => {
    const stable = await crossOverWithGptk(await tmp()), preview = await crossOverWithGptk(await tmp());
    const arm = { ...await crossOverWithGptk(await tmp()), supportsArm64: true };
    const options = deps(stable, undefined, []);
    options.findCrossOverPreview = async () => preview;
    options.findCrossOverPreviewFex = async () => arm;
    let selection: unknown[] = [];
    options.prepareCrossOver = async (cx, bottles, _dlls, _log, architecture) => {
      selection = [cx, bottles, architecture];
      return { command: '/fixture', compatibilityDataPath: '/fixture-prefix' };
    };
    const result = await prepareMacRunner({ setting: 'crossover-preview-fex', storeId: undefined, dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} }, options);
    expect(result.engine).toBe('crossover-preview-fex');
    expect(selection).toEqual([arm, '/d/bottles-crossover-preview-fex', 'arm64']);
  });
  it('uses Preview only when selected, with an isolated bottle root and the Preview executables', async () => {
    const stable = await crossOverWithGptk(await tmp()), preview = await crossOverWithGptk(await tmp());
    const calls: string[] = [], options = deps(stable, undefined, calls);
    options.findCrossOverPreview = async () => preview;
    let selected: CrossOverInstall | undefined;
    const original = options.prepareCrossOver;
    options.prepareCrossOver = async (cx, ...args) => { selected = cx; return original(cx, ...args); };
    const request = { setting: 'crossover-preview' as const, storeId: undefined, dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} };
    expect((await prepareMacRunner(request, options)).engine).toBe('crossover-preview');
    expect(selected).toBe(preview); expect(calls[0]).toBe('crossover /d/bottles-crossover-preview');
    calls.length = 0;
    await prepareMacRunner({ ...request, setting: 'crossover' }, options);
    expect(selected).toBe(stable); expect(calls[0]).toBe('crossover /d/bottles');
  });
  it('does not silently substitute regular CrossOver for missing Preview', async () => {
    const cx = await crossOverWithGptk(await tmp());
    await expect(prepareMacRunner({ setting: 'crossover-preview', storeId: undefined, dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} }, deps(cx, undefined, []))).rejects.toThrow('CrossOver Preview was not found');
  });
  it('uses CrossOver by default and logs the choice', async () => {
    const calls: string[] = []; const log: string[] = [];
    const cx = await crossOverWithGptk(await tmp());
    const result = await prepareMacRunner({ setting: undefined, storeId: 'OTHER', dataRoot: '/d', runtimeDllDir: '/dll', log: (l) => log.push(l) }, deps(cx, '/hb', calls));
    expect(result.engine).toBe('crossover');
    expect(result.profileEnv).toEqual({});
    expect(calls).toEqual(['crossover /d/bottles', 'dlls /dll /d/runtime-overrides']);
    expect(log.join('\n')).toContain('CrossOver');
  });

  it('switches to Highball for a profiled game when Highball is installed, passing the profile env', async () => {
    const calls: string[] = []; const log: string[] = [];
    const cx = await crossOverWithGptk(await tmp());
    const result = await prepareMacRunner({ setting: 'crossover', storeId: 'fh6', dataRoot: '/d', runtimeDllDir: '/dll', log: (l) => log.push(l) }, deps(cx, '/hb', calls));
    expect(result.engine).toBe('highball');
    expect(result.profileEnv).toEqual({ D3DM_VENDOR_ID: '0x10de' });
    expect(calls).toEqual([`highball /hb ${path.join(cx.root, 'lib64/apple_gptk')} ${path.join(cx.root, 'lib64')} /d/bottles {"D3DM_VENDOR_ID":"0x10de"}`, 'dlls /dll /d/runtime-overrides', 'engine overrides /d/highball-overrides', 'd3d12 shim /d/highball-d3d12-shim']);
    expect(log.join('\n')).toMatch(/Highball/);
    expect(log.join('\n')).toContain('Profilo da highball-db (CC0)');
  });

  it('keeps the global setting when the profiled engine is not installed', async () => {
    const calls: string[] = [];
    const cx = await crossOverWithGptk(await tmp());
    const result = await prepareMacRunner({ setting: 'crossover', storeId: 'FH6', dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} }, deps(cx, undefined, calls));
    expect(result.engine).toBe('crossover');
    expect(calls).toEqual(['crossover /d/bottles', 'dlls /dll /d/runtime-overrides']);
  });

  it('fails in Italian when Highball is chosen but not installed', async () => {
    const cx = await crossOverWithGptk(await tmp());
    await expect(prepareMacRunner({ setting: 'highball', storeId: undefined, dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} }, deps(cx, undefined, [])))
      .rejects.toThrow(HIGHBALL_MISSING);
    expect(HIGHBALL_MISSING).toMatch(/Impostazioni/);
  });

  it('fails with the D3DMetal error when Highball is chosen without CrossOver', async () => {
    await expect(prepareMacRunner({ setting: 'highball', storeId: undefined, dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} }, deps(undefined, '/hb', [])))
      .rejects.toThrow(D3DMETAL_MISSING);
  });

  it('fails with the CrossOver error when CrossOver is chosen but missing', async () => {
    await expect(prepareMacRunner({ setting: 'crossover', storeId: undefined, dataRoot: '/d', runtimeDllDir: '/dll', log: () => {} }, deps(undefined, '/hb', [])))
      .rejects.toThrow(CROSSOVER_MISSING);
  });
});
