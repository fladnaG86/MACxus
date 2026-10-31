import { describe, expect, it } from 'vitest';
import { effectiveMacEngine, loadMacProfiles, macProfileFor, MAC_PROFILE_ENV_KEYS, parseMacProfiles } from './mac-profiles.js';

describe('parseMacProfiles', () => {
  it('keeps whitelisted env, the engine and the note', () => {
    const log: string[] = [];
    const profiles = parseMacProfiles({
      '9N4XW3N02MNJ': { engine: 'highball', env: { D3DM_VENDOR_ID: '0x10de', WINEMSYNC: '1' }, note: 'n' },
    }, (line) => log.push(line));
    expect(profiles['9N4XW3N02MNJ']).toEqual({ engine: 'highball', env: { D3DM_VENDOR_ID: '0x10de', WINEMSYNC: '1' }, note: 'n' });
    expect(log).toEqual([]);
  });

  it('drops keys outside the whitelist and invalid values, logging each', () => {
    const log: string[] = [];
    const profiles = parseMacProfiles({
      ABC: { env: { DYLD_INSERT_LIBRARIES: '/evil.dylib', D3DM_DEVICE_ID: '$(rm -rf ~)', D3DM_DEVICE_DESCRIPTION: 'NVIDIA GeForce RTX 4070', MTL_HUD_ENABLED: 'x'.repeat(65), WINEESYNC: '', ROSETTA_ADVERTISE_AVX: 1 } },
    }, (line) => log.push(line));
    expect(profiles.ABC.env).toEqual({ D3DM_DEVICE_DESCRIPTION: 'NVIDIA GeForce RTX 4070' });
    expect(log).toHaveLength(5);
    expect(log.join('\n')).toContain('DYLD_INSERT_LIBRARIES');
  });

  it('drops an unknown engine and non-object entries', () => {
    const log: string[] = [];
    const profiles = parseMacProfiles({ A: { engine: 'proton' }, B: 'nope', C: null }, (line) => log.push(line));
    expect(profiles.A).toEqual({ env: {} });
    expect(profiles.B).toBeUndefined();
    expect(profiles.C).toBeUndefined();
    expect(log.length).toBeGreaterThanOrEqual(3);
  });

  it('returns nothing for a malformed document', () => {
    expect(parseMacProfiles([], () => {})).toEqual({});
    expect(parseMacProfiles('x', () => {})).toEqual({});
  });

  it('exposes exactly the whitelist from the brief', () => {
    expect([...MAC_PROFILE_ENV_KEYS].sort()).toEqual(['D3DM_DEVICE_DESCRIPTION', 'D3DM_DEVICE_ID', 'D3DM_ENABLE_METALFX', 'D3DM_VENDOR_ID', 'HB_D3D12_TSSHIM', 'MTL_HUD_ENABLED', 'ROSETTA_ADVERTISE_AVX', 'WINEESYNC', 'WINEMSYNC']);
  });
});

describe('bundled mac-profiles.json', () => {
  it('seeds Forza Horizon 6 for both Store IDs with the NVIDIA identity on Highball, AVX off and the d3d12 shim on', async () => {
    const log: string[] = [];
    const profiles = await loadMacProfiles(undefined, (line) => log.push(line));
    expect(log).toEqual([]);
    for (const id of ['9N4XW3N02MNJ', '9NR1R1XWLCNB']) {
      expect(profiles[id]).toEqual({
        engine: 'highball',
        env: { D3DM_VENDOR_ID: '0x10de', D3DM_DEVICE_ID: '0x2786', D3DM_DEVICE_DESCRIPTION: 'NVIDIA GeForce RTX 4070', ROSETTA_ADVERTISE_AVX: '0', HB_D3D12_TSSHIM: '1' },
        note: 'Profilo da highball-db (CC0); AVX spento (con AVX esce prima di aprire la finestra); shim d3d12 per SV_ShadingRate su M1',
      });
    }
  });

  it('seeds Forza Horizon 5 with the NVIDIA identity on Highball and the d3d12 shim on', async () => {
    const profiles = await loadMacProfiles(undefined, () => {});
    expect(profiles['9NNX1VVR3KNQ']?.engine).toBe('highball');
    expect(profiles['9NNX1VVR3KNQ']?.env).toEqual({ D3DM_VENDOR_ID: '0x10de', D3DM_DEVICE_ID: '0x2786', D3DM_DEVICE_DESCRIPTION: 'NVIDIA GeForce RTX 4070', HB_D3D12_TSSHIM: '1' });
  });

  it('returns an empty set when the file is missing', async () => {
    expect(await loadMacProfiles('/nonexistent/mac-profiles.json', () => {})).toEqual({});
  });
});

describe('macProfileFor', () => {
  it('matches the Store ID case-insensitively', () => {
    const profiles = { '9N4XW3N02MNJ': { env: {} } };
    expect(macProfileFor(profiles, '9n4xw3n02mnj')).toBe(profiles['9N4XW3N02MNJ']);
    expect(macProfileFor(profiles, undefined)).toBeUndefined();
    expect(macProfileFor(profiles, 'OTHER')).toBeUndefined();
  });
});

describe('effectiveMacEngine', () => {
  it('honors an explicit Preview edition instead of silently using a recommended engine', () => {
    for (const setting of ['crossover-preview', 'crossover-preview-fex'] as const) {
      expect(effectiveMacEngine(setting, { engine: 'highball', env: {} }, { highball: true })).toBe(setting);
    }
  });
  const both = { crossover: true, highball: true };
  it('uses the global setting without a profile, defaulting to CrossOver', () => {
    expect(effectiveMacEngine(undefined, undefined, both)).toBe('crossover');
    expect(effectiveMacEngine('highball', undefined, both)).toBe('highball');
    expect(effectiveMacEngine('crossover', { env: {} }, both)).toBe('crossover');
  });
  it('lets the profile engine win only when that engine is installed', () => {
    expect(effectiveMacEngine('crossover', { engine: 'highball', env: {} }, both)).toBe('highball');
    expect(effectiveMacEngine('crossover', { engine: 'highball', env: {} }, { crossover: true, highball: false })).toBe('crossover');
    expect(effectiveMacEngine('highball', { engine: 'crossover', env: {} }, both)).toBe('crossover');
    expect(effectiveMacEngine('highball', { engine: 'crossover', env: {} }, { crossover: false, highball: true })).toBe('highball');
  });
});
