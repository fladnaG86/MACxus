import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAC_RUNTIME_DLLS } from './crossover.js';
import {
  HIGHBALL_ENGINE_ASSET, HIGHBALL_ENGINE_RELEASE, HIGHBALL_ENGINE_SHA256_ASSET, HIGHBALL_ENGINE_SIZE, HIGHBALL_ENGINE_TAG,
  HIGHBALL_FRAMEWORKS, highballEngineInstalled, installHighballEngineOverrides, highballWrapperScript, installHighballEngine, prepareHighballRunner, type HighballRelease,
} from './highball-engine.js';

const temporary: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-hb-'));
  temporary.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Builds a tiny tarball with the real release layout (./engine/...). */
async function fakeTarball(base: string, complete = true): Promise<Buffer> {
  const tree = path.join(base, 'tree');
  await mkdir(path.join(tree, 'engine/bin'), { recursive: true });
  await mkdir(path.join(tree, 'engine/lib/wine/x86_64-windows'), { recursive: true });
  await mkdir(path.join(tree, 'frameworks'), { recursive: true });
  await writeFile(path.join(tree, 'engine/bin/wine'), '#!/bin/sh\necho wine-11.0\n', { mode: 0o755 });
  await writeFile(path.join(tree, 'engine/bin/wineserver'), '#!/bin/sh\n', { mode: 0o755 });
  if (complete) await writeFile(path.join(tree, 'engine/lib/wine/x86_64-windows/kernelbase.dll'), 'MZ');
  const file = path.join(base, 'engine.tar.gz');
  execFileSync('tar', ['-czf', file, '-C', tree, '.']);
  return readFile(file);
}

function release(bytes: Buffer, overrides: Partial<HighballRelease> = {}): HighballRelease {
  return { ...HIGHBALL_ENGINE_RELEASE, size: bytes.length, sha256: sha(bytes), frameworks: undefined, ...overrides };
}

const FRAMEWORKS_ASSET = HIGHBALL_FRAMEWORKS.url.slice(HIGHBALL_FRAMEWORKS.url.lastIndexOf('/') + 1);
const GSTREAMER_LIB = 'frameworks/GStreamer.framework/Versions/1.0/lib/libgstreamer-1.0.0.dylib';

/** A tiny .tar.xz shaped like the runtime template: <subpath>/GStreamer.framework/... plus a dylib. */
async function fakeFrameworks(base: string, complete = true): Promise<Buffer> {
  const tree = path.join(base, 'fw-tree');
  const frameworks = path.join(tree, HIGHBALL_FRAMEWORKS.subpath);
  await mkdir(path.join(frameworks, 'GStreamer.framework/Versions/1.0/lib'), { recursive: true });
  await writeFile(path.join(frameworks, 'libglib-2.0.0.dylib'), 'glib');
  if (complete) await writeFile(path.join(frameworks, 'GStreamer.framework/Versions/1.0/lib/libgstreamer-1.0.0.dylib'), 'gst');
  const file = path.join(base, 'frameworks.tar.xz');
  // The pinned framework archive names its app directory directly. GNU tar
  // distinguishes that from a leading './' when extracting a named subtree.
  execFileSync('tar', ['-cJf', file, '-C', tree, HIGHBALL_FRAMEWORKS.subpath.split('/')[0]]);
  return readFile(file);
}

function withFrameworks(rel: HighballRelease, bytes: Buffer, overrides: Partial<HighballRelease['frameworks'] & object> = {}): HighballRelease {
  return { ...rel, frameworks: { ...HIGHBALL_FRAMEWORKS, size: bytes.length, sha256: sha(bytes), ...overrides } };
}

function fetcherFor(files: Record<string, Buffer | string>, seen: string[] = []) {
  return async (url: string) => {
    seen.push(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    const body = files[name];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200, headers: { 'content-length': String(Buffer.byteLength(body)) } });
  };
}

describe('pinned Highball release', () => {
  it('names the verified tag, assets and size', () => {
    expect(HIGHBALL_ENGINE_TAG).toBe('engine-wine-11.0-20261014T003801Z-0024-app-packages-0023-spatial-mixer');
    expect(HIGHBALL_ENGINE_ASSET).toBe(`${HIGHBALL_ENGINE_TAG}.tar.gz`);
    expect(HIGHBALL_ENGINE_SHA256_ASSET).toBe(`${HIGHBALL_ENGINE_TAG}.tar.gz.sha256`);
    expect(HIGHBALL_ENGINE_SIZE).toBe(334_884_359);
    expect(HIGHBALL_ENGINE_RELEASE.baseUrl).toBe(`https://github.com/gauthierpiarrette/highball-engine/releases/download/${HIGHBALL_ENGINE_TAG}`);
  });

  it('pins the runtime frameworks Highball installs beside the engine', () => {
    expect(HIGHBALL_ENGINE_RELEASE.frameworks).toBe(HIGHBALL_FRAMEWORKS);
    expect(HIGHBALL_FRAMEWORKS).toEqual({
      url: 'https://github.com/Sikarugir-App/Wrapper/releases/download/v1.0/Template-1.0.11.tar.xz',
      size: 84_533_420,
      sha256: '9fa15479e7ff6abd99c1d07be285fb95f41fc6991586502427152b1f7d6ccb8a',
      subpath: 'Template-1.0.11.app/Contents/Frameworks',
    });
  });
});

describe('highballEngineInstalled', () => {
  it('is undefined until wine, wineserver and kernelbase.dll exist', async () => {
    const data = await tmp();
    expect(highballEngineInstalled(data)).toBeUndefined();
    const root = path.join(data, 'engines/highball', HIGHBALL_ENGINE_TAG);
    await mkdir(path.join(root, 'engine/bin'), { recursive: true });
    await writeFile(path.join(root, 'engine/bin/wine'), '');
    await writeFile(path.join(root, 'engine/bin/wineserver'), '');
    expect(highballEngineInstalled(data)).toBeUndefined();
    await mkdir(path.join(root, 'engine/lib/wine/x86_64-windows'), { recursive: true });
    await writeFile(path.join(root, 'engine/lib/wine/x86_64-windows/kernelbase.dll'), '');
    expect(highballEngineInstalled(data)).toBeUndefined();
    await mkdir(path.dirname(path.join(root, GSTREAMER_LIB)), { recursive: true });
    await writeFile(path.join(root, GSTREAMER_LIB), '');
    expect(highballEngineInstalled(data)).toBe(root);
  });
});

describe('installHighballEngine', () => {
  it('downloads, verifies, extracts and atomically installs the engine', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const seen: string[] = [];
    const progress: number[] = [];
    const rel = release(tarball);
    const root = await installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  ${HIGHBALL_ENGINE_ASSET}\n`,
    }, seen), (downloaded) => progress.push(downloaded), rel);
    expect(root).toBe(path.join(data, 'engines/highball', HIGHBALL_ENGINE_TAG));
    expect(highballEngineInstalled(data, rel)).toBe(root);
    expect(seen).toContain(`${rel.baseUrl}/${HIGHBALL_ENGINE_ASSET}`);
    expect(seen).toContain(`${rel.baseUrl}/${HIGHBALL_ENGINE_SHA256_ASSET}`);
    expect(progress.at(-1)).toBe(tarball.length);
    expect(await readdir(path.join(data, 'engines/highball'))).toEqual([HIGHBALL_ENGINE_TAG]);
  });

  it('rejects a tarball whose sha256 differs from the published .sha256 and installs nothing', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const wrong = 'a'.repeat(64);
    await expect(installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${wrong}  ${HIGHBALL_ENGINE_ASSET}\n`,
    }), undefined, release(tarball, { sha256: wrong }))).rejects.toThrow(/SHA-256/);
    expect(highballEngineInstalled(data)).toBeUndefined();
    expect(await readdir(path.join(data, 'engines/highball')).catch(() => [])).toEqual([]);
  });

  it('rejects a published checksum that differs from the pinned one', async () => {
    const base = await tmp();
    const tarball = await fakeTarball(base);
    await expect(installHighballEngine(path.join(base, 'data'), fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${'b'.repeat(64)}  ${HIGHBALL_ENGINE_ASSET}\n`,
    }), undefined, release(tarball))).rejects.toThrow(/checksum/i);
  });

  it('rejects an unexpected size before extracting', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    await expect(installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n`,
    }), undefined, release(tarball, { size: tarball.length + 1 }))).rejects.toThrow(/dimensione/i);
    expect(highballEngineInstalled(data)).toBeUndefined();
  });

  it('reports an HTTP failure in Italian', async () => {
    const base = await tmp();
    await expect(installHighballEngine(path.join(base, 'data'), fetcherFor({}), undefined, release(Buffer.from('x'))))
      .rejects.toThrow(/Download del motore Highball non riuscito/);
  });

  it('rejects an archive without the expected engine layout', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base, false);
    await expect(installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n`,
    }), undefined, release(tarball))).rejects.toThrow(/incompleto/);
    expect(highballEngineInstalled(data)).toBeUndefined();
  });

  it('installs the runtime frameworks into the engine root after the engine', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const frameworks = await fakeFrameworks(base);
    const seen: string[] = [];
    const rel = withFrameworks(release(tarball), frameworks);
    const root = await installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n`,
      [FRAMEWORKS_ASSET]: frameworks,
    }, seen), undefined, rel);
    expect(seen).toContain(HIGHBALL_FRAMEWORKS.url);
    expect(await readFile(path.join(root, GSTREAMER_LIB), 'utf8')).toBe('gst');
    expect(await readFile(path.join(root, 'frameworks/libglib-2.0.0.dylib'), 'utf8')).toBe('glib');
    expect(highballEngineInstalled(data, rel)).toBe(root);
    expect(await readdir(path.join(data, 'engines/highball'))).toEqual([HIGHBALL_ENGINE_TAG]);
  });

  it('adds only the frameworks to an engine installed without them', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const frameworks = await fakeFrameworks(base);
    await installHighballEngine(data, fetcherFor({ [HIGHBALL_ENGINE_ASSET]: tarball, [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n` }), undefined, release(tarball));
    const rel = withFrameworks(release(tarball), frameworks);
    expect(highballEngineInstalled(data, rel)).toBeUndefined();
    const seen: string[] = [];
    const root = await installHighballEngine(data, fetcherFor({ [FRAMEWORKS_ASSET]: frameworks }, seen), undefined, rel);
    expect(seen).toEqual([HIGHBALL_FRAMEWORKS.url]);
    expect(highballEngineInstalled(data, rel)).toBe(root);
  });

  it('rejects frameworks whose sha256 differs and leaves them uninstalled', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const frameworks = await fakeFrameworks(base);
    const rel = withFrameworks(release(tarball), frameworks, { sha256: 'c'.repeat(64) });
    await expect(installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n`,
      [FRAMEWORKS_ASSET]: frameworks,
    }), undefined, rel)).rejects.toThrow(/SHA-256/);
    expect(highballEngineInstalled(data, rel)).toBeUndefined();
    expect((await readdir(path.join(data, 'engines/highball'))).filter((name) => name.startsWith('.'))).toEqual([]);
  });

  it('rejects a frameworks archive without GStreamer', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const frameworks = await fakeFrameworks(base, false);
    await expect(installHighballEngine(data, fetcherFor({
      [HIGHBALL_ENGINE_ASSET]: tarball,
      [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n`,
      [FRAMEWORKS_ASSET]: frameworks,
    }), undefined, withFrameworks(release(tarball), frameworks))).rejects.toThrow(/incomplet/);
  });

  it('returns the existing install without downloading again', async () => {
    const base = await tmp();
    const data = path.join(base, 'data');
    const tarball = await fakeTarball(base);
    const files = { [HIGHBALL_ENGINE_ASSET]: tarball, [HIGHBALL_ENGINE_SHA256_ASSET]: `${sha(tarball)}  x\n` };
    await installHighballEngine(data, fetcherFor(files), undefined, release(tarball));
    const seen: string[] = [];
    await installHighballEngine(data, fetcherFor(files, seen), undefined, release(tarball));
    expect(seen).toEqual([]);
  });
});

describe('highballWrapperScript', () => {
  const script = highballWrapperScript('/Data Root/engine root', '/Apps/Cross Over/apple_gptk', '/Apps/Cross Over/lib64', "/b/xbox-highball's", { D3DM_VENDOR_ID: '0x10de', D3DM_DEVICE_DESCRIPTION: 'NVIDIA GeForce RTX 4070' });

  it('exports the prefix and the D3DMetal wiring with shell quoting', () => {
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain(`export WINEPREFIX='/b/xbox-highball'"'"'s'`);
    expect(script).toContain("export WINEDLLPATH_PREPEND='/Apps/Cross Over/apple_gptk/wine'");
    expect(script).toContain("export CX_D3DMETALPATH='/Apps/Cross Over/apple_gptk/external'");
    expect(script).toContain(`export DYLD_FALLBACK_LIBRARY_PATH='/Apps/Cross Over/apple_gptk/external:/Data Root/engine root/frameworks:/Data Root/engine root/frameworks/GStreamer.framework/Versions/1.0/lib:/Apps/Cross Over/lib64:'"\${DYLD_FALLBACK_LIBRARY_PATH:-/usr/local/lib:/usr/lib}"`);
    expect(script).toContain(`export DYLD_FALLBACK_FRAMEWORK_PATH='/Apps/Cross Over/apple_gptk/external:/Data Root/engine root/frameworks:'"\${DYLD_FALLBACK_FRAMEWORK_PATH:-/Library/Frameworks:/System/Library/Frameworks}"`);
  });

  it('points GStreamer at the engine runtime plugins with a registry inside the prefix', () => {
    expect(script).toContain("export GST_PLUGIN_SYSTEM_PATH='/Data Root/engine root/frameworks/GStreamer.framework/Versions/1.0/lib/gstreamer-1.0'");
    expect(script).toContain(`export GST_REGISTRY='/b/xbox-highball'"'"'s/.gstreamer-registry.x86_64.bin'`);
  });

  it('defaults msync on and esync off unless already set, and adds profile env the same way', () => {
    expect(script).toContain(`export WINEMSYNC="\${WINEMSYNC:-1}"`);
    expect(script).toContain(`export WINEESYNC="\${WINEESYNC:-0}"`);
    expect(script).toContain(`export D3DM_VENDOR_ID="\${D3DM_VENDOR_ID:-0x10de}"`);
    expect(script).toContain(`export D3DM_DEVICE_DESCRIPTION="\${D3DM_DEVICE_DESCRIPTION:-NVIDIA GeForce RTX 4070}"`);
  });

  it('advertises AVX under Rosetta by default like CrossOver, and 0 unsets it', () => {
    expect(script).toContain(`export ROSETTA_ADVERTISE_AVX="\${ROSETTA_ADVERTISE_AVX:-1}"`);
    expect(script).toContain('if [ "$ROSETTA_ADVERTISE_AVX" = 0 ]; then unset ROSETTA_ADVERTISE_AVX; fi');
  });

  it('launches with the engine wine, waits on wineserver and has a stop branch', () => {
    expect(script).toContain('if [ "${1:-}" = "--nexus-stop-prefix" ]; then');
    expect(script).toContain("  exec '/Data Root/engine root/engine/bin/wineserver' -k");
    expect(script).toContain(`'/Data Root/engine root/engine/bin/wine' "$@" || launch_status=$?`);
    expect(script).toContain(`'/Data Root/engine root/engine/bin/wineserver' -w || wait_status=$?`);
    expect(script).toContain('if [ "$launch_status" -ne 0 ]; then exit "$launch_status"; fi');
    expect(script.indexOf('--nexus-stop-prefix')).toBeGreaterThan(script.indexOf('WINEPREFIX'));
  });

  it('ignores env keys that are not valid shell names and values outside the safe set', () => {
    const unsafe = highballWrapperScript('/e', '/g', '/l', '/p', { 'A;rm -rf /': 'x', SAFE_KEY: '$(touch /tmp/x)', QUOTE: 'a"b' });
    expect(unsafe).not.toContain('rm -rf');
    expect(unsafe).not.toContain('touch');
    expect(unsafe).not.toContain('QUOTE');
  });
});

const MARKER = Buffer.from('Wine builtin DLL');
function dll(): Buffer { const bytes = Buffer.alloc(128, 0x41); MARKER.copy(bytes, 64); return bytes; }

async function fakeEngine(base: string, log: string): Promise<string> {
  const root = path.join(base, 'engine root');
  await mkdir(path.join(root, 'engine/bin'), { recursive: true });
  // The fake wineboot creates system.reg the way wineserver does when it flushes the registry.
  await writeFile(path.join(root, 'engine/bin/wine'), `#!/bin/sh\necho "wine $* PREFIX=$WINEPREFIX" >> '${log}'\nif [ "$1" = "wineboot" ]; then mkdir -p "$WINEPREFIX/drive_c/windows/system32"; : > "$WINEPREFIX/system.reg"; fi\n`, { mode: 0o755 });
  await writeFile(path.join(root, 'engine/bin/wineserver'), `#!/bin/sh\necho "wineserver $*" >> '${log}'\n`, { mode: 0o755 });
  return root;
}

describe('prepareHighballRunner', () => {
  it('creates the separate prefix once, installs stripped DLLs, sets overrides and writes the wrapper', async () => {
    const base = await tmp();
    const log = path.join(base, 'log');
    const engine = await fakeEngine(base, log);
    const bottles = path.join(base, 'bottles');
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll());

    const first = await prepareHighballRunner(engine, '/gptk', '/gptk-lib64', bottles, runtime, { D3DM_VENDOR_ID: '0x10de' });
    const second = await prepareHighballRunner(engine, '/gptk', '/gptk-lib64', bottles, runtime, { D3DM_VENDOR_ID: '0x10de' });

    const prefix = path.join(bottles, 'xbox-highball');
    const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
    expect(calls.filter((line) => line.startsWith('wine wineboot -u'))).toHaveLength(1);
    expect(calls.find((line) => line.startsWith('wine wineboot'))).toContain(`PREFIX=${prefix}`);
    const regAdds = calls.filter((line) => line.includes('reg add'));
    expect(regAdds).toHaveLength(MAC_RUNTIME_DLLS.length);
    expect(regAdds[0]).toContain('native,builtin');
    expect(regAdds[0]).toContain(`PREFIX=${prefix}`);
    expect(regAdds[0]).not.toContain('--bottle');
    for (const name of MAC_RUNTIME_DLLS) {
      const copied = await readFile(path.join(prefix, 'drive_c/windows/system32', name));
      expect(copied.subarray(64, 80).equals(Buffer.alloc(16))).toBe(true);
    }
    expect((await readFile(path.join(prefix, '.macxus-overrides'), 'utf8')).trim().split('\n')).toEqual([...MAC_RUNTIME_DLLS].sort());
    expect(first).toEqual(second);
    expect(first.command).toBe(path.join(bottles, 'xodus-highball-wine'));
    expect(first.compatibilityDataPath).toBe(prefix);
    expect(first.stopPrefix).toEqual({ command: first.command, args: ['--nexus-stop-prefix'] });
    expect((await stat(first.command)).mode & 0o777).toBe(0o700);
    const wrapper = await readFile(first.command, 'utf8');
    expect(wrapper).toContain("CX_D3DMETALPATH='/gptk/external'");
    expect(wrapper).toContain('D3DM_VENDOR_ID');
    expect(wrapper).toContain("/gptk-lib64:");
    // The CrossOver bottle is never touched.
    await expect(stat(path.join(bottles, 'xbox'))).rejects.toThrow();
  }, 30_000);

  async function prepareWithLib64(lib64: string, logs: string[]): Promise<void> {
    const base = await tmp();
    const engine = await fakeEngine(base, path.join(base, 'log'));
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll());
    await prepareHighballRunner(engine, '/gptk', lib64, path.join(base, 'bottles'), runtime, {}, (line) => logs.push(line));
  }

  it('warns in Italian but continues when CrossOver has no libgnutls.30.dylib', async () => {
    const lib64 = path.join(await tmp(), 'lib64');
    await mkdir(lib64);
    const logs: string[] = [];
    await prepareWithLib64(lib64, logs);
    expect(logs).toEqual(['GnuTLS non trovato: le connessioni sicure (servizi online) potrebbero non funzionare con il motore Highball.']);
  }, 30_000);

  it('does not warn when libgnutls.30.dylib is present', async () => {
    const lib64 = path.join(await tmp(), 'lib64');
    await mkdir(lib64);
    await writeFile(path.join(lib64, 'libgnutls.30.dylib'), 'x');
    const logs: string[] = [];
    await prepareWithLib64(lib64, logs);
    expect(logs).toEqual([]);
  }, 30_000);

  it('applies the engine overrides before writing the wrapper', async () => {
    const base = await tmp();
    const engine = await fakeEngine(base, path.join(base, 'log'));
    const lib = path.join(engine, 'engine/lib/wine/x86_64-windows');
    await mkdir(lib, { recursive: true });
    await writeFile(path.join(lib, 'winegstreamer.dll'), 'stock');
    const overrides = path.join(base, 'highball-overrides');
    await mkdir(overrides);
    await writeFile(path.join(overrides, 'winegstreamer.dll'), 'patched');
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll());
    await prepareHighballRunner(engine, '/gptk', '/gptk-lib64', path.join(base, 'bottles'), runtime, {}, () => undefined, overrides);
    expect(await readFile(path.join(lib, 'winegstreamer.dll'), 'utf8')).toBe('patched');
  });

  it('reports a prefix that wineboot did not create', async () => {
    const base = await tmp();
    const log = path.join(base, 'log');
    const engine = await fakeEngine(base, log);
    await writeFile(path.join(engine, 'engine/bin/wine'), `#!/bin/sh\necho "boom"\nexit 3\n`, { mode: 0o755 });
    const runtime = path.join(base, 'runtime');
    await mkdir(runtime);
    for (const name of MAC_RUNTIME_DLLS) await writeFile(path.join(runtime, name), dll());
    await expect(prepareHighballRunner(engine, '/gptk', '/gptk-lib64', path.join(base, 'bottles'), runtime, {})).rejects.toThrow(/prefisso Highball/);
  }, 30_000);
});

describe('installHighballEngineOverrides', () => {
  async function setup() {
    const base = await tmp();
    const engine = path.join(base, 'engine root');
    const lib = path.join(engine, 'engine/lib/wine/x86_64-windows');
    const prefix = path.join(base, 'prefix');
    const system32 = path.join(prefix, 'drive_c/windows/system32');
    const overrides = path.join(base, 'highball-overrides');
    await mkdir(lib, { recursive: true });
    await mkdir(system32, { recursive: true });
    await mkdir(overrides);
    await writeFile(path.join(lib, 'winegstreamer.dll'), 'stock gst');
    await writeFile(path.join(system32, 'winegstreamer.dll'), 'stock gst');
    await writeFile(path.join(lib, 'mfplat.dll'), 'stock mfplat');
    return { engine, lib, prefix, system32, overrides };
  }

  it('replaces the engine builtin and the prefix copy, keeping the original once', async () => {
    const { engine, lib, prefix, system32, overrides } = await setup();
    await writeFile(path.join(overrides, 'winegstreamer.dll'), 'patched gst');
    const logs: string[] = [];
    expect(await installHighballEngineOverrides(engine, prefix, overrides, (line) => logs.push(line))).toEqual(['winegstreamer.dll']);
    expect(await readFile(path.join(lib, 'winegstreamer.dll'), 'utf8')).toBe('patched gst');
    expect(await readFile(path.join(system32, 'winegstreamer.dll'), 'utf8')).toBe('patched gst');
    expect(await readFile(path.join(engine, 'overrides-original/winegstreamer.dll'), 'utf8')).toBe('stock gst');
    expect(await readFile(path.join(lib, 'mfplat.dll'), 'utf8')).toBe('stock mfplat');
    expect(logs.join('\n')).toContain('winegstreamer.dll');
    expect(await installHighballEngineOverrides(engine, prefix, overrides)).toEqual([]);
    expect(await readFile(path.join(engine, 'overrides-original/winegstreamer.dll'), 'utf8')).toBe('stock gst');
  });

  it('does not create a prefix copy the prefix did not have', async () => {
    const { engine, prefix, system32, overrides } = await setup();
    await writeFile(path.join(overrides, 'mfplat.dll'), 'patched mfplat');
    expect(await installHighballEngineOverrides(engine, prefix, overrides)).toEqual(['mfplat.dll']);
    await expect(stat(path.join(system32, 'mfplat.dll'))).rejects.toThrow();
  });

  it('restores the original when the override is removed', async () => {
    const { engine, lib, prefix, system32, overrides } = await setup();
    await writeFile(path.join(overrides, 'winegstreamer.dll'), 'patched gst');
    await installHighballEngineOverrides(engine, prefix, overrides);
    await rm(path.join(overrides, 'winegstreamer.dll'));
    expect(await installHighballEngineOverrides(engine, prefix, overrides)).toEqual(['winegstreamer.dll']);
    expect(await readFile(path.join(lib, 'winegstreamer.dll'), 'utf8')).toBe('stock gst');
    expect(await readFile(path.join(system32, 'winegstreamer.dll'), 'utf8')).toBe('stock gst');
    await expect(stat(path.join(engine, 'overrides-original/winegstreamer.dll'))).rejects.toThrow();
  });

  it('ignores DLLs the engine does not ship and a missing override folder', async () => {
    const { engine, lib, prefix, overrides } = await setup();
    await writeFile(path.join(overrides, 'notawinedll.dll'), 'x');
    const logs: string[] = [];
    expect(await installHighballEngineOverrides(engine, prefix, overrides, (line) => logs.push(line))).toEqual([]);
    await expect(stat(path.join(lib, 'notawinedll.dll'))).rejects.toThrow();
    expect(logs.join('\n')).toContain('notawinedll.dll');
    expect(await installHighballEngineOverrides(engine, prefix, path.join(overrides, 'missing'))).toEqual([]);
  });
});
