import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoSnapshot } from '../shared/demo-data.js';
import { StateStore } from './store.js';

// Run the real IPC/admission/download lifecycle with synthetic child processes.
// No account, executable, network, installed game or production profile is used.
const h = vi.hoisted(() => ({
  root: '', wine: '', backend: {} as any, runtime: {} as any,
  handlers: new Map<string, (...args: any[]) => any>(),
  events: new Map<string, (...args: any[]) => any>(),
  downloads: [] as { args: string[]; progress: (paused?: boolean, phase?: string) => void; finish: (code: number) => void }[],
  game: undefined as undefined | { finish: () => void },
  quit: vi.fn(),
  blockDisplay: vi.fn(() => 7), releaseDisplay: vi.fn(() => true),
  steamProfiles: [] as string[], steamIsRunning: true,
  liveImport: vi.fn(), offlineImport: vi.fn(), showMessage: vi.fn(),
  showSave: vi.fn(),
  trash: vi.fn(), deleteFiles: vi.fn(), removeShortcut: vi.fn(async () => {}), signals: [] as string[],
  notifications: [] as { title: string; body: string }[],
  holdCancellation: false,
  holdAccountReads: false,
  accountReads: [] as ((result: { code: number; output: string }) => void)[],
  posters: vi.fn(async (ids: string[]) => new Map(ids.map(id => [id, `https://store-images.s-microsoft.com/${id}`]))),
}));
vi.mock('electron', () => ({
  Notification: class { static isSupported() { return true; } constructor(private options: { title: string; body: string }) {} on() {} show() { h.notifications.push(this.options); } },
  app: { requestSingleInstanceLock: () => true, getPath: (name: string) => path.join(h.root, name),
    setPath: vi.fn(), on: (name: string, callback: (...args: any[]) => any) => h.events.set(name, callback), once: vi.fn(),
    whenReady: () => Promise.resolve(), getVersion: () => '0.0.0', isPackaged: false, quit: h.quit },
  ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => h.handlers.set(name, callback) },
  BrowserWindow: class { webContents = { on: vi.fn(), send: vi.fn(), setWindowOpenHandler: vi.fn() };
    on() {} once() {} show() {} focus() {} isDestroyed() { return false; } async loadFile() {} },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
  dialog: { showMessageBox: h.showMessage, showSaveDialog: h.showSave }, nativeImage: {}, shell: { trashItem: h.trash }, powerSaveBlocker: { start: h.blockDisplay, stop: h.releaseDisplay },
}));
vi.mock('./backend.js', () => ({ LINUX_RUN_PATCH: 'test-patch', BackendManager: class {
  get current() { return h.backend; } async refresh() {} async checkUpdate() {} async externalDownloadRunning() { return false; }
  setExternalRoot() {} } }));
vi.mock('./runtime.js', () => ({ RuntimeManager: class { get current() { return h.runtime; } async refresh() {} async checkNexus() {} setRoot() {} } }));
vi.mock('./catalog.js', () => ({ CatalogService: class { async artwork() { return new Map(); } posters = h.posters; } }));
vi.mock('./account-profile.js', () => ({ AccountProfile: class { async select() {} cancel() {} } }));
vi.mock('./launcher-update.js', () => ({ LauncherUpdater: class { state = {}; async initialize() {} async check() {} cancel() {} } }));
vi.mock('./launcher-fonts.js', () => ({ adoptLauncherFonts: () => undefined, externalFontEnvironment: (env: unknown) => env }));
// Deletion is restricted to disposable fixture directories, never real games.
vi.mock('./game-delete.js', () => ({ deleteGameDirectory: (target: { path: string }) => h.deleteFiles(target.path) }));
vi.mock('./session-environment.js', () => ({ prepareGameModeKeyring: async () => 'skipped' }));
vi.mock('./game-shortcuts.js', () => ({ shortcutArguments: () => ({}), shortcutInstanceData: () => ({}), shortcutInstanceRequest: () => ({}),
  GameShortcuts: class { async initialize() {} remove = h.removeShortcut; async steamDesktop() { return { file: path.join(h.root, 'game.desktop'),
    launch: { icon: h.wine, title: 'Sample game', executable: '/bin/sh', options: 'fixture', directory: h.root, identity: 'fixture' } }; } } }));
vi.mock('./steam-shortcuts.js', async original => ({ ...await original<typeof import('./steam-shortcuts.js')>(),
  steamAccounts: async () => h.steamProfiles, steamRunning: async () => h.steamIsRunning, addSteamShortcut: h.offlineImport }));
vi.mock('./steam-live.js', () => ({ addLiveSteamShortcut: h.liveImport }));
vi.mock('./shortcut-icon.js', () => ({ loadShortcutIcon: async () => undefined }));
vi.mock('./steam-artwork.js', () => ({ gameSteamPortrait: async (bytes: Buffer) => bytes, nexusSteamArtwork: async (bytes: Buffer) => ({ cover: bytes, wide: bytes }) }));
vi.mock('./install-plan.js', () => ({ readInstallPlan: async () => ({}), installSelection: () => '11111111-1111-4111-8111-111111111111' }));
vi.mock('./xodus-service.js', () => ({ cloudSaveRuntime: async () => false, unbridgedCloudSaveRuntime: async () => false,
  selectedWinePath: () => h.wine, storeContentRuntime: async () => false, startXodusService: vi.fn() }));
vi.mock('./proton.js', () => ({ prepareProtonRunner: async () => undefined, syncPrefixUserLocale: async () => {}, syncUnrealCultureGameIni: async () => {} }));
vi.mock('./game-wrapper.js', () => ({ prepareGameWrapper: async () => ({ command: h.wine, cleanup: async () => {} }) }));
vi.mock('./process.js', () => ({
  run: async (_command: string, args: string[]) => ({ code: 0, output: args[0] === 'account' ? JSON.stringify({ stored: true, username: 'sample@example.test' }) : '' }),
  spawnTracked: (_command: string, args: string[], options: any) => {
    if (args[0] === 'account') return {
      child: { kill: vi.fn(() => true) },
      result: h.holdAccountReads
        ? new Promise<{ code: number; output: string }>(resolve => { h.accountReads.push(resolve); })
        : Promise.resolve({ code: 0, output: JSON.stringify({ stored: true, username: 'sample@example.test' }) }),
    };
    let resolve!: (result: { code: number; output: string }) => void, sequence = 0;
    const result = new Promise<{ code: number; output: string }>(done => { resolve = done; });
    const progress = (paused = false, phase = 'downloading') => options.onLine('NEXUS_PROGRESS ' + JSON.stringify({ schema: 1, event: 'progress', sequence: sequence++, phase,
      completedBytes: phase === 'complete' ? 100 : 20, totalBytes: 100, bytesPerSecond: 10, paused, canPause: phase === 'downloading' }));
    h.downloads.push({ args, progress, finish: code => resolve({ code, output: '' }) });
    return { child: { stdin: { on() {}, write: (line: string) => progress(JSON.parse(line).command === 'pause') }, kill: (signal: string) => { h.signals.push(signal); if (!h.holdCancellation) resolve({ code: 130, output: '' }); return true; } }, result };
  },
}));
vi.mock('./game-process.js', () => ({ spawnGameProcess: async () => {
  let resolve!: (result: { code: number; output: string }) => void;
  const result = new Promise<{ code: number; output: string }>(done => { resolve = done; });
  h.game = { finish: () => resolve({ code: 0, output: '' }) };
  return { child: {}, result, cleanup: async () => {}, stop: async () => resolve({ code: 0, output: '' }), forceStop: async () => {} };
} }));

const ipc = (name: string, ...args: any[]) => h.handlers.get(name)!(undefined, ...args);
const snapshot = () => ipc('get-snapshot');
// Queue advancement includes serialized atomic state writes. Give those I/O
// boundaries a bounded budget on busy CI hosts without relaxing their order.
const waitForQueue = (count: number) => vi.waitFor(() => expect(h.downloads).toHaveLength(count), { timeout: 5_000, interval: 20 });
const install = (letter: string, destination = path.join(h.root, `download-${letter}`)) => ipc('start-install', { productId: `9${letter.repeat(11)}`, title: `Sample ${letter}`, destination });

const hostProcess = process;
beforeAll(async () => {
  // This fixture provides a Linux Proton runner and Steam adapter, not CrossOver.
  vi.stubGlobal('process', Object.create(hostProcess, { platform: { value: 'linux' }, arch: { value: 'x64' } }));
  h.root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-install-integration-'));
  h.wine = path.join(h.root, 'runtime', 'wine'); await fs.mkdir(path.dirname(h.wine)); await fs.writeFile(h.wine, 'fixture', { mode: 0o700 });
  const data = demoSnapshot(); h.backend = { ...data.backend, capabilities: { ...data.backend.capabilities, packageSelection: true }, binaryPath: path.join(h.root, 'synthetic-cli'), linuxRunPatch: 'test-patch' }; h.runtime = data.runtime;
  const store = new StateStore(path.join(h.root, 'userData'));
  await store.setSettings({ firstRunCompleted: true, market: 'US', runtimeRoot: path.join(h.root, 'runtime'), winePath: h.wine });
  const gamePath = path.join(h.root, 'installed-game'); await fs.mkdir(gamePath);
  await fs.writeFile(path.join(gamePath, 'MicrosoftGame.config'), '<Game><ShellVisuals DefaultDisplayName="Sample game"/><ExecutableList><Executable Name="Game.exe"/></ExecutableList><StoreId>9ZZZZZZZZZZZ</StoreId></Game>');
  await fs.writeFile(path.join(gamePath, 'Game.exe'), 'MZ fixture');
  await fs.writeFile(path.join(gamePath, '.xodus-streaming.msixvc'), 'synthetic container');
  await store.upsertGame({ ...data.games[0], id: 'sample', path: gamePath, storeId: '9ZZZZZZZZZZZ', executable: 'Game.exe', installState: 'ready' });
  for (const id of ['remove-library', 'remove-delete', 'remove-fail', 'remove-playing-other']) {
    const directory = path.join(h.root, id); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game/>');
    await fs.writeFile(path.join(directory, 'keep.txt'), 'synthetic game files');
    await store.upsertGame({ ...data.games[0], id, path: directory, installState: 'ready' });
  }
  h.deleteFiles.mockImplementation(async (directory: string) => {
    if (path.dirname(directory) !== h.root) throw Error('Fixture refuses a non-test path');
    await fs.rm(directory, { recursive: true, force: false });
  });
  await import('./index.js');
  await vi.waitFor(() => expect(h.handlers.has('start-install')).toBe(true));
});
afterAll(async () => {
  h.game?.finish(); for (const job of h.downloads) job.finish(130);
  await new Promise(resolve => setTimeout(resolve, 50));
  await fs.rm(h.root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

it('diagnostic IPC previews without a save/upload, saves exactly reviewed text and honors cancellation', async () => {
  const downloadsBefore = h.downloads.length;
  const report = await ipc('create-diagnostic-report');
  expect(report.content).toContain('Launcher: 0.0.0'); expect(report.content).toContain('Backend:');
  expect(report.content).not.toContain('sample@example.test');
  expect(h.showSave).not.toHaveBeenCalled(); expect(h.downloads).toHaveLength(downloadsBefore);
  await expect(ipc('create-diagnostic-report', '../private')).rejects.toThrow('Game not found');
  h.showSave.mockResolvedValueOnce({ canceled: true });
  expect(await ipc('save-diagnostic-report', 'edited report')).toBe(false);
  const file = path.join(h.root, 'reviewed-report.txt');
  h.showSave.mockResolvedValueOnce({ canceled: false, filePath: file });
  expect(await ipc('save-diagnostic-report', 'reviewed text only')).toBe(true);
  expect(await fs.readFile(file, 'utf8')).toBe('reviewed text only');
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  const calls = h.showSave.mock.calls.length;
  await expect(ipc('save-diagnostic-report', { content: 'invalid' })).rejects.toThrow('Invalid');
  expect(h.showSave).toHaveBeenCalledTimes(calls);
});

it('real account-refresh IPC shares status reads and cannot publish a late old backend response', async () => {
  const backend = h.backend;
  h.holdAccountReads = true; h.accountReads = [];
  const old = ipc('account-refresh'), repeated = ipc('account-refresh');
  try {
    await vi.waitFor(() => expect(h.accountReads).toHaveLength(1));
    h.backend = { ...backend, binaryPath: path.join(h.root, 'new-synthetic-cli') };
    const current = ipc('account-refresh');
    await vi.waitFor(() => expect(h.accountReads).toHaveLength(2));
    h.accountReads[1]({ code: 0, output: JSON.stringify({ stored: true, username: 'sample@example.test' }) });
    await current;
    h.accountReads[0]({ code: 0, output: JSON.stringify({ stored: false }) });
    await Promise.all([old, repeated]);
    expect(snapshot().auth.stored).toBe(true);
    expect(snapshot().auth.username).toBe('sample@example.test');
  } finally {
    for (const resolve of h.accountReads) resolve({ code: 0, output: JSON.stringify({ stored: false }) });
    h.backend = backend; h.holdAccountReads = false;
    await ipc('account-refresh');
  }
});

it('passes all native profiles to Steam-owned live import without login preferences, preserving offline choice', async () => {
  const native = ['123', '456'].map(id => path.join(h.root, 'Steam/userdata', id, 'config'));
  const flatpak = path.join(h.root, '.var/app/com.valvesoftware.Steam/userdata/789/config');
  h.steamProfiles = [...native, flatpak]; h.liveImport.mockResolvedValue('live-uri');
  expect(await ipc('add-to-steam', 'sample')).toBe('live-uri');
  expect(h.showMessage).not.toHaveBeenCalled();
  expect(h.liveImport.mock.calls[0][0]).toEqual(native);
  const choose = h.liveImport.mock.calls[0][6];
  h.showMessage.mockResolvedValueOnce({ response: 1 });
  expect(await choose(native)).toBe(native[1]);
  h.showMessage.mockResolvedValueOnce({ response: 2 });
  expect(await choose(native)).toBeUndefined();
  h.showMessage.mockResolvedValueOnce({ response: 3 });
  await expect(choose(native)).rejects.toThrow('cancelled');
  h.steamIsRunning = false; h.offlineImport.mockResolvedValue('offline-uri');
  h.showMessage.mockResolvedValueOnce({ response: 1 });
  expect(await ipc('add-to-steam', 'sample')).toBe('offline-uri');
  expect(h.offlineImport.mock.calls[0][0]).toBe(native[1]);
  h.steamIsRunning = true; h.steamProfiles = [flatpak];
  await expect(ipc('add-to-steam', 'sample')).rejects.toThrow('Flatpak');
  expect(h.liveImport).toHaveBeenCalledOnce();
});

it('removes only unrelated games while downloading, without interrupting the queue', async () => {
  const active = await install('Q'), queued = await install('R');
  await waitForQueue(1);
  await vi.waitFor(() => {
    expect(snapshot().downloads.find((task: any) => task.id === queued)?.coverUrl).toBe('https://store-images.s-microsoft.com/9RRRRRRRRRRR');
    expect(snapshot().downloads.find((task: any) => task.id === active)?.coverUrl).toBe('https://store-images.s-microsoft.com/9QQQQQQQQQQQ');
  });
  expect(h.downloads).toHaveLength(1); // Waiting artwork never starts its process.
  h.downloads[0].progress();
  await ipc('pause-download', active);
  const downloadsBefore = structuredClone(snapshot().downloads);
  await ipc('remove-game', 'remove-library', 'library');
  expect(await fs.readFile(path.join(h.root, 'remove-library/keep.txt'), 'utf8')).toBe('synthetic game files');
  expect(h.trash).not.toHaveBeenCalled();
  expect(h.deleteFiles).not.toHaveBeenCalled();
  await expect(ipc('remove-game', 'remove-fail', 'trash-files')).rejects.toThrow('Invalid removal option');
  expect(h.deleteFiles).not.toHaveBeenCalled();

  h.deleteFiles.mockRejectedValueOnce(Error('Synthetic deletion failure'));
  await expect(ipc('remove-game', 'remove-fail', 'delete-files')).rejects.toThrow('Synthetic deletion failure');
  expect(snapshot().games.some((game: any) => game.id === 'remove-fail')).toBe(true);
  expect(await fs.readFile(path.join(h.root, 'remove-fail/keep.txt'), 'utf8')).toBe('synthetic game files');

  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  h.deleteFiles.mockImplementationOnce(async (directory: string) => {
    entered(); await gate;
    await fs.rm(directory, { recursive: true, force: false });
  });
  const removing = ipc('remove-game', 'remove-delete', 'delete-files');
  await ready;
  try {
    await expect(install('S')).rejects.toThrow('being removed');
    await expect(ipc('launch-game', 'sample')).rejects.toThrow('being removed');
    await expect(ipc('remove-game', 'remove-fail', 'library')).rejects.toThrow('being removed');
    await expect(ipc('update-settings', { runtimeRoot: path.join(h.root, 'other-runtime') })).rejects.toThrow('being removed');
    await ipc('resume-download', active);
    expect(snapshot().downloads.find((task: any) => task.id === active).status).toBe('running');
  } finally { release(); }
  await removing;
  expect(h.deleteFiles).toHaveBeenLastCalledWith(path.join(h.root, 'remove-delete'));
  await expect(fs.access(path.join(h.root, 'remove-delete'))).rejects.toThrow();
  expect(h.trash).not.toHaveBeenCalled();
  expect(h.removeShortcut).toHaveBeenCalledWith('remove-library');
  expect(h.removeShortcut).toHaveBeenCalledWith('remove-delete');
  expect(h.signals).toEqual([]);
  expect(h.downloads).toHaveLength(1);
  expect(snapshot().downloads.find((task: any) => task.id === queued).status).toBe('queued');
  expect(snapshot().downloads.map((task: any) => task.id)).toEqual(downloadsBefore.map((task: any) => task.id));
  expect(snapshot().games.some((game: any) => ['remove-library', 'remove-delete'].includes(game.id))).toBe(false);
  const persisted = new StateStore(path.join(h.root, 'userData')); await persisted.load();
  expect(persisted.games.some(game => ['remove-library', 'remove-delete'].includes(game.id))).toBe(false);
  await ipc('remove-game', 'remove-fail', 'library'); // Failed deletion released the admission lock.
  await ipc('cancel-download', queued); h.downloads[0].finish(1);
  await vi.waitFor(() => expect(snapshot().downloads.find((task: any) => task.id === active).status).toBe('failed'));
  h.downloads.splice(0);
  expect(h.notifications).toEqual([]);
});

it.skipIf(hostProcess.platform !== 'linux')('offers cleanup only for a new folder and waits for process exit before deleting it', async () => {
  const id = await install('X'); await waitForQueue(1);
  const task = snapshot().downloads.find((task: any) => task.id === id), partial = path.join(task.destination, 'part.bin');
  await fs.writeFile(partial, 'disposable'); expect(await ipc('download-cancel-options', id)).toEqual({ deleteFilesAllowed: true });
  h.holdCancellation = true; const count = h.signals.length, pending = ipc('cancel-download', id, 'delete-files');
  try {
    await vi.waitFor(() => expect(h.signals.length).toBe(count + 1));
    expect(snapshot().downloads.find((task: any) => task.id === id).cancelling).toBe(true);
    expect(await fs.readFile(partial, 'utf8')).toBe('disposable');
    await expect(install('Y')).rejects.toThrow('being cancelled');
    await expect(ipc('import-game', task.destination)).rejects.toThrow('being cancelled');
    await expect(ipc('remove-download', id)).rejects.toThrow('cancellation cleanup');
    await expect(ipc('cancel-download', id, 'keep')).rejects.toThrow('already being cancelled');
    h.downloads[0].progress(); expect(await fs.readFile(partial, 'utf8')).toBe('disposable');
  } finally { h.holdCancellation = false; h.downloads[0].finish(130); }
  await pending;
  await expect(fs.access(task.destination)).rejects.toThrow();
  expect(snapshot().downloads.find((task: any) => task.id === id)).toMatchObject({ status: 'cancelled', phase: 'Cancelled; downloaded files were deleted.' });
  h.downloads.splice(0);
});

it('keeps new partials by default and refuses deletion of an existing folder or an update', async () => {
  const id = await install('U'); await waitForQueue(1);
  const directory = snapshot().downloads.find((task: any) => task.id === id).destination;
  await fs.writeFile(path.join(directory, 'keep'), 'partial'); await ipc('cancel-download', id);
  expect(await fs.readFile(path.join(directory, 'keep'), 'utf8')).toBe('partial'); h.downloads.splice(0);
  const existing = path.join(h.root, 'pre-existing-folder'); await fs.mkdir(existing); await fs.writeFile(path.join(existing, 'original'), 'existing files');
  const next = await install('V', existing); await waitForQueue(1);
  expect((await ipc('download-cancel-options', next)).deleteFilesAllowed).toBe(false);
  const signals = h.signals.length; await expect(ipc('cancel-download', next, 'delete-files')).rejects.toThrow('Existing or untracked');
  expect(h.signals.length).toBe(signals); expect(await fs.readFile(path.join(existing, 'original'), 'utf8')).toBe('existing files');
  await ipc('cancel-download', next, 'keep'); h.downloads.splice(0);
  const update = await ipc('update-installed-game', 'sample'); await waitForQueue(1);
  expect((await ipc('download-cancel-options', update)).deleteFilesAllowed).toBe(false);
  await expect(ipc('cancel-download', update, 'delete-files')).rejects.toThrow('Updates and DLC');
  expect(await fs.readFile(path.join(h.root, 'installed-game/Game.exe'), 'utf8')).toBe('MZ fixture');
  await ipc('cancel-download', update, 'keep'); h.downloads.splice(0);
  await expect(ipc('cancel-download', update, 'invalid')).rejects.toThrow('Invalid cancellation');
});

it('runs real queue IPC, pause/cancel/failure/restart and simultaneous play/download safely', async () => {
  const first = await install('A'); await waitForQueue(1);
  expect(h.blockDisplay).not.toHaveBeenCalled();
  await ipc('launch-game', 'sample'); expect(snapshot().gameOperation.status).toBe('running');
  for (const mode of ['library', 'delete-files']) await expect(ipc('remove-game', 'sample', mode)).rejects.toThrow('Close this game');
  await ipc('remove-game', 'remove-playing-other', 'library');
  expect(snapshot().gameOperation.status).toBe('running');
  expect(h.blockDisplay).toHaveBeenCalledWith('prevent-display-sleep');
  const cancel = await install('B'), next = await install('C');
  expect(h.downloads).toHaveLength(1); expect(snapshot().downloads.find((task: any) => task.id === next).status).toBe('queued');
  await expect(install('C')).rejects.toThrow('already in');
  await expect(install('D', path.join(h.root, 'installed-game', 'nested'))).rejects.toThrow('overlaps');
  await expect(ipc('update-installed-game', 'sample')).rejects.toThrow('Another Xodus');
  await expect(ipc('update-settings', { market: 'GB' })).rejects.toThrow('Another Xodus');
  await ipc('cancel-download', cancel); h.downloads[0].finish(1);
  await waitForQueue(2);
  expect(h.downloads[1].args[1]).toBe('9CCCCCCCCCCC');
  expect(snapshot().downloads.find((task: any) => task.id === first).status).toBe('failed');
  h.downloads[1].progress(); await ipc('pause-download', next);
  expect(snapshot().downloads.find((task: any) => task.id === next).status).toBe('paused');
  const fourth = await install('D'); expect(h.downloads).toHaveLength(2);
  await ipc('resume-download', next); h.downloads[1].progress(false, 'complete'); h.downloads[1].finish(0);
  await waitForQueue(3);
  expect(h.notifications).toHaveLength(1);
  expect(h.notifications[0]).toMatchObject({ title: 'Download complete', body: 'Sample C has finished downloading.' });
  expect(h.downloads[2].args[1]).toBe('9DDDDDDDDDDD'); expect(snapshot().gameOperation.status).toBe('running');
  await install('E');
  const restarted = new StateStore(path.join(h.root, 'userData')); await restarted.load();
  expect(restarted.downloads.filter(task => task.status === 'paused')).toHaveLength(2);
  await ipc('cancel-download', fourth); await waitForQueue(4);
  // Closing stops advancement, even when process termination finishes later.
  await install('F'); const preventDefault = vi.fn(); h.events.get('before-quit')!({ preventDefault });
  await vi.waitFor(() => expect(h.quit).toHaveBeenCalled()); expect(preventDefault).toHaveBeenCalled();
  expect(h.downloads).toHaveLength(4);
  expect(h.notifications).toHaveLength(1); // no completion toast for cancelled/stopped jobs
  expect(h.releaseDisplay).toHaveBeenCalledWith(7);
}, 10_000);
