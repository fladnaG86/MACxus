import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { AuthBrowserNotFoundError, browserLaunch, findAuthBrowser } from './auth-browser';

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: probe }));
const flatpak = { kind: 'flatpak' as const, binary: '/usr/bin/flatpak', installation: '--user' as const, ref: 'app/com.google.Chrome/x86_64/stable' };
const hostProcess = process;
const available = new Set<string>();
beforeEach(() => {
  vi.stubGlobal('process', Object.create(hostProcess, { platform: { value: 'linux' } }));
  available.clear(); probe.mockReset();
  vi.spyOn(fs, 'stat').mockImplementation(async file => {
    if (!available.has(String(file))) throw Error('not installed');
    return { isFile: () => true } as any;
  });
  vi.spyOn(fs, 'access').mockResolvedValue(undefined);
  probe.mockImplementation((_binary, _args, _options, callback) => { callback(Error('not installed'), ''); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Chrome discovery', () => {
  it('prefers native Chrome without starting Flatpak', async () => {
    available.add('/usr/bin/google-chrome-stable'); available.add('/usr/bin/flatpak');
    expect(await findAuthBrowser({ PATH: '' })).toEqual({ kind: 'native', binary: '/usr/bin/google-chrome-stable' });
    expect(probe).not.toHaveBeenCalled();
  });
  it('allows executable native Chrome on an absolute PATH only', async () => {
    available.add('/custom/bin/google-chrome'); available.add('relative/google-chrome-stable');
    expect(await findAuthBrowser({ PATH: 'relative:/custom/bin' })).toEqual({ kind: 'native', binary: '/custom/bin/google-chrome' });
  });
  it('finds a user-installed Chrome by exact Flatpak ref', async () => {
    available.add('/usr/bin/flatpak');
    probe.mockImplementation((_binary, args, options, callback) => {
      expect(args).toEqual(['info', '--user', '--show-ref', 'com.google.Chrome']);
      expect(options).toMatchObject({ timeout: 3000, maxBuffer: 4096 });
      callback(null, flatpak.ref + '\n');
    });
    expect(await findAuthBrowser({ PATH: '' })).toEqual(flatpak);
  });
  it('falls back to the system installation without installing anything', async () => {
    available.add('/usr/bin/flatpak');
    probe.mockImplementation((_binary, args, _options, callback) => args.includes('--user') ? callback(Error('absent'), '') : callback(null, flatpak.ref));
    expect(await findAuthBrowser({ PATH: '' })).toEqual({ ...flatpak, installation: '--system' });
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it.each(['app/org.chromium.Chromium/x86_64/stable', 'app/com.google.Chrome/x86_64/beta', flatpak.ref + '\n--extra-argument', 'garbage'])('rejects an unexpected app or untrusted ref: %s', async ref => {
    available.add('/usr/bin/flatpak');
    probe.mockImplementation((_binary, _args, _options, callback) => callback(null, ref));
    await expect(findAuthBrowser({ PATH: '' })).rejects.toBeInstanceOf(AuthBrowserNotFoundError);
  });
  it('bounds lookup failures and reports missing Chrome accurately', async () => {
    available.add('/usr/bin/flatpak');
    await expect(findAuthBrowser({ PATH: '' })).rejects.toThrow('native or Flatpak from Discover');
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls.every(call => call[2].timeout === 3000)).toBe(true);
  });
  it('does not execute a missing or nonexecutable Flatpak', async () => {
    available.add('/usr/bin/flatpak');
    vi.mocked(fs.access).mockRejectedValue(Error('not executable'));
    await expect(findAuthBrowser({ PATH: '' })).rejects.toBeInstanceOf(AuthBrowserNotFoundError);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('Chrome launch isolation', () => {
  it('preserves native fd3/fd4 transport with a dedicated profile', () => {
    const launch = browserLaunch({ kind: 'native', binary: '/usr/bin/google-chrome' }, '/tmp/private');
    expect(launch).toMatchObject({ command: '/usr/bin/google-chrome', input: 3, output: 4 });
    expect(launch.args).toContain('--remote-debugging-pipe');
    expect(launch.args).toContain('--user-data-dir=/tmp/private/profile');
    expect(launch.args).not.toContain('--headless=new');
  });
  it('uses only temporary filesystem permission and stdin/stdout across Flatpak', () => {
    const profile = "/tmp/nexus auth's $literal";
    const launch = browserLaunch(flatpak, profile);
    expect(launch).toMatchObject({ command: '/usr/bin/flatpak', input: 0, output: 1 });
    expect(launch.args.slice(0, 4)).toEqual(['run', '--user', '--die-with-parent', '--filesystem=' + profile]);
    expect(launch.args.filter(arg => arg.startsWith('--filesystem='))).toEqual(['--filesystem=' + profile]);
    expect(launch.args).toContain('--env=XDG_CONFIG_HOME=' + profile + '/config');
    expect(launch.args).toContain('--env=XDG_CACHE_HOME=' + profile + '/cache');
    expect(launch.args).toContain('--env=XDG_DATA_HOME=' + profile + '/data');
    expect(launch.args).toContain('--env=TMPDIR=' + profile + '/tmp');
    expect(launch.args[launch.args.indexOf('-c') + 1]).toBe('exec /app/bin/chrome "$@" 3<&0 4>&1 </dev/null >/dev/null');
    expect(launch.args).toContain('--user-data-dir=' + profile + '/profile');
    expect(launch.args).toContain('--remote-debugging-pipe');
    expect(launch.args.some(arg => /--no-sandbox|remote-debugging-port|--forward-fd|--filesystem=host/.test(arg))).toBe(false);
  });
  it('retains the selected installation and enables headless mode only for tests', () => {
    const launch = browserLaunch({ ...flatpak, installation: '--system' }, '/tmp/private', true);
    expect(launch.args).toContain('--system'); expect(launch.args).toContain('--headless=new');
  });
});
