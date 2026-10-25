import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: execute }));
import { openDesktopTarget } from './desktop-open.js';

const session = { XDG_CURRENT_DESKTOP: 'gamescope', GTK_IM_MODULE: 'simple', XODUS_NEXUS_STEAM_IME: '1' };
const hostProcess = process;
beforeEach(() => { vi.stubGlobal('process', Object.create(hostProcess, { platform: { value: 'linux' } })); execute.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe('external desktop input environment', () => {
  it('keeps Electron shell behavior outside the fallback, including error results', async () => {
    const fallback = vi.fn(async () => 'existing shell error');
    expect(await openDesktopTarget('/unused', fallback, { GTK_IM_MODULE: 'ibus' })).toBe('existing shell error');
    expect(fallback).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["/tmp/folder with 'quote and $literal", 'https://example.com/?literal=$value&x=1'])
  ('opens a literal target with the original IME, not launcher settings: %s', async target => {
    execute.mockImplementation((_command, _args, _options, callback) => callback(null));
    const fallback = vi.fn();
    await openDesktopTarget(target, fallback, session);
    expect(execute).toHaveBeenCalledWith('xdg-open', [target], {
      env: { XDG_CURRENT_DESKTOP: 'gamescope', GTK_IM_MODULE: 'Steam' }, maxBuffer: 16_384,
    }, expect.any(Function));
    expect(fallback).not.toHaveBeenCalled();
    expect(session.GTK_IM_MODULE).toBe('simple');
  });
  it('surfaces opener failure without trying a second potentially duplicate launch', async () => {
    execute.mockImplementation((_command, _args, _options, callback) => callback(new Error('private helper output')));
    const fallback = vi.fn();
    await expect(openDesktopTarget('/tmp/item', fallback, session)).rejects.toThrow('system application');
    expect(fallback).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });
});
