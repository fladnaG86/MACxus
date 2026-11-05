import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { defaultLaunchTools } from '../shared/launch-tools.js';
import type { MacEngine } from '../shared/types.js';
import { crossOverWrapperScript, type CrossOverInstall } from './crossover.js';
import { highballWrapperScript } from './highball-engine.js';
import { prepareMacRunner, type MacRunnerDeps } from './mac-engine.js';
import { prepareMacLaunchOptions } from './mac-launch-options.js';
import { run } from './process.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function temporary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-game-options-'));
  roots.push(root);
  return root;
}

/** Real runner scripts, with disposable stand-ins for every engine executable.
 * No application discovery, Wine, bottle initialization, account or game launch. */
async function selectedRunner(root: string, engine: MacEngine) {
  const make = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, { mode: 0o700 });
    return file;
  };
  const report = `#!${process.execPath}\nconsole.log(JSON.stringify({ args: process.argv.slice(2), prefix: process.env.WINEPREFIX,
    graphics: process.env.CX_GRAPHICS_BACKEND, vendor: process.env.D3DM_VENDOR_ID, device: process.env.D3DM_DEVICE_ID,
    metalFx: process.env.D3DM_ENABLE_METALFX, nv: process.env.DXMT_ENABLE_NVEXT, cxEnv: process.env.CX_ENV,
    literal: process.env.LITERAL, socket: process.env.XODUS_SOCKET })); process.exit(7);\n`;
  const cx: CrossOverInstall = {
    root: path.join(root, 'CrossOver'), version: 'fixture', supportsArm64: true,
    wine: await make("CrossOver/tool's bin/wine", report),
    wineserver: await make('CrossOver/bin/wineserver', '#!/bin/sh\nexit 0\n'),
    cxbottle: path.join(root, 'never-run-cxbottle'),
  };
  await fs.mkdir(path.join(cx.root, 'lib64/apple_gptk/external'), { recursive: true });
  await fs.mkdir(path.join(cx.root, 'lib64/apple_gptk/wine'), { recursive: true });
  await make('highball/engine/bin/wine', report);
  await make('highball/engine/bin/wineserver', '#!/bin/sh\nexit 0\n');
  const runner = async (text: string, prefix: string) => {
    const command = await make(`runners/${engine}`, text);
    return { command, compatibilityDataPath: prefix, stopPrefix: { command, args: ['--nexus-stop-prefix'] } };
  };
  const deps: MacRunnerDeps = {
    findCrossOver: async () => cx, findCrossOverPreview: async () => cx, findCrossOverPreviewFex: async () => cx,
    highballInstalled: () => path.join(root, 'highball'),
    profiles: async () => ({ TEST: { env: { D3DM_VENDOR_ID: 'profile-vendor', D3DM_DEVICE_ID: 'profile-device' } } }),
    prepareCrossOver: async (install, bottles) => runner(crossOverWrapperScript(install, bottles, 'fixture', 'd3dmetal'), path.join(bottles, 'fixture')),
    prepareHighball: async (highball, gptk, lib64, bottles, _dlls, profile) => {
      const prefix = path.join(bottles, 'highball');
      return runner(highballWrapperScript(highball, gptk, lib64, prefix, profile), prefix);
    },
  };
  return prepareMacRunner({ setting: engine, storeId: 'TEST', dataRoot: root, runtimeDllDir: path.join(root, 'dlls'), log: () => {} }, deps);
}

it.each(['crossover', 'crossover-preview', 'crossover-preview-fex', 'highball'] as const)(
  'routes env and literal trailing arguments through the selected %s runner only', async engine => {
    const root = await temporary();
    const mac = await selectedRunner(root, engine);
    expect(mac.engine).toBe(engine);
    const source = { PATH: process.env.PATH, XODUS_SOCKET: 'synthetic-service-socket',
      D3DM_VENDOR_ID: 'inherited-vendor', CX_GRAPHICS_BACKEND: 'inherited-graphics', CX_ENV: 'BOTTLE_SETTING=keep' };
    const before = { ...source }, profileBefore = { ...mac.profileEnv };
    const launch = await prepareMacLaunchOptions(mac.runner.command, { ...defaultLaunchTools,
      launchOptions: `CX_GRAPHICS_BACKEND=dxmt D3DM_VENDOR_ID=custom LITERAL="literal $HOME; $(echo nope)" %command% --launcher-skip "two words" "it's literal" "" "*.txt"` },
    path.join(root, 'wrappers'), source, mac.profileEnv, mac.engine);
    const result = await run(launch.command, ['original game.exe'], { env: launch.environment });
    expect(result.code).toBe(7);
    const received = JSON.parse(result.output);
    expect(received.args).toEqual([...(engine === 'highball' ? [] : ['--bottle', 'fixture']), 'original game.exe', '--launcher-skip', 'two words', "it's literal", '', '*.txt']);
    expect(received).toMatchObject({ prefix: mac.runner.compatibilityDataPath, graphics: 'dxmt', vendor: 'custom', device: 'profile-device',
      literal: 'literal $HOME; $(echo nope)', socket: 'synthetic-service-socket' });
    expect(source).toEqual(before);
    expect(mac.profileEnv).toEqual(profileBefore);
    // Setup and Stop keep the original runner, with no trailing game arguments.
    const setup = JSON.parse((await run(mac.runner.command, ['reg', 'query'], { env: launch.environment })).output);
    expect(setup.args).toEqual([...(engine === 'highball' ? [] : ['--bottle', 'fixture']), 'reg', 'query']);
    expect((await run(mac.runner.stopPrefix.command, mac.runner.stopPrefix.args, { env: launch.environment })).code).toBe(0);
    const other = await prepareMacLaunchOptions(mac.runner.command, undefined, path.join(root, 'other'), source, {}, mac.engine);
    expect(other.command).toBe(mac.runner.command);
    expect(other.environment.D3DM_VENDOR_ID).toBe('inherited-vendor');
    expect(other.environment.CX_GRAPHICS_BACKEND).toBe('inherited-graphics');
    expect(other.environment.LITERAL).toBeUndefined();
    await expect(fs.stat(path.join(root, 'other'))).rejects.toThrow();
    await launch.cleanup();
    await expect(fs.stat(launch.command)).rejects.toThrow();
  },
);

it.each(['crossover', 'crossover-preview', 'crossover-preview-fex'])(
  'keeps per-game DLSS last in %s CX_ENV even with custom and inherited flags', async engine => {
    const root = await temporary();
    const source = { CX_ENV: 'INHERITED=1 DXMT_ENABLE_NVEXT=1', D3DM_ENABLE_METALFX: 'inherited' };
    for (const enabled of [true, false]) {
      const options = await prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, dlss: enabled,
        launchOptions: 'CX_ENV="CUSTOM=1 D3DM_ENABLE_METALFX=9 DXMT_ENABLE_NVEXT=9" D3DM_ENABLE_METALFX=9 DXMT_ENABLE_NVEXT=9 %command%' },
      path.join(root, 'wrappers'), source, { D3DM_ENABLE_METALFX: 'profile' }, engine);
      const nv = enabled ? '1' : '0';
      expect(options.environment.DXMT_ENABLE_NVEXT).toBe(nv);
      expect(options.environment.CX_ENV).toBe(`CUSTOM=1 D3DM_ENABLE_METALFX=9 DXMT_ENABLE_NVEXT=9 D3DM_ENABLE_METALFX=${options.environment.D3DM_ENABLE_METALFX} DXMT_ENABLE_NVEXT=${nv}`);
      if (!enabled) expect(options.environment.D3DM_ENABLE_METALFX).toBe('0');
    }
    expect(source).toEqual({ CX_ENV: 'INHERITED=1 DXMT_ENABLE_NVEXT=1', D3DM_ENABLE_METALFX: 'inherited' });
  },
);

it('applies assignments without a command marker or wrapper files; user choices beat profiles', async () => {
  const root = await temporary();
  const value = { ...defaultLaunchTools, launchOptions: 'D3DM_VENDOR_ID=game' };
  const before = structuredClone(value);
  const launch = await prepareMacLaunchOptions('/runner', value, path.join(root, 'wrappers'),
    { WINEMSYNC: '0', CX_ENV: 'keep' }, { WINEMSYNC: '1', D3DM_VENDOR_ID: 'profile' }, 'highball');
  expect(launch.command).toBe('/runner');
  expect(launch.environment).toEqual({ WINEMSYNC: '0', CX_ENV: 'keep', D3DM_VENDOR_ID: 'game' });
  expect(value).toEqual(before);
  await expect(fs.stat(path.join(root, 'wrappers'))).rejects.toThrow();
});

it.each(['WINEPREFIX=bad', 'WINEARCH=bad', 'WINE_DLL_FILE_MAP=bad', 'XODUS_SOCKET=bad', 'XODUS_BRIDGE_KEY=bad', 'STEAM_COMPAT_DATA_PATH=bad',
  'CX_BOTTLE=bad', 'CX_BOTTLE_PATH=bad', 'CX_ROOT=bad', 'CX_USER_BOTTLE_PATH=bad'])(
  'protects managed launch identity: %s', async launchOptions => {
    await expect(prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, launchOptions }, '/unused', {}, {}, 'crossover')).rejects.toThrow('managed by');
  },
);

it.each(['env FOO=1 %command%', 'gamemoderun %command%', 'sh -c %command%', 'echo --anything'])(
  'rejects unsupported macOS wrappers before writing or launching: %s', async launchOptions => {
    const root = await temporary();
    await expect(prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, launchOptions }, path.join(root, 'wrappers'), {}, {}, 'crossover')).rejects.toThrow('Custom launch wrappers are not supported on macOS');
    expect(await fs.readdir(root)).toEqual([]);
  },
);

it.each(['%command% && echo unsafe', '$(echo unsafe)', '%command% %command%', 'FOO="unclosed'])(
  'retains shell and malformed-input rejection: %s', async launchOptions => {
    await expect(prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, launchOptions }, '/unused', {}, {}, 'highball')).rejects.toThrow();
  },
);

it('routes the macOS game command/env through the helper while setup and Stop use the original runner', async () => {
  const source = await fs.readFile(new URL('./index.ts', import.meta.url), 'utf8');
  expect(source).toContain('prepareMacLaunchOptions(protonRunner.launchCommand ?? protonRunner.command, game.launchTools,');
  expect(source).toContain('args[2] = macOptions.command;');
  expect(source).toContain('Object.assign(environment, macOptions.environment);');
  expect(source).toContain('const wineCommand = protonRunner?.command ?? wine;');
  expect(source).toContain('{ stopPrefix: protonRunner?.stopPrefix }');
});

it.each(['WINEPREFIX', 'WINEARCH', 'WINE_DLL_FILE_MAP', 'XODUS_SOCKET', 'XODUS_BRIDGE_KEY', 'STEAM_COMPAT_DATA_PATH',
  'CX_BOTTLE', 'CX_BOTTLE_PATH', 'CX_ROOT', 'CX_USER_BOTTLE_PATH'])(
  'protects managed %s assignments inside CX_ENV, including duplicates', async key => {
    for (const nested of [`${key}=bad`, `GRAPHICS=ok ${key}=bad ${key}=other`, `'${key}=two words'`]) {
      const launchOptions = `CX_ENV="${nested}" %command%`;
      await expect(prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, launchOptions }, '/unused', {}, {}, 'crossover')).rejects.toThrow('managed by');
    }
  },
);

it.each(["BROKEN", "GOOD=1 %command% WINEPREFIX=bad", "GOOD='unclosed", 'CX_ENV=WINEPREFIX=bad'])(
  'rejects malformed or recursive CX_ENV: %s', async nested => {
    // The outer double quotes preserve inner single quotes for CX_ENV parsing.
    const launchOptions = `CX_ENV="${nested}" %command%`;
    await expect(prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, launchOptions }, '/unused', {}, {}, 'crossover')).rejects.toThrow();
  },
);

it('preserves ordinary quoted CX_ENV values and duplicate graphics assignments', async () => {
  const launchOptions = `CX_ENV="GRAPHICS=first GRAPHICS='two words' DXMT_ENABLE_NVEXT=9" %command%`;
  const launch = await prepareMacLaunchOptions('/unused', { ...defaultLaunchTools, launchOptions }, '/unused', {}, {}, 'crossover');
  expect(launch.environment.CX_ENV).toBe("GRAPHICS=first GRAPHICS='two words' DXMT_ENABLE_NVEXT=9 D3DM_ENABLE_METALFX=0 DXMT_ENABLE_NVEXT=0");
});
