import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccountLibrary, entitlementKind, parseEntitlements } from './account-library.js';
import { CatalogService } from './catalog.js';
import type { CatalogProduct } from '../shared/types.js';

const A='9AAAAAAAAAAA', B='9BBBBBBBBBBB', C='9CCCCCCCCCCC';
const row=(productId=A, extra={})=>({productId,status:'Active',isTrial:false,sharingSource:'None',endDate:'2099-01-01T00:00:00Z',special:false,...extra});
const output=(entries=[row()],account='one@example.test',market='US')=>JSON.stringify({schema:1,account,market,checkedAt:new Date().toISOString(),entitlements:entries});
const product=(productId:string):CatalogProduct=>({productId,title:productId,description:'',categories:[],installability:'supported',supportNote:''});

it('keeps unsupported and unknown owned games separate from Game Pass without exposing add-ons or unlicensed products', async () => {
  const D = '9DDDDDDDDDDD', E = '9EEEEEEEEEEE', F = '9FFFFFFFFFFF';
  const record = (productId: string, kind = 'Game', format = 'MSIXVC') => ({ ProductId: productId, ProductType: kind,
    LocalizedProperties: [{ ProductTitle: productId }], DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFormat: format, PlatformDependencies: [{ PlatformName: 'Windows.Desktop' }] }] } } }] });
  const records = [record(A, 'Game', 'EAppxBundle'), record(B), record(C, 'Game', 'APPX'), record(D, 'Durable'),
    { ProductId: E, ProductType: 'Game', LocalizedProperties: [{ ProductTitle: 'Incomplete edition' }], DisplaySkuAvailabilities: [{ Sku: { Properties: { BundledSkus: [{ BigId: F }] } } }] }, record('9UNLICENSED0')];
  const service = new CatalogService((async () => new Response(JSON.stringify({ Products: records }))) as typeof fetch);
  const library = new AccountLibrary((ids, market) => service.licensedProducts(ids, market), async () => output([
    row(A), row(B), row(C, { satisfiedByProductId: 'CFQ7TTC0KGQ8' }), row(D), row(E),
  ]));
  library.select('one@example.test', '/not-executed', 'US');
  const owned = (await library.get('owned')).products;
  expect(owned.map(p => p.productId).sort()).toEqual([A, B, E]);
  expect(owned.find(p => p.productId === A)).toMatchObject({ access: 'owned', installability: 'unsupported' });
  expect(owned.find(p => p.productId === E)).toMatchObject({ access: 'owned', installability: 'unknown' });
  expect((await library.get('gamepass')).products).toMatchObject([{ productId: C, access: 'gamepass', installability: 'unsupported' }]);
  expect((await library.get('all')).products).toHaveLength(4);
});

it.each(['network', 'http', 'json', 'shape'])('does not cache a %s catalog failure as an empty successful library', async failure => {
  let healthy = false;
  const fetcher = vi.fn(async () => {
    if (!healthy) {
      if (failure === 'network') throw Error('private signed URL must not appear');
      if (failure === 'http') return new Response('', { status: 503 });
      if (failure === 'json') return new Response('{');
      return new Response('{}');
    }
    return new Response(JSON.stringify({ Products: [{ ProductId: A, ProductType: 'Game',
      LocalizedProperties: [{ ProductTitle: 'A game' }],
      DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFormat: 'MSIXVC', PlatformDependencies: [{ PlatformName: 'Windows.Desktop' }] }] } } }],
    }] }));
  });
  const catalog = new CatalogService(fetcher as typeof fetch);
  const library = new AccountLibrary((ids, market) => catalog.licensedProducts(ids, market), async () => output());
  library.select('one@example.test', '/backend', 'US');
  await expect(library.get('all')).rejects.toThrow('game details could not be loaded');
  expect((await library.access()).accessByProductId[A]).toBe('owned');
  healthy = true;
  expect((await library.get('all')).products.map(entry => entry.productId)).toEqual([A]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('maps real failed child processes to safe session guidance and recovers on a later refresh', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-session-reader-'));
  const binary = path.join(directory, 'backend');
  const catalog = vi.fn(async (ids: string[]) => ids.map(product));
  const library = new AccountLibrary(catalog); library.select('one@example.test', binary, 'US');
  const fixture = async (stdout: string, stderr: string, code: number) => fs.writeFile(binary,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(${code});\n`, { mode: 0o700 });
  try {
    for (const [stage, message] of [['session-user-expired', 'Sign in again'], ['ticket-timeout', 'timed out'], ['session-device-refresh-failed', 'could not be renewed'], ['ticket-response-parse', 'unreadable response'], ['ticket-interaction-required', 'interactive sign-in']]) {
      await fixture('', `private@example.test raw-secret\nNEXUS_SESSION_DIAGNOSTIC_V1 ${stage}\n`, 1);
      const failure = await library.get('all').catch(error => error as Error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(message);
      expect((failure as Error).message).not.toMatch(/example\.test|raw-secret/);
    }
    expect(catalog).not.toHaveBeenCalled();
    await fixture('', 'private-secret\nNEXUS_TICKET_DIAGNOSTIC_V1 ticket-refused 800488AB\n', 1);
    await expect(library.get('all')).rejects.toThrow('Microsoft refused the stored sign-in (code 0x800488AB)');
    await fixture('NEXUS_SESSION_DIAGNOSTIC_V1 session-user-expired\n', 'untrusted error\n', 1);
    await expect(library.get('all')).rejects.toThrow('licenses could not be loaded');
    await fixture('', 'NEXUS_SESSION_DIAGNOSTIC_V1 ticket-timeout\nNEXUS_SESSION_DIAGNOSTIC_V1 ticket-response-received\nentitlement failure private-secret\n', 1);
    await expect(library.get('all')).rejects.toThrow('licenses could not be loaded');
    const response = output() + '\n'; const middle = Math.floor(response.length / 2);
    await fs.writeFile(binary, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(response.slice(0, middle))});setTimeout(()=>{process.stderr.write('NEXUS_SESSION_DIAGNOSTIC_V1 ticket-response-received\\n');setTimeout(()=>process.stdout.write(${JSON.stringify(response.slice(middle))}),20)},20);\n`, { mode: 0o700 });
    expect((await library.get('all', undefined, true)).products.map(item => item.productId)).toEqual([A]);
    expect(catalog).toHaveBeenCalledTimes(1);
  } finally { library.reset(); await fs.rm(directory, { recursive: true, force: true }); }
});

it('provides fresh access for content planning without loading unrelated catalog products', async () => {
  const catalog=vi.fn(async (ids:string[])=>ids.map(product));
  const reader=vi.fn(async()=>output([row(),row(B,{satisfiedByProductId:'CFQ7TTC0KGQ8'})]));
  const library=new AccountLibrary(catalog,reader); library.select('one@example.test','/backend','US');
  expect((await library.access(true)).accessByProductId).toEqual({[A]:'owned',[B]:'gamepass'});
  expect(catalog).not.toHaveBeenCalled(); expect(reader).toHaveBeenCalledTimes(1);
  await library.access(true); expect(reader).toHaveBeenCalledTimes(2);
  library.select(undefined,undefined,'US'); await expect(library.access()).rejects.toThrow('Sign in');
});

it('distinguishes direct/owned bundle access from subscriptions, without guessing missing parents',()=>{
  const {entries}=parseEntitlements(output([row(),row(B,{satisfiedByProductId:A}),row(C,{satisfiedByProductId:'CFQ7TTC0KGQ8'})]),'one@example.test','US');
  expect(entitlementKind(A,entries)).toBe('owned');
  expect(entitlementKind(B,entries)).toBe('owned');
  expect(entitlementKind(C,entries)).toBe('gamepass');
  entries.delete(A); expect(entitlementKind(B,entries)).toBeUndefined();
  entries.set(A,row(A,{satisfiedByProductId:B})); expect(entitlementKind(B,entries)).toBeUndefined();
});

it('never labels expired, trial, special, revoked or shared entitlements as owned',()=>{
  for(const extra of [{isTrial:true},{special:true},{status:'Revoked'},{endDate:'2000-01-01T00:00:00Z'},{sharingSource:'Family'}]) {
    const {entries}=parseEntitlements(output([row(A,extra)]),'one@example.test','US');
    expect(entitlementKind(A,entries)).toBeUndefined();
  }
  expect(entitlementKind('CFQ7TTC0KGQ8',new Map([['CFQ7TTC0KGQ8',row('CFQ7TTC0KGQ8')]]))).toBeUndefined();
});

it('rejects foreign identities/market and stale or malformed protocol envelopes',()=>{
  for(const text of [output([row()],'other'),output([row()],'one@example.test','CZ'), 'null',
    JSON.stringify({...JSON.parse(output()),entitlements:{}}), JSON.stringify({...JSON.parse(output()),checkedAt:'2000-01-01T00:00:00Z'})]) {
    expect(()=>parseEntitlements(text,'one@example.test','US')).toThrow();
  }
});

it('omits malformed and duplicate rows plus their dependent children without hiding independent games',()=>{
  const result = parseEntitlements(output([row(),row(B,{isTrial:undefined}),row(C,{satisfiedByProductId:B}),row('invalid')]),'one@example.test','US');
  expect([...result.entries.keys()]).toEqual([A]); expect(result.skipped).toBe(3);
  for (const rows of [[row(A), row(A)], [row(A), row(A,{isTrial:true})], [row(A),row(A,{status:undefined})]]) {
    const parsed = parseEntitlements(output([...rows,row(B,{satisfiedByProductId:A}),row(C)]),'one@example.test','US');
    expect([...parsed.entries.keys()]).toEqual([C]); expect(parsed.skipped).toBe(3);
  }
});

it('never defaults missing policy fields into ownership or trusts an invalid subscription parent',()=>{
  for (const extra of [{isTrial:undefined}, {special:undefined}, {sharingSource:undefined}, {endDate:undefined}, {endDate:'invalid'}, {satisfiedByProductId:'bad'}]) {
    const parsed = parseEntitlements(output([row(A,extra),row(B)]),'one@example.test','US');
    expect([...parsed.entries.keys()]).toEqual([B]); expect(parsed.skipped).toBe(1);
  }
  const parsed = parseEntitlements(output([row('CFQ7TTC0KGQ8',{endDate:undefined}),row(A,{satisfiedByProductId:'CFQ7TTC0KGQ8'}),row(B)]),'one@example.test','US');
  expect([...parsed.entries.keys()]).toEqual([B]);
});

it('exposes a partial-result count on all filters and content access remains limited to valid records',async()=>{
  const text=JSON.stringify({...JSON.parse(output([row(),row(B,{endDate:undefined})])),skippedEntitlements:2});
  const library=new AccountLibrary(async ids=>ids.map(product),async()=>text); library.select('one@example.test','/backend','US');
  for(const kind of ['all','owned','gamepass'] as const) expect((await library.get(kind)).skippedEntitlements).toBe(3);
  expect((await library.access()).accessByProductId).toEqual({[A]:'owned'});
});

it('loads all/owned/Game Pass using one account read and caches only bound pages in memory',async()=>{
  const reader=vi.fn(async()=>output([row(),row(B,{satisfiedByProductId:'CFQ7TTC0KGQ8'})]));
  const catalog=vi.fn(async(ids:string[])=>ids.map(product));
  const library=new AccountLibrary(catalog,reader); library.select('one@example.test','/backend','neutral');
  const all=await library.get('all'); expect(all.products.map(p=>p.access)).toEqual(['owned','gamepass']);
  expect((await library.get('owned')).products.map(p=>p.productId)).toEqual([A]);
  expect((await library.get('gamepass')).products.map(p=>p.productId)).toEqual([B]);
  expect(reader).toHaveBeenCalledTimes(1);
  await library.get('all'); expect(catalog).toHaveBeenCalledTimes(3);
  library.select(undefined,'/backend','US'); await expect(library.get('all')).rejects.toThrow('Sign in');
});

it('does not publish a late response after an account switch',async()=>{
  let finish!:(value:string)=>void;
  const library=new AccountLibrary(async ids=>ids.map(product),()=>new Promise(resolve=>{finish=resolve;}));
  library.select('one@example.test','/backend','US');
  const request=library.get('all'); const rejected=expect(request).rejects.toThrow('changed');
  library.select('two@example.test','/backend','US'); finish(output()); await rejected;
});

it('restarts from a fresh first page when a cursor outlives its five minute snapshot',async()=>{
  vi.useFakeTimers({toFake:['Date']});
  try {
    const entries=Array.from({length:61},(_,i)=>row(String(i).padStart(12,'0')));
    const library=new AccountLibrary(async ids=>ids.map(product),async()=>output(entries));
    library.select('one@example.test','/backend','US');
    const first=await library.get('all');
    vi.setSystemTime(Date.now()+5*60_000+1);
    const restarted=await library.get('all',first.cursor);
    expect(restarted.restarted).toBe(true); expect(restarted.products).toHaveLength(60); expect(restarted.cursor).not.toBe(first.cursor);
    expect((await library.get('all',restarted.cursor)).restarted).toBeUndefined();
  } finally { vi.useRealTimers(); }
});

it('binds pagination to snapshot and filter, rather than accepting arbitrary product IDs',async()=>{
  const entries=Array.from({length:61},(_,i)=>row(String(i).padStart(12,'0')));
  const library=new AccountLibrary(async ids=>ids.map(product),async()=>output(entries));
  library.select('one@example.test','/backend','US');
  const first=await library.get('all'); expect(first.products).toHaveLength(60); expect(first.cursor).toBeTruthy();
  const last=await library.get('all',first.cursor); expect(last.products).toHaveLength(1); expect(last.cursor).toBeUndefined();
  await expect(library.get('owned',first.cursor)).rejects.toThrow('Invalid');
  await library.get('all',undefined,true); const restarted=await library.get('all',first.cursor); expect(restarted.restarted).toBe(true); expect(restarted.products).toHaveLength(60);
});
