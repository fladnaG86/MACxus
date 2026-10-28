import { describe, expect, it } from 'vitest';
import { gameLaunchArguments, preparedGameWine } from './game-launch.js';
import { LINUX_RUN_PATCH } from './backend.js';

describe('generic package launch', () => {
  it('keeps the prepared Proton prefix runner when no launch tools are enabled', () => {
    const wine = preparedGameWine({ command: '/compat/pfx-runner' }, '/runtime/wine');
    expect(gameLaunchArguments({ path: '/package', executable: 'Dungeons.exe' }, wine, '', LINUX_RUN_PATCH)[2])
      .toBe('/compat/pfx-runner');
  });
  it('uses the prepared game runner for tools and the configured wrapper without Proton', () => {
    expect(preparedGameWine({ command: '/compat/pfx-runner', launchCommand: '/compat/game-runner' }, '/tools/wrapper'))
      .toBe('/compat/game-runner');
    expect(preparedGameWine(undefined, '/tools/wrapper')).toBe('/tools/wrapper');
  });
  it.each(['start_protected_game.exe', 'Dungeons.exe', 'FSD/Binaries/WinGDK/Shipping.exe', 'Game.exe'])(
    'uses the manifest entry and the same launch policy for %s', (executable) => {
      const args = gameLaunchArguments({ path: '/package', executable }, '/runtime/wine', 'US', LINUX_RUN_PATCH);
      expect(args).toEqual(['run', '/package', '/runtime/wine', '--exe', executable, '--materialize-chain', '--market', 'US']);
      expect(args).not.toContain('--materialize-exe');
    },
  );
  it('does not let EAC metadata, title or legacy profile fields override the manifest', () => {
    const game = { path: '/package', executable: 'Launcher.exe', title: 'Any title',
      antiCheat: { executable: 'HiddenGame.exe' }, launchSupport: 'offline-only-eac', winePath: '/old/per-game/wine' };
    expect(gameLaunchArguments(game, '/shared/wine', '', LINUX_RUN_PATCH))
      .toEqual(['run', '/package', '/shared/wine', '--exe', 'Launcher.exe', '--materialize-chain']);
  });
  it('fails closed on an old backend or a missing manifest entry', () => {
    expect(() => gameLaunchArguments({ path: '/package', executable: 'Game.exe' }, '/wine', '', 'old')).toThrow('Update the backend');
    expect(() => gameLaunchArguments({ path: '/package' }, '/wine', '', LINUX_RUN_PATCH)).toThrow('manifest has no launch executable');
  });
});

describe('backend compatibility tag', () => {
  it('keeps the Linux tag and gives macOS its own, so a backend built before the macOS fix asks for a rebuild', async () => {
    const { backendCompatibility } = await import('./backend.js');
    const { backendLock } = await import('./backend-package.js');
    expect(backendCompatibility('linux')).toBe(backendLock.compatibility);
    expect(backendCompatibility('linux')).toBe('linux-run-v22');
    expect(backendCompatibility('darwin')).toBe('macos-run-v2');
    expect(backendLock.patchId).toBe('linux-run-v44');
    if (process.platform === 'darwin') {
      expect(LINUX_RUN_PATCH).toBe('macos-run-v2');
      expect(() => gameLaunchArguments({ path: '/package', executable: 'Game.exe' }, '/wine', '', 'linux-run-v22')).toThrow('current managed Xodus backend');
    }
  });
});

describe('per-game executable override', () => {
  it('launches the override instead of the manifest entry and keeps the rest of the policy', () => {
    const game = { path: '/package', executable: 'Launcher.exe', launchTools: { ...{ mangoHud: false, gamescope: false, gamescopeArgs: '', launchOptions: '' }, executable: 'Binaries/WinGDK/Game-WinGDK-Shipping.exe' } };
    expect(gameLaunchArguments(game, '/wine', 'US', LINUX_RUN_PATCH))
      .toEqual(['run', '/package', '/wine', '--exe', 'Binaries/WinGDK/Game-WinGDK-Shipping.exe', '--materialize-chain', '--market', 'US']);
  });
  it('falls back to the manifest entry when the override is unset', () => {
    const game = { path: '/package', executable: 'Launcher.exe', launchTools: { mangoHud: false, gamescope: false, gamescopeArgs: '', launchOptions: '' } };
    expect(gameLaunchArguments(game, '/wine', '', LINUX_RUN_PATCH)[4]).toBe('Launcher.exe');
  });
});
