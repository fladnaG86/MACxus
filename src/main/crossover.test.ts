import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as processes from './process.js';
import { MAC_RUNTIME_DLLS, bundledRuntimeDllDirectory, crossOverWrapperScript, findCrossOver, installRuntimeDlls, prepareCrossOverRunner, runtimeOverrideDirectory, stripBuiltinMarker, type CrossOverInstall } from './crossover.js';

const temporary: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-cx-'));
  temporary.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const MARKER = Buffer.from('Wine builtin DLL');
function dll(marked: boolean): Buffer {
  const bytes = Buffer.alloc(128, 0x41);
  if (marked) MARKER.copy(bytes, 64);
  return bytes;
}

async function fakeInstall(base: string, log: string): Promise<CrossOverInstall> {
  const root = path.join(base, 'CrossOver.app/Contents/SharedSupport/CrossOver');
  await mkdir(path.join(root, 'bin'), { recursive: true });
  const script = (body: string) => `#!/bin/sh\n${body}\n`;
  await writeFile(path.join(root, 'bin/cxbottle'), script(`echo "cxbottle $*" >> '${log}'\nb="$CX_BOTTLE_PATH/xbox"\nmkdir -p "$b/drive_c/windows/system32"\n: > "$b/system.reg"`), { mode: 0o755 });
  await writeFile(path.join(root, 'bin/wine'), script(`echo "wine $*" >> '${log}'`), { mode: 0o755 });
  await writeFile(path.join(root, 'bin/wineserver'), script(`echo "wineserver $*" >> '${log}'`), { mode: 0o755 });
  return { root, wine: path.join(root, 'bin/wine'), wineserver: path.join(root, 'bin/wineserver'), cxbottle: path.join(root, 'bin/cxbottle'), version: '26.3' };
}

describe('stripBuiltinMarker', () => {
  it('zeroes only bytes 64..80 when the marker is present', () => {
    const input = dll(true);
    const out = stripBuiltinMarker(input);
    expect(out).not.toBe(input);
    expect(out.subarray(64, 80).equals(Buffer.alloc(16))).toBe(true);
    expect(out.subarray(0, 64).equals(input.subarray(0, 64))).toBe(true);
    expect(out.subarray(80).equals(input.subarray(80))).toBe(true);
    expect(input.subarray(64, 80).equals(MARKER)).toBe(true);
  });
  it('leaves an unmarked buffer identical', () => {
    const input = dll(false);
    expect(stripBuiltinMarker(input).equals(input)).toBe(true);
  });
});

describe('crossOverWrapperScript', () => {
  it('exports the bottle environment and handles launch, wait and stop', () => {
    const cx = { root: '/cx', wine: '/cx/bin/wine', wineserver: '/cx/bin/wineserver', cxbottle: '/cx/bin/cxbottle', version: '26.3' };
    const script = crossOverWrapperScript(cx, '/b', 'xbox', 'd3dmetal');
    expect(script).toContain("export CX_BOTTLE_PATH='/b'");
    expect(script).toContain('CX_GRAPHICS_BACKEND');
    expect(script).toContain('--nexus-stop-prefix');
    expect(script).toContain('-k');
    expect(script).toContain('-w');
    expect(script).toContain("'/cx/bin/wine' --bottle 'xbox' \"$@\"");
  });
});

describe('findCrossOver', () => {
  it('returns undefined when nothing is installed', async () => {
    expect(await findCrossOver([await tmp()])).toBeUndefined();
  });
  it('finds executables and reads the version through the native plist utility', async () => {
    const base = await tmp();
    const cx = await fakeInstall(base, path.join(base, 'log'));
    await writeFile(path.join(base, 'CrossOver.app/Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>26.3</string></dict></plist>');
    const reader = vi.spyOn(processes, 'run').mockResolvedValue({ code: 0, output: '26.3\n' });
    try {
      expect(await findCrossOver([path.join(base, 'missing'), cx.root])).toEqual(cx);
      expect(reader).toHaveBeenCalledWith('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(cx.root, '..', '..', 'Info.plist')]);
    } finally { reader.mockRestore(); }
  });
});

it.runIf(process.platform === 'darwin')('reads an actual macOS plist with the native plutil executable', async () => {
  const base = await tmp();
  const cx = await fakeInstall(base, path.join(base, 'log'));
  await writeFile(path.join(base, 'CrossOver.app/Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>26.3</string></dict></plist>');
  expect(await findCrossOver([cx.root])).toEqual(cx);
});

describe('prepareCrossOverRunner', () => {
  it('creates the bottle once, installs stripped DLLs and sets overrides', async () => {
    const base = await tmp();
    const log = path.join(base, 'log');
    const cx = await fakeInstall(base, log);
    const bottles = path.join(base, 'bottles');
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll(true));

    const first = await prepareCrossOverRunner(cx, bottles, runtime);
    const second = await prepareCrossOverRunner(cx, bottles, runtime);

    const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
    expect(calls.filter((line) => line.startsWith('cxbottle') && line.includes('--create'))).toHaveLength(1);
    expect(calls.filter((line) => line.includes('reg add'))).toHaveLength(MAC_RUNTIME_DLLS.length);
    expect(calls.find((line) => line.includes('xgameruntime'))).toContain('native,builtin');
    for (const name of MAC_RUNTIME_DLLS) {
      const copied = await readFile(path.join(bottles, 'xbox/drive_c/windows/system32', name));
      expect(copied.subarray(64, 80).equals(Buffer.alloc(16))).toBe(true);
    }
    expect(first).toEqual(second);
    expect(first.command).toBe(path.join(bottles, 'xodus-crossover-wine'));
    expect(first.compatibilityDataPath).toBe(path.join(bottles, 'xbox'));
    expect(first.stopPrefix).toEqual({ command: first.command, args: ['--nexus-stop-prefix'] });
    await chmod(first.command, 0o700);
    expect(await readFile(first.command, 'utf8')).toContain('CX_BOTTLE_PATH');
  });

  it('skips reg add when nothing changed and the marker is current', async () => {
    const base = await tmp();
    const log = path.join(base, 'log');
    const cx = await fakeInstall(base, log);
    const bottles = path.join(base, 'bottles');
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll(true));
    await prepareCrossOverRunner(cx, bottles, runtime);
    await writeFile(log, '');
    await prepareCrossOverRunner(cx, bottles, runtime);
    expect((await readFile(log, 'utf8')).split('\n').filter((line) => line.includes('reg add'))).toHaveLength(0);
  });

  it('retries all overrides after a failed attempt and then writes the marker', async () => {
    const base = await tmp();
    const log = path.join(base, 'log');
    const cx = await fakeInstall(base, log);
    const bottles = path.join(base, 'bottles');
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll(true));
    const flag = path.join(base, 'fail');
    await writeFile(flag, '');
    await writeFile(cx.wine, `#!/bin/sh\necho "wine $*" >> '${log}'\nif [ -e '${flag}' ]; then exit 1; fi\n`, { mode: 0o755 });
    await expect(prepareCrossOverRunner(cx, bottles, runtime)).rejects.toThrow();
    const marker = path.join(bottles, 'xbox/.macxus-overrides');
    await expect(readFile(marker, 'utf8')).rejects.toThrow();
    await rm(flag);
    await writeFile(log, '');
    await prepareCrossOverRunner(cx, bottles, runtime);
    expect((await readFile(log, 'utf8')).split('\n').filter((line) => line.includes('reg add'))).toHaveLength(MAC_RUNTIME_DLLS.length);
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual([...MAC_RUNTIME_DLLS].sort());
  });
});

describe('installRuntimeDlls overrides', () => {
  async function setup() {
    const base = await tmp();
    const runtime = path.join(base, 'runtime');
    const overrides = runtimeOverrideDirectory(base);
    const prefix = path.join(base, 'prefix');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll(true));
    return { base, runtime, overrides, prefix };
  }
  const system32 = (prefix: string, name: string) => path.join(prefix, 'drive_c/windows/system32', name);

  it('places the override dir under the data root', () => {
    expect(runtimeOverrideDirectory('/data')).toBe('/data/runtime-overrides');
  });

  it('takes a DLL from the override dir when present, stripped, and logs it in Italian', async () => {
    const { runtime, overrides, prefix } = await setup();
    await mkdir(overrides);
    const patched = Buffer.concat([dll(true), Buffer.from('patched')]);
    await writeFile(path.join(overrides, 'xgameruntime.dll'), patched);
    const logs: string[] = [];
    const changed = await installRuntimeDlls(prefix, { dir: runtime, overrideDir: overrides }, (line) => logs.push(line));
    expect(changed).toEqual([...MAC_RUNTIME_DLLS]);
    const copied = await readFile(system32(prefix, 'xgameruntime.dll'));
    expect(copied.subarray(128).toString()).toBe('patched');
    expect(copied.subarray(64, 80).equals(Buffer.alloc(16))).toBe(true);
    expect((await readFile(system32(prefix, 'windows.web.dll'))).length).toBe(128);
    expect(logs).toEqual([`DLL del runtime sostituite da ${overrides}: xgameruntime.dll.`]);
  });

  it('uses the runtime copies and logs nothing when the override dir is missing', async () => {
    const { runtime, overrides, prefix } = await setup();
    const logs: string[] = [];
    await installRuntimeDlls(prefix, { dir: runtime, overrideDir: overrides }, (line) => logs.push(line));
    expect((await readFile(system32(prefix, 'xgameruntime.dll'))).length).toBe(128);
    expect(logs).toEqual([]);
  });

  it('reinstalls the runtime copy once the override is removed', async () => {
    const { runtime, overrides, prefix } = await setup();
    await mkdir(overrides);
    await writeFile(path.join(overrides, 'xgameruntime.dll'), Buffer.concat([dll(true), Buffer.from('patched')]));
    await installRuntimeDlls(prefix, { dir: runtime, overrideDir: overrides });
    await rm(path.join(overrides, 'xgameruntime.dll'));
    expect(await installRuntimeDlls(prefix, { dir: runtime, overrideDir: overrides })).toEqual(['xgameruntime.dll']);
    expect((await readFile(system32(prefix, 'xgameruntime.dll'))).length).toBe(128);
  });

  it('passes the override through prepareCrossOverRunner and re-applies the reg overrides', async () => {
    const { base, runtime, overrides } = await setup();
    const log = path.join(base, 'log');
    const cx = await fakeInstall(base, log);
    const bottles = path.join(base, 'bottles');
    await prepareCrossOverRunner(cx, bottles, { dir: runtime, overrideDir: overrides });
    await mkdir(overrides);
    await writeFile(path.join(overrides, 'xgameruntime.dll'), Buffer.concat([dll(true), Buffer.from('patched')]));
    await writeFile(log, '');
    const logs: string[] = [];
    await prepareCrossOverRunner(cx, bottles, { dir: runtime, overrideDir: overrides }, 'd3dmetal', (line) => logs.push(line));
    expect((await readFile(path.join(bottles, 'xbox/drive_c/windows/system32/xgameruntime.dll'))).subarray(128).toString()).toBe('patched');
    expect((await readFile(log, 'utf8')).split('\n').filter((line) => line.includes('reg add'))).toHaveLength(MAC_RUNTIME_DLLS.length);
    expect(logs.join('\n')).toContain('xgameruntime.dll');
  });
});

describe('bundled MACxus runtime DLLs', () => {
  const RUNTIME = 'xodus-nexus-runtime-11.0-20261022-gf4adc821';
  async function setup(release = RUNTIME) {
    const base = await tmp();
    const runtime = path.join(base, 'releases', release, 'files', 'lib', 'wine', 'x86_64-windows');
    const bundled = path.join(base, 'bundled');
    const overrides = runtimeOverrideDirectory(base);
    const prefix = path.join(base, 'prefix');
    await mkdir(runtime, { recursive: true });
    await mkdir(bundled);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll(true));
    await writeFile(path.join(bundled, 'manifest.json'), JSON.stringify({ runtime: RUNTIME }));
    await writeFile(path.join(bundled, 'xgameruntime.dll'), Buffer.concat([dll(true), Buffer.from('bundled')]));
    return { base, runtime, bundled, overrides, prefix };
  }
  const system32 = (prefix: string, name: string) => path.join(prefix, 'drive_c/windows/system32', name);

  it('uses the bundled DLLs only for the runtime release they were built against', async () => {
    const { runtime, bundled } = await setup();
    expect(await bundledRuntimeDllDirectory(runtime, bundled)).toBe(bundled);
    const other = await setup('xodus-nexus-runtime-11.0-20261101-gdeadbee');
    expect(await bundledRuntimeDllDirectory(other.runtime, other.bundled)).toBeUndefined();
  });

  it('treats a missing or broken manifest as no bundled DLLs', async () => {
    const { runtime, bundled } = await setup();
    await writeFile(path.join(bundled, 'manifest.json'), '{');
    expect(await bundledRuntimeDllDirectory(runtime, bundled)).toBeUndefined();
    expect(await bundledRuntimeDllDirectory(runtime, path.join(bundled, 'missing'))).toBeUndefined();
  });

  it('prefers the user override, then the bundled copy, then the runtime', async () => {
    const { runtime, bundled, overrides, prefix } = await setup();
    await writeFile(path.join(bundled, 'winhttp.dll'), Buffer.concat([dll(true), Buffer.from('bundled')]));
    await mkdir(overrides);
    await writeFile(path.join(overrides, 'winhttp.dll'), Buffer.concat([dll(true), Buffer.from('user')]));
    const logs: string[] = [];
    await installRuntimeDlls(prefix, { dir: runtime, overrideDir: overrides, bundledDir: bundled }, (line) => logs.push(line));
    expect((await readFile(system32(prefix, 'winhttp.dll'))).subarray(128).toString()).toBe('user');
    expect((await readFile(system32(prefix, 'xgameruntime.dll'))).subarray(128).toString()).toBe('bundled');
    expect((await readFile(system32(prefix, 'windows.web.dll'))).length).toBe(128);
    expect(logs).toEqual([`DLL del runtime sostituite da ${overrides}: winhttp.dll.`, 'DLL patchate di MACxus: xgameruntime.dll.']);
  });
});
