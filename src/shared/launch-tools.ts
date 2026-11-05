import type { GameLaunchTools } from './types.js';

export const FH5_STORE_ID = '9NNX1VVR3KNQ';
export const supportsFH5PreviewPack = (storeId?: string): boolean => storeId?.toUpperCase() === FH5_STORE_ID;

export const defaultLaunchTools: GameLaunchTools = { fh5PreviewCompatibility: false, dualSenseCompatibility: false, offlineWithoutAntiCheat: false, metalHud: false, dlss: false, mangoHud: false, gamescope: false, gamescopeArgs: '', launchOptions: '' };

/** Command words only, never a shell program. Quotes group literal arguments. */
export function commandWords(input: string): string[] {
  if (input.length > 2048 || /[\r\n\0]/.test(input)) throw Error('Launch options must be a single line of at most 2048 characters.');
  const words: string[] = [];
  let word = '', quote = '', started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && quote !== "'") {
      if (++i === input.length) throw Error('Launch options end with an incomplete escape.');
      word += input[i]; started = true;
    } else if (quote) {
      if (c === quote) quote = ''; else word += c;
    } else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { words.push(word); word = ''; started = false; } }
    else {
      if (/[|&;<>()`$]/.test(c)) throw Error('Shell operators and substitutions are not supported in launch options.');
      word += c; started = true;
    }
  }
  if (quote) throw Error('Launch options contain an unclosed quote.');
  if (started) words.push(word);
  return words;
}

export function parseLaunchOptions(input: string): { environment: Record<string, string>; prefix: string[]; gameArgs: string[] } {
  const words = commandWords(input);
  const marker = words.indexOf('%command%');
  if (words.some((word, index) => word.includes('%command%') && index !== marker)) throw Error('Use %command% only once, as a separate word.');
  const prefix = marker < 0 ? words : words.slice(0, marker);
  const environment: Record<string, string> = Object.create(null);
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(prefix[0] ?? '')) {
    const assignment = prefix.shift()!, equals = assignment.indexOf('=');
    const name = assignment.slice(0, equals);
    if (/^(?:WINEPREFIX|WINEARCH|WINE_DLL_FILE_MAP|XODUS_.*|STEAM_COMPAT_.*)$/.test(name)) throw Error(`${name} is managed by Nexus and cannot be overridden in launch options.`);
    environment[name] = assignment.slice(equals + 1);
  }
  return { environment, prefix, gameArgs: marker < 0 ? [] : words.slice(marker + 1) };
}

export function normalizeLaunchTools(value: unknown): GameLaunchTools {
  if (value === undefined) return { ...defaultLaunchTools };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid game launch tools.');
  const tools = value as Record<string, unknown>;
  if (typeof tools.mangoHud !== 'boolean' || typeof tools.gamescope !== 'boolean' || typeof tools.gamescopeArgs !== 'string' || typeof tools.launchOptions !== 'string') throw Error('Invalid game launch tools.');
  if (tools.fh5PreviewCompatibility !== undefined && typeof tools.fh5PreviewCompatibility !== 'boolean') throw Error('Invalid FH5 Preview compatibility setting.');
  if (tools.dualSenseCompatibility !== undefined && typeof tools.dualSenseCompatibility !== 'boolean') throw Error('Invalid DualSense compatibility setting.');
  if (tools.offlineWithoutAntiCheat !== undefined && typeof tools.offlineWithoutAntiCheat !== 'boolean') throw Error('Invalid offline anti-cheat setting.');
  if (tools.metalHud !== undefined && typeof tools.metalHud !== 'boolean') throw Error('Invalid Metal HUD setting.');
  if (tools.dlss !== undefined && typeof tools.dlss !== 'boolean') throw Error('Invalid DLSS setting.');
  const executable = normalizeExecutableOverride(tools.executable);
  const result: GameLaunchTools = { fh5PreviewCompatibility: tools.fh5PreviewCompatibility ?? false, dualSenseCompatibility: tools.dualSenseCompatibility ?? false, offlineWithoutAntiCheat: tools.offlineWithoutAntiCheat ?? false, metalHud: tools.metalHud ?? false, dlss: tools.dlss ?? false, mangoHud: tools.mangoHud, gamescope: tools.gamescope, gamescopeArgs: tools.gamescopeArgs.trim(), launchOptions: tools.launchOptions.trim() };
  if (executable) result.executable = executable;
  const args = commandWords(result.gamescopeArgs);
  if (args.includes('--') || args.some(arg => arg.includes('%command%'))) throw Error('Gamescope options must not include -- or %command%; Nexus adds the game command.');
  parseLaunchOptions(result.launchOptions);
  return result;
}

/**
 * A per-game executable override is a package-relative Windows path to an .exe:
 * no drive, no absolute path, no `.` / `..` segments. Backslashes are accepted
 * and normalized to `/`; an empty value means "use the manifest entry".
 */
export function normalizeExecutableOverride(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw Error('Invalid executable override.');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 260 || /[\0-\x1f]/.test(trimmed)) throw Error('Invalid executable override.');
  const parts = trimmed.split(/[\\/]+/);
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw Error('Invalid executable override.');
  const normalized = parts.join('/');
  if (!/\.exe$/i.test(normalized)) throw Error('Invalid executable override.');
  return normalized;
}
