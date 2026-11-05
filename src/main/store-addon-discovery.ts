import { spawn } from 'node:child_process';
import path from 'node:path';
import { externalLauncherEnvironment } from './launcher-environment.js';

export const STORE_ADDON_DISCOVERY_REQUEST = 0x7f01;
export const STORE_ADDON_DISCOVERY_RESPONSE = 0x7f02;
const id = /^[A-Z0-9]{12}$/;
const skuId = /^[A-Z0-9]{4}$/;
const maximumCandidates = 255; // Runtime's 256-ID proof bound includes the base title.
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid inventory metadata.');
  return value as Record<string, unknown>;
};
const array = (value: unknown, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) throw Error('Invalid inventory metadata.');
  return value;
};
interface Candidate {
  productId: string; associated: boolean; offer: string;
  skus: Array<{ id: string; hasPackages: boolean }>;
}
export interface AddonDiscoveryDeps {
  library: (market: string, signal: AbortSignal) => Promise<unknown>;
  metadata: (url: URL, signal: AbortSignal) => Promise<unknown>;
}
/** Keep cancellation pending until the selected account helper has exited.
 * A backend ignoring SIGTERM is escalated to SIGKILL after a bounded grace. */
export async function loadAddonLibrary(backendBinary: string, market: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const env = externalLauncherEnvironment();
  for (const key of Object.keys(env)) if (/^(?:XODUS_|XUSER_|WINE|CX_|MACXUS_|NEXUS_|DYLD_)/.test(key)) delete env[key];
  env.XODUS_LOG = 'error';
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(backendBinary, ['library', '--json', '--market', market], { env, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const buffers: Buffer[] = [];
    let size = 0, failed = false, exited = false, closed = false, cleaned = false;
    let exitCode: number | null = null, escalation: NodeJS.Timeout | undefined;
    const killOwned = (kind: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch { /* An already exited owned process/group needs no signal. */ }
    };
    const finish = () => {
      if (!closed || (failed && !cleaned)) return;
      clearTimeout(deadline); clearTimeout(escalation); signal.removeEventListener('abort', terminate);
      if (failed || signal.aborted || exitCode !== 0) { reject(Error('Account inventory unavailable.')); return; }
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers)))); }
      catch { reject(Error('Invalid account inventory.')); }
    };
    const terminate = () => {
      if (failed) return;
      failed = true; killOwned('SIGTERM');
      escalation = setTimeout(() => {
        killOwned('SIGKILL'); cleaned = true;
        // A descendant can inherit pipes, including after leaving our process
        // group. Close only after the direct helper has verifiably exited.
        if (exited) { child.stdout.destroy(); child.stderr.destroy(); }
        finish();
      }, 1000);
    };
    const deadline = setTimeout(terminate, 50_000);
    signal.addEventListener('abort', terminate, { once: true });
    if (signal.aborted) terminate();
    child.stdout.on('data', (bytes: Buffer) => {
      if (failed) return;
      size += bytes.length;
      if (size > 16 * 1024 * 1024) { terminate(); return; }
      buffers.push(bytes);
    });
    // Account diagnostics are never returned to the game or launcher logs.
    child.stderr.resume();
    child.once('error', () => {
      if (!child.pid) { failed = cleaned = true; }
      else terminate();
    });
    child.once('exit', () => {
      exited = true;
      if (failed && cleaned) { child.stdout.destroy(); child.stderr.destroy(); }
    });
    child.once('close', code => {
      closed = true; exitCode = code; finish();
    });
  });
}
function productionDeps(backendBinary: string): AddonDiscoveryDeps {
  return {
    library: (market, signal) => loadAddonLibrary(backendBinary, market, signal),
    metadata: async (url, signal) => {
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
          !['displaycatalog.mp.microsoft.com', 'storeedgefd.dsx.mp.microsoft.com'].includes(url.hostname)) throw Error('Invalid metadata endpoint.');
      const result = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      if (!result.ok || !result.body) {
        await result.body?.cancel().catch(() => undefined);
        throw Error('Metadata unavailable.');
      }
      const reader = result.body.getReader();
      const buffers: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) throw Error('Metadata response too large.');
          buffers.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return JSON.parse(Buffer.concat(buffers).toString('utf8'));
    },
  };
}
async function boundedMap<T, R>(values: T[], action: (value: T, signal: AbortSignal) => Promise<R>, signal: AbortSignal): Promise<R[]> {
  const result = new Array<R>(values.length);
  const failed = new AbortController();
  const active = AbortSignal.any([signal, failed.signal]);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, values.length) }, async () => {
    try {
      for (;;) {
        active.throwIfAborted();
        const index = cursor++;
        if (index >= values.length) return;
        result[index] = await action(values[index], active);
      }
    } catch (error) {
      failed.abort();
      throw error;
    }
  });
  // The request gate and bridge own all work until response readers finish
  // cancelling, including siblings aborted by another worker's failure.
  const settled = await Promise.allSettled(workers);
  for (const worker of settled) if (worker.status === 'rejected') throw worker.reason;
  return result;
}
export function parseAddonDiscoveryRequest(bytes: Buffer, expectedParent: string): { parent: string; market: string } {
  if (!id.test(expectedParent) || !bytes.length || bytes.length > 4096) throw Error('Invalid discovery request.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // This wire format has exactly two scalar identifiers. Attributes, entities,
  // DTDs, duplicates and additional elements are deliberately unsupported.
  const match = /^<Request>\s*((?:<(?:ParentProductId|Market)>[A-Z0-9]{2,12}<\/(?:ParentProductId|Market)>\s*){2})<\/Request>$/.exec(text);
  if (!match) throw Error('Invalid discovery request.');
  const fields = [...match[1].matchAll(/<(ParentProductId|Market)>([A-Z0-9]+)<\/\1>/g)];
  if (fields.length !== 2 || new Set(fields.map(field => field[1])).size !== 2) throw Error('Invalid discovery request.');
  const parent = fields.find(field => field[1] === 'ParentProductId')![2];
  const market = fields.find(field => field[1] === 'Market')![2];
  if (parent !== expectedParent || !/^[A-Z]{2}$/.test(market)) throw Error('Invalid discovery request.');
  return { parent, market };
}
async function discover(parent: string, market: string, deps: AddonDiscoveryDeps, signal: AbortSignal): Promise<Candidate[]> {
  const inventory = object(await deps.library(market, signal));
  if (inventory.schema !== 1 || inventory.skippedEntitlements !== 0) throw Error('Incomplete account inventory.');
  const ids = array(inventory.entitlements, 10_000).map(row => {
    const value = object(row).productId;
    if (typeof value !== 'string' || !id.test(value)) throw Error('Invalid inventory ID.');
    return value;
  });
  if (new Set(ids).size !== ids.length) throw Error('Duplicate inventory ID.');
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 25) batches.push(ids.slice(i, i + 25));
  const catalog = new Map<string, Record<string, unknown>>();
  await boundedMap(batches, async (batch, workerSignal) => {
    const url = new URL('https://displaycatalog.mp.microsoft.com/v7.0/products');
    url.search = new URLSearchParams({ bigIds: batch.join(','), market, languages: 'en-US,neutral' }).toString();
    const products = array(object(await deps.metadata(url, workerSignal)).Products, batch.length);
    const seen = new Set<string>();
    for (const value of products) {
      const row = object(value), identifier = row.ProductId;
      if (typeof identifier !== 'string' || !batch.includes(identifier) || seen.has(identifier)) throw Error('Invalid catalog row.');
      seen.add(identifier); catalog.set(identifier, row);
    }
  }, signal);
  // Missing classification is retained for signed negative proof, never treated
  // as evidence that a product cannot carry an add-on license.
  const possible = ids.filter(identifier => !['Game', 'Consumable', 'UnmanagedConsumable', 'Pass'].includes(String(catalog.get(identifier)?.ProductType)));
  if (possible.length > 512) throw Error('Inventory discovery bound exceeded.');
  const candidates = await boundedMap(possible, async (identifier, workerSignal) => {
    const row = catalog.get(identifier);
    let parentId: unknown;
    try {
      const url = new URL(`https://storeedgefd.dsx.mp.microsoft.com/v9.0/products/${identifier}`);
      url.search = new URLSearchParams({ market, locale: 'en-us', deviceFamily: 'Windows.Desktop', actionFilter: 'Details', cardsEnabled: 'true' }).toString();
      const result = object(await deps.metadata(url, workerSignal));
      const detail = object(result.Payload ?? result);
      if (detail.ProductId === identifier) parentId = detail.ParentId;
    } catch { workerSignal.throwIfAborted(); }
    if (row?.ProductType === 'Durable' && typeof parentId === 'string' && id.test(parentId) && parentId !== parent) return undefined;
    const associated = row?.ProductType === 'Durable' && parentId === parent;
    const skus: Candidate['skus'] = [];
    if (associated) {
      const entries = array(row!.DisplaySkuAvailabilities, 16);
      if (!entries.length) throw Error('Incomplete SKU metadata.');
      for (const value of entries) {
        const sku = object(object(value).Sku), properties = object(sku.Properties);
        if (typeof sku.SkuId !== 'string' || !skuId.test(sku.SkuId) || skus.some(item => item.id === sku.SkuId)) throw Error('Invalid SKU metadata.');
        if (properties.Packages !== undefined && !Array.isArray(properties.Packages)) throw Error('Invalid package metadata.');
        skus.push({ id: sku.SkuId, hasPackages: Array.isArray(properties.Packages) && properties.Packages.length > 0 });
      }
    }
    const offer = row?.Properties === undefined ? '' : object(row.Properties).InAppOfferToken ?? '';
    if (typeof offer !== 'string' || Buffer.byteLength(offer, 'utf8') > 63 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(offer)) throw Error('Invalid offer metadata.');
    return { productId: identifier, associated, offer, skus } satisfies Candidate;
  }, signal);
  const result = candidates.filter((value): value is Candidate => value !== undefined);
  if (result.length > maximumCandidates) throw Error('Candidate inventory bound exceeded.');
  return result;
}
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function addonDiscoveryFailure(hr = 0x80004005): Buffer {
  return Buffer.from(`<Response><HResult>${hr}</HResult></Response>`);
}
/** Metadata discovery only. The runtime independently verifies signed exact-SKU
 * receipts before returning any ownership/license result to a game. */
export function createStoreAddonDiscovery(backendBinary: string, expectedParent: string, deps = productionDeps(backendBinary)) {
  if (!path.isAbsolute(backendBinary) || !id.test(expectedParent)) throw Error('Invalid discovery backend or title.');
  let pending = false;
  return async (bytes: Buffer, cancelled: AbortSignal): Promise<Buffer> => {
    let request;
    try { request = parseAddonDiscoveryRequest(bytes, expectedParent); }
    catch { return addonDiscoveryFailure(0x80070057); }
    if (pending) return addonDiscoveryFailure(0x800700aa);
    pending = true;
    const deadline = AbortSignal.timeout(80_000);
    const finished = new AbortController();
    const signal = AbortSignal.any([cancelled, deadline, finished.signal]);
    try {
      const products = await discover(request.parent, request.market, deps, signal);
      signal.throwIfAborted();
      const payload = Buffer.from(`<Response><HResult>0</HResult><ParentProductId>${request.parent}</ParentProductId>` +
        `<ValidUntil>${Math.floor(Date.now() / 1000) + 120}</ValidUntil><InventoryComplete>true</InventoryComplete>` +
        products.map(product => `<Product><StoreId>${product.productId}</StoreId><AssociatedDurable>${product.associated}</AssociatedDurable>` +
          `<InAppOfferToken>${escape(product.offer)}</InAppOfferToken>` + product.skus.map(sku => `<Sku><SkuId>${sku.id}</SkuId><HasPackages>${sku.hasPackages}</HasPackages></Sku>`).join('') + '</Product>').join('') + '</Response>');
      return payload.length <= 60_000 ? payload : addonDiscoveryFailure(0x8007007a);
    } catch { return addonDiscoveryFailure(cancelled.aborted ? 0x80004004 : 0x80004005); }
    finally { finished.abort(); pending = false; }
  };
}
