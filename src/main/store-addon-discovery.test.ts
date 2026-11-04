import { expect, it, vi } from 'vitest';
import { promises as fs, watch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { startXodusBridge } from './xodus-service.js';
import { createStoreAddonDiscovery, parseAddonDiscoveryRequest, type AddonDiscoveryDeps } from './store-addon-discovery.js';
const parent = 'B00000000001', addon = 'B00000000002', other = 'B00000000003';
const request = Buffer.from(`<Request><ParentProductId>${parent}</ParentProductId><Market>US</Market></Request>`);

it('settles cancelled inventory after an exited helper leaves inherited pipes open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'addon inherited pipes '));
  const binary = path.join(root, 'backend'), marker = path.join(root, 'ready');
  // Publish readiness only after its PID bytes are complete; file creation
  // notifications can arrive before writeFileSync has written the content.
  const childCode = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker + '.tmp')},String(process.pid));require('node:fs').renameSync(${JSON.stringify(marker + '.tmp')},${JSON.stringify(marker)});setInterval(()=>{},1000);`;
  await fs.writeFile(binary, `#!/usr/bin/env node\nrequire('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore',1,2]});setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const watcher = watch(root);
  const ready = new Promise<void>(resolve => watcher.on('change', (_, file) => { if (file === 'ready') resolve(); }));
  let pid: number | undefined;
  let inventory!: Promise<Buffer>;
  const handler = createStoreAddonDiscovery(binary, parent);
  const bridge = await startXodusBridge('/unused.sock', (bytes, signal) => inventory = handler(bytes, signal));
  const client = createConnection(bridge.port, '127.0.0.1');
  try {
    await once(client, 'connect');
    const header = Buffer.alloc(8); header.writeUInt32LE(0x58445358); header.writeUInt16LE(0x7f01, 4); header.writeUInt16LE(request.length, 6);
    client.write(Buffer.concat([Buffer.from(bridge.key), header, request]));
    await ready; pid = Number(await fs.readFile(marker, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    await bridge.stop();
    expect((await inventory).toString()).toContain('2147500036');
    // Group escalation must reach the pipe holder even after its parent exits.
    await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 2000 });
  } finally {
    watcher.close(); client.destroy(); await bridge.stop();
    if (pid !== undefined && Number.isSafeInteger(pid) && pid > 1) { try { process.kill(pid, 'SIGKILL'); } catch { /* reaped */ } }
    await fs.rm(root, { recursive: true, force: true });
  }
});
function fixture() {
  const library = vi.fn(async () => ({ schema: 1, skippedEntitlements: 0, entitlements: [parent, addon, other].map(productId => ({ productId })) }));
  const metadata = vi.fn(async (url: URL): Promise<unknown> => url.hostname.startsWith('displaycatalog') ? { Products: [
    { ProductId: parent, ProductType: 'Game' },
    { ProductId: addon, ProductType: 'Durable', Properties: { InAppOfferToken: 'offer&<test>' }, DisplaySkuAvailabilities: [{ Sku: { SkuId: '0010', Properties: { Packages: [] } } }] },
    { ProductId: other, ProductType: 'Durable' },
  ] } : { Payload: { ProductId: url.pathname.split('/').at(-1), ParentId: url.pathname.endsWith(addon) ? parent : 'B00000000099' } });
  return { library, metadata };
}
it('discovers metadata with an explicitly selected relocated backend; metadata never advertises license ownership', async () => {
  const deps = fixture();
  const handler = createStoreAddonDiscovery('/another app/location/backend/xodus-cli', parent, deps);
  const text = (await handler(request, new AbortController().signal)).toString();
  expect(text).toContain('<HResult>0</HResult>');
  expect(text).toContain('<InventoryComplete>true</InventoryComplete>');
  expect(text).toContain(`<StoreId>${addon}</StoreId><AssociatedDurable>true</AssociatedDurable>`);
  expect(text).toContain('offer&amp;&lt;test&gt;');
  expect(text).not.toContain(`<StoreId>${other}</StoreId>`);
  expect(text).not.toMatch(/IsActive|isInUserCollection|TokenClaim|Bearer|License/);
  expect(deps.library).toHaveBeenCalledWith('US', expect.any(AbortSignal));
});
it.each([
  '', '<!DOCTYPE Request><Request/>', '<Request><Market>US</Market><Market>US</Market></Request>',
  `<Request><ParentProductId>${other}</ParentProductId><Market>US</Market></Request>`,
  `<Request><ParentProductId>${parent}</Market><Market>US</ParentProductId></Request>`,
  `<Request><ParentProductId>${parent}</ParentProductId><Market>US</Market><Other/></Request>`,
  `<Request x="1"><ParentProductId>${parent}</ParentProductId><Market>US</Market></Request>`,
])('rejects malformed/foreign discovery request without account work: %s', async text => {
  const deps = fixture();
  expect(() => parseAddonDiscoveryRequest(Buffer.from(text), parent)).toThrow();
  const result = await createStoreAddonDiscovery('/backend', parent, deps)(Buffer.from(text), new AbortController().signal);
  expect(result.toString()).toContain('2147942487');
  expect(deps.library).not.toHaveBeenCalled();
});
it('rejects invalid UTF-8 and oversized frames, accepts field reordering', () => {
  expect(() => parseAddonDiscoveryRequest(Buffer.from([0xff]), parent)).toThrow();
  expect(() => parseAddonDiscoveryRequest(Buffer.alloc(4097), parent)).toThrow();
  expect(parseAddonDiscoveryRequest(Buffer.from(`<Request> <Market>CA</Market><ParentProductId>${parent}</ParentProductId></Request>`), parent)).toEqual({ parent, market: 'CA' });
});
it.each(['incomplete', 'duplicate-library', 'duplicate-catalog', 'foreign-catalog', 'bad-sku', 'bad-offer', 'metadata-failure'])('fails closed on %s', async kind => {
  const deps = fixture();
  if (kind === 'incomplete') deps.library.mockResolvedValue({ schema: 1, skippedEntitlements: 1, entitlements: [] });
  if (kind === 'duplicate-library') deps.library.mockResolvedValue({ schema: 1, skippedEntitlements: 0, entitlements: [parent, parent].map(productId => ({ productId })) });
  if (kind === 'metadata-failure') deps.metadata.mockRejectedValue(Error('secret diagnostic'));
  const original = deps.metadata.getMockImplementation()!;
  if (!['incomplete', 'duplicate-library', 'metadata-failure'].includes(kind)) deps.metadata.mockImplementation(async url => {
    const data = await original(url) as { Products?: Array<Record<string, unknown>> };
    if (data.Products) {
      if (kind === 'duplicate-catalog') data.Products[2] = data.Products[1];
      if (kind === 'foreign-catalog') data.Products[1].ProductId = 'B00000000099';
      if (kind === 'bad-sku') data.Products[1].DisplaySkuAvailabilities = [{ Sku: { SkuId: '../x', Properties: {} } }];
      if (kind === 'bad-offer') data.Products[1].Properties = { InAppOfferToken: 'x'.repeat(64) };
    }
    return data;
  });
  const text = (await createStoreAddonDiscovery('/backend', parent, deps)(request, new AbortController().signal)).toString();
  expect(text).toBe('<Response><HResult>2147500037</HResult></Response>');
  expect(text).not.toContain('secret');
});
it('retains unresolved classification for independent signed proof', async () => {
  const deps = fixture();
  deps.metadata.mockImplementation(async url => url.hostname.startsWith('displaycatalog') ? { Products: [{ ProductId: parent, ProductType: 'Game' }] } : Promise.reject(Error('unavailable')));
  const text = (await createStoreAddonDiscovery('/backend', parent, deps)(request, new AbortController().signal)).toString();
  expect(text).toContain(`<StoreId>${addon}</StoreId><AssociatedDurable>false</AssociatedDurable>`);
  expect(text).toContain(`<StoreId>${other}</StoreId><AssociatedDurable>false</AssociatedDurable>`);
});
it('cancels account work, bounds concurrent requests, and clears the per-launch gate afterward', async () => {
  const controller = new AbortController();
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const deps: AddonDiscoveryDeps = { library: async (_, signal) => {
    begin(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
  }, metadata: async () => { throw Error('must not fetch'); } };
  const handler = createStoreAddonDiscovery('/backend', parent, deps);
  const first = handler(request, controller.signal); await started;
  expect((await handler(request, new AbortController().signal)).toString()).toContain('2147942570');
  controller.abort();
  expect((await first).toString()).toContain('2147500036');
});
it('bounds unknown candidates while retaining a slot for the base-title proof', async () => {
  const ids = Array.from({ length: 256 }, (_, i) => `B${String(i).padStart(11, '0')}`);
  const deps: AddonDiscoveryDeps = {
    library: async () => ({ schema: 1, skippedEntitlements: 0, entitlements: ids.map(productId => ({ productId })) }),
    metadata: async url => url.hostname.startsWith('displaycatalog') ? { Products: [] } : {},
  };
  expect((await createStoreAddonDiscovery('/backend', parent, deps)(request, new AbortController().signal)).toString()).toContain('2147500037');
});

it('waits for termination of a relocated backend that ignores SIGTERM before releasing the request gate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'addon backend with spaces '));
  const binary = path.join(root, 'xodus-cli'), marker = path.join(root, 'ready');
  let pid: number | undefined;
  const watcher = watch(root);
  const ready = new Promise<void>(resolve => watcher.on('change', (_, file) => { if (file === 'ready') resolve(); }));
  await fs.writeFile(binary, `#!/usr/bin/env node\nconst fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(marker + '.tmp')},String(process.pid));fs.renameSync(${JSON.stringify(marker + '.tmp')},${JSON.stringify(marker)});setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const cancelled = new AbortController();
  try {
    const handler = createStoreAddonDiscovery(binary, parent);
    const running = handler(request, cancelled.signal);
    await ready; pid = Number(await fs.readFile(marker, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    cancelled.abort();
    expect((await handler(request, new AbortController().signal)).toString()).toContain('2147942570');
    expect((await running).toString()).toContain('2147500036');
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally {
    cancelled.abort(); watcher.close();
    if (pid !== undefined && Number.isSafeInteger(pid) && pid > 1) { try { process.kill(pid, 'SIGKILL'); } catch { /* already reaped */ } }
    await fs.rm(root, { recursive: true, force: true });
  }
});


function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it('aborts and drains sibling metadata workers before releasing the request gate', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `B${String(i).padStart(11, '0')}`);
  const siblingStarted = deferred(), cancelling = deferred(), release = deferred();
  let settled = false, fail = true, siblingAborted = false;
  const deps: AddonDiscoveryDeps = {
    library: async () => ({ schema: 1, skippedEntitlements: 0, entitlements: (fail ? ids : []).map(productId => ({ productId })) }),
    metadata: async (url, signal) => {
      if (url.searchParams.get('bigIds')!.startsWith(ids[0])) {
        await siblingStarted.promise; throw Error('synthetic catalog failure');
      }
      siblingStarted.resolve();
      return new Promise((_, reject) => signal.addEventListener('abort', () => {
        siblingAborted = true; cancelling.resolve();
        void release.promise.then(() => reject(Error('synthetic reader cleanup complete')));
      }, { once: true }));
    },
  };
  const handler = createStoreAddonDiscovery('/synthetic/backend', parent, deps);
  const running = handler(request, new AbortController().signal).then(value => { settled = true; return value; });
  try {
    await cancelling.promise;
    await new Promise<void>(done => setImmediate(done));
    expect(siblingAborted).toBe(true); expect(settled).toBe(false);
    expect((await handler(request, new AbortController().signal)).toString()).toContain('2147942570');
    release.resolve(); expect((await running).toString()).toContain('2147500037');
    fail = false;
    expect((await handler(request, new AbortController().signal)).toString()).toContain('<HResult>0</HResult>');
  } finally { release.resolve(); await running; }
});
it('awaits rejected HTTP body cancellation before advancing bounded metadata workers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'addon HTTP cleanup '));
  const binary = path.join(root, 'backend'), release = deferred();
  const ids = Array.from({ length: 26 }, (_, i) => `B${String(i).padStart(11, '0')}`);
  const inventory = { schema: 1, skippedEntitlements: 0, entitlements: ids.map(productId => ({ productId })) };
  await fs.writeFile(binary, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(inventory))});\n`, { mode: 0o700 });
  let live = 0, maximum = 0, started = 0, cancelled = 0, requests = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
    if (input.hostname === 'displaycatalog.mp.microsoft.com') return new Response(JSON.stringify({ Products: [] }));
    requests++; live++; maximum = Math.max(maximum, live);
    return new Response(new ReadableStream({ cancel: async () => {
      const ordinal = ++started;
      if (ordinal <= 4) await release.promise;
      cancelled++; live--;
    } }), { status: 503 });
  }));
  const running = createStoreAddonDiscovery(binary, parent)(request, new AbortController().signal);
  try {
    await vi.waitFor(() => expect(started).toBe(4), { timeout: 1000 });
    expect(requests).toBe(4); expect(live).toBe(4);
    release.resolve();
    expect((await running).toString()).toContain('<HResult>0</HResult>');
    expect(requests).toBe(26); expect(cancelled).toBe(26); expect(live).toBe(0); expect(maximum).toBeLessThanOrEqual(4);
  } finally { release.resolve(); await running; vi.unstubAllGlobals(); await fs.rm(root, { recursive: true, force: true }); }
});
