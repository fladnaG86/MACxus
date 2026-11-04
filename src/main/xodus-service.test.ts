import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { selectedWinePath, startXodusBridge, startXodusService, storeContentRuntime } from './xodus-service.js';

it.each(['credential', 'unknown', 'stdout'])('reports only safe service %s errors and cleans its private session directory', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-service-error-'));
  try {
    const marker = mode === 'unknown' ? 'NEXUS_CREDENTIAL_ERROR_V1 private-secret\n' : 'NEXUS_CREDENTIAL_ERROR_V1 keyring-unavailable\n';
    const body = `#!/usr/bin/env node\nprocess.stderr.write('private-account-token\\n');\nprocess.${mode === 'stdout' ? 'stdout' : 'stderr'}.write(${JSON.stringify(marker)});\nprocess.exitCode=1;\n`;
    await fs.writeFile(path.join(root,'xodus-service'), body, {mode:0o700});
    const error = await startXodusService(path.join(root,'xodus-cli'), path.join(root,'profile'), () => {}).then(() => '', e => e.message as string);
    expect(error).toContain(mode === 'credential' ? 'system keyring could not be accessed' : 'xodus-service exited with code 1');
    expect(error).not.toMatch(/private-account|private-secret/);
    expect(await fs.readdir(path.join(root,'profile/service-sessions'))).toEqual([]);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

it('requires all genuine Store/content/bridge runtime capabilities, not just an installed Wine binary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-content-runtime-'));
  try {
    const wine = path.join(root, 'files/bin/wine');
    expect(await storeContentRuntime(wine)).toBe(false);
    const features = ['xstore-entitlements-v1', 'xpackage-content-v1', 'xstore-package-license-v1', 'xodus-tcp-bridge-v1', 'cloud-saves-pr28'];
    for (const missing of features) {
      await fs.writeFile(path.join(root, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({ features: features.filter(feature => feature !== missing) }));
      expect(await storeContentRuntime(wine)).toBe(false);
    }
    await fs.writeFile(path.join(root, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({ features }));
    expect(await storeContentRuntime(wine)).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

describe('selectedWinePath', () => {
  const root = '/data/runtimes';
  const active = '/data/runtimes/releases/new/files/bin/wine';

  it('follows the managed runtime pointer when settings still name an older release', () => {
    expect(selectedWinePath('/data/runtimes/releases/old/files/bin/wine', root, active)).toBe(active);
  });

  it('uses one external configured Wine for every game', () => {
    expect(selectedWinePath('/custom/global/wine', root, active)).toBe('/custom/global/wine');
    expect(selectedWinePath('', root, active)).toBe(active);
  });
});

describe('startXodusBridge', () => {
  it('forwards authenticated loopback traffic to the private Unix socket', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-bridge-test-'));
    const socketPath = path.join(dir, 'backend.sock');
    let connections = 0;
    const backend = createServer((socket) => {
      connections += 1;
      socket.on('data', (chunk) => socket.write(chunk));
    });
    backend.listen(socketPath);
    await once(backend, 'listening');
    const bridge = await startXodusBridge(socketPath);
    try {
      const client = createConnection(bridge.port, '127.0.0.1');
      await once(client, 'connect');
      client.write(`${bridge.key}ping`);
      const [reply] = await once(client, 'data') as [Buffer];
      expect(reply.toString()).toBe('ping');
      client.destroy();

      const rejected = createConnection(bridge.port, '127.0.0.1');
      await once(rejected, 'connect');
      rejected.write(`${'0'.repeat(64)}ping`);
      await once(rejected, 'close');
      expect(connections).toBe(1);
    } finally {
      await bridge.stop();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

it('routes fragmented authenticated discovery frames without forwarding them, preserving ordinary frames', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-addon-'));
  const socketPath = path.join(dir, 'backend.sock');
  let forwarded = Buffer.alloc(0), calls = 0;
  const backend = createServer(socket => socket.on('data', data => { forwarded = Buffer.concat([forwarded, data]); socket.end(data); }));
  backend.listen(socketPath); await once(backend, 'listening');
  const bridge = await startXodusBridge(socketPath, async payload => { calls++; expect(payload.toString()).toBe('fixture'); return Buffer.from('<Response/>'); });
  const frame = (kind: number, payload: string) => { const h = Buffer.alloc(8); h.writeUInt32LE(0x58445358); h.writeUInt16LE(kind, 4); h.writeUInt16LE(Buffer.byteLength(payload), 6); return Buffer.concat([h, Buffer.from(payload)]); };
  try {
    const client = createConnection(bridge.port, '127.0.0.1'); await once(client, 'connect');
    const data: Buffer[] = []; client.on('data', bytes => data.push(bytes));
    client.write(bridge.key.slice(0, 17)); client.write(bridge.key.slice(17));
    const query = frame(0x7f01, 'fixture'); client.write(query.subarray(0, 3)); client.write(query.subarray(3));
    await once(client, 'end'); client.destroy();
    const reply = Buffer.concat(data); expect(reply.readUInt16LE(4)).toBe(0x7f02); expect(reply.subarray(8).toString()).toBe('<Response/>');
    expect(calls).toBe(1); expect(forwarded.length).toBe(0);
    const ordinary = createConnection(bridge.port, '127.0.0.1'); await once(ordinary, 'connect');
    const original = frame(1, 'ordinary'); ordinary.write(Buffer.concat([Buffer.from(bridge.key), original]));
    const [echo] = await once(ordinary, 'data'); expect(echo).toEqual(original); ordinary.destroy();
    expect(forwarded).toEqual(original);
  } finally { await bridge.stop(); await new Promise<void>(resolve => backend.close(() => resolve())); await fs.rm(dir, { recursive: true, force: true }); }
});
it('does not invoke discovery before authentication and aborts an active query on bridge stop', async () => {
  let calls = 0, aborted = false, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const bridge = await startXodusBridge('/unused.sock', async (_, signal) => {
    calls++; began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); return Buffer.from('cancelled');
  });
  const header = Buffer.alloc(8); header.writeUInt32LE(0x58445358); header.writeUInt16LE(0x7f01, 4); header.writeUInt16LE(1, 6);
  const rejected = createConnection(bridge.port, '127.0.0.1'); await once(rejected, 'connect');
  rejected.write(Buffer.concat([Buffer.from('0'.repeat(64)), header, Buffer.from('x')])); await once(rejected, 'close'); expect(calls).toBe(0);
  const client = createConnection(bridge.port, '127.0.0.1'); await once(client, 'connect');
  client.write(Buffer.concat([Buffer.from(bridge.key), header, Buffer.from('x')])); await started;
  await bridge.stop(); expect(aborted).toBe(true); client.destroy();
});

it('keeps shutdown pending until cancelled discovery cleanup completes, including concurrent stops', async () => {
  let began!: () => void, cancelled!: () => void, releaseCleanup!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const bridge = await startXodusBridge('/unused.sock', async (_, signal) => {
    began();
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    cancelled(); await cleanup;
    return Buffer.from('cancelled');
  });
  const header = Buffer.alloc(8); header.writeUInt32LE(0x58445358); header.writeUInt16LE(0x7f01, 4); header.writeUInt16LE(1, 6);
  const client = createConnection(bridge.port, '127.0.0.1');
  try {
    await once(client, 'connect');
    client.write(Buffer.concat([Buffer.from(bridge.key), header, Buffer.from('x')])); await started;
    let finished = false;
    const stopping = bridge.stop(); expect(bridge.stop()).toBe(stopping);
    void stopping.then(() => { finished = true; });
    await aborted; await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    releaseCleanup(); await stopping; expect(finished).toBe(true);
    await bridge.stop();
  } finally { releaseCleanup(); client.destroy(); await bridge.stop(); }
});
