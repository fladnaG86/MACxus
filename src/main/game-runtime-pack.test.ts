import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareGameRuntimePack } from './game-runtime-pack.js';
import type { CompatibilityPackRequest } from './game-compatibility-pack.js';
import { MAC_RUNTIME_DLLS, installRuntimeDlls } from './crossover.js';
import { parseRuntimePack } from '../shared/runtime-pack-schema.mjs';
const roots: string[]=[];
const digest=(b: string|Buffer)=>createHash('sha256').update(b).digest('hex');
afterEach(async()=>{for(const p of roots.splice(0))await fs.rm(p,{recursive:true,force:true});});
async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'007-runtime-pack-'));roots.push(root);
  const assets=path.join(root,'assets'), cx=path.join(root,'Preview'), data=path.join(root,'data');
  await fs.mkdir(path.join(cx,'etc'),{recursive:true});await fs.writeFile(path.join(cx,'etc/CrossOver.conf'),'"BuildTag" = "cxpreview-20261015-rc1"\n');
  const original='synthetic original runtime', wrapper='synthetic wrapper';
  await fs.cp(new URL('../../assets/compatibility-packs/bond-public-config-v1/',import.meta.url),assets,{recursive:true,filter:p=>!p.includes('/payload')});
  const manifest=JSON.parse(await fs.readFile(path.join(assets,'manifest.json'),'utf8'));
  manifest.dllSHA256=digest(wrapper);manifest.baseNativeSHA256=digest(original);
  await fs.writeFile(path.join(assets,'manifest.json'),JSON.stringify(manifest));
  await fs.mkdir(path.join(assets,'payload'));await fs.writeFile(path.join(assets,'payload/winhttp.dll'),wrapper);
  const request:CompatibilityPackRequest={storeId:'9PN198B459VB',engine:'crossover-preview',installation:{root:cx,wine:path.join(cx,'wine'),wineserver:path.join(cx,'wineserver'),cxbottle:path.join(cx,'cxbottle'),version:'20261015'},dataRoot:data,log:()=>{}};
  return {root,assets,cx,data,original,wrapper,request,manifest};
}
async function setup(f:Awaited<ReturnType<typeof fixture>>) {
  const pack=await prepareGameRuntimePack(f.request,f.assets);expect(pack).toBeDefined();
  const prefix=path.join(pack!.bottlesRoot,'xbox'),system=path.join(prefix,'drive_c/windows/system32');
  await fs.mkdir(system,{recursive:true});await fs.writeFile(path.join(system,'winhttp.dll'),f.original);
  return {pack:pack!,prefix,system};
}
describe('007 runtime pack isolation',()=>{
 it('stages a verified dependency and wrapper only in the dedicated bottle; supports repeated setup',async()=>{
   const f=await fixture();const p=await setup(f);expect(p.pack.installation).toBe(f.request.installation);
   expect(p.pack.environment).toEqual({MACXUS_007_PUBLIC_CONFIG:'1'});
   expect(p.prefix).toBe(path.join(f.data,'compatibility-packs/bond-public-config-v1/bottles/xbox'));
   await p.pack.configurePrefix(p.prefix);
   expect(await fs.readFile(path.join(p.system,'mxhttp.dll'),'utf8')).toBe(f.original);
   expect(await fs.readFile(path.join(p.system,'winhttp.dll'),'utf8')).toBe(f.wrapper);
   await p.pack.configurePrefix(p.prefix);
   expect((await fs.readdir(p.system)).sort()).toEqual(['mxhttp.dll','winhttp.dll']);
   expect(await fs.readdir(f.cx)).toEqual(['etc']);expect(await fs.readdir(f.data)).toEqual(['compatibility-packs']);
 });
 it('never reads pack assets for unrelated games, engines or FEX',async()=>{
   const f=await fixture();for(const request of [{...f.request,storeId:'OTHERGAME123'},{...f.request,engine:'crossover'},{...f.request,installation:{...f.request.installation,supportsArm64:true}}])expect(await prepareGameRuntimePack(request,'/missing/unused-assets')).toBeUndefined();
   await expect(fs.stat(f.data)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('does not create user state for missing payload or an unrecognized engine build',async()=>{
   const f=await fixture();await fs.unlink(path.join(f.assets,'payload/winhttp.dll'));expect(await prepareGameRuntimePack(f.request,f.assets)).toBeUndefined();
   await expect(fs.stat(f.data)).rejects.toMatchObject({code:'ENOENT'});
   f.request.installation.version='different';expect(await prepareGameRuntimePack(f.request,f.assets)).toBeUndefined();
 });
 it('falls back for an absent pack directory, while a present incomplete/corrupt pack fails',async()=>{
   const f=await fixture();await fs.rename(f.assets,f.assets+'-removed');
   expect(await prepareGameRuntimePack(f.request,f.assets)).toBeUndefined();
   await expect(fs.stat(f.data)).rejects.toMatchObject({code:'ENOENT'});
   await fs.rename(f.assets+'-removed',f.assets);await fs.unlink(path.join(f.assets,'manifest.json'));
   await expect(prepareGameRuntimePack(f.request,f.assets)).rejects.toThrow('manifest is missing');
   await fs.writeFile(path.join(f.assets,'manifest.json'),'{broken');
   await expect(prepareGameRuntimePack(f.request,f.assets)).rejects.toThrow();
   await expect(fs.stat(f.data)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('blocks ordinary setup from following a runtime temporary-file symlink outside the bottle',async()=>{
   const f=await fixture();const p=await setup(f);const source=path.join(f.root,'runtime');await fs.mkdir(source);
   for(const name of MAC_RUNTIME_DLLS)await fs.writeFile(path.join(source,name),'synthetic runtime');
   const sentinel=path.join(f.root,'outside-sentinel');await fs.writeFile(sentinel,'preserved');
   await fs.symlink(sentinel,path.join(p.system,`xgameruntime.dll.nexus-${process.pid}`));
   await expect(p.pack.validatePrefix(p.prefix).then(()=>installRuntimeDlls(p.prefix,source))).rejects.toThrow('setup files must not be links');
   expect(await fs.readFile(sentinel,'utf8')).toBe('preserved');
   expect(await fs.readFile(path.join(p.system,'winhttp.dll'),'utf8')).toBe(f.original);
 });
 it('preflights all ordinary runtime, runner and registry write destinations',async()=>{
   const targets=[...MAC_RUNTIME_DLLS.flatMap(n=>[`drive_c/windows/system32/${n}`,`drive_c/windows/system32/${n}.nexus-${process.pid}`]),'system.reg','user.reg','.macxus-overrides'];
   for(const relative of targets){for(const kind of ['symbolic','hard']){
     const f=await fixture();const p=await setup(f);const target=path.join(p.prefix,relative),outside=path.join(f.root,'outside');
     await fs.writeFile(outside,'preserved');await fs.unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});
     if(kind==='symbolic')await fs.symlink(outside,target);else await fs.link(outside,target);
     await expect(p.pack.validatePrefix(p.prefix)).rejects.toThrow('setup files must not be links');
     expect(await fs.readFile(outside,'utf8')).toBe('preserved');
   }}
   for(const name of ['xodus-crossover-wine',`xodus-crossover-wine.tmp-${process.pid}`]){
     const f=await fixture();const p=await setup(f);const outside=path.join(f.root,'outside');await fs.writeFile(outside,'preserved');await fs.symlink(outside,path.join(p.pack.bottlesRoot,name));
     await expect(p.pack.validatePrefix(p.prefix)).rejects.toThrow('setup files must not be links');
     expect(await fs.readFile(outside,'utf8')).toBe('preserved');
   }
 });
 it('rejects a C drive mapping outside the dedicated bottle',async()=>{
   const f=await fixture();const p=await setup(f);await fs.mkdir(path.join(p.prefix,'dosdevices'));await fs.symlink(f.root,path.join(p.prefix,'dosdevices/c:'));
   await expect(p.pack.validatePrefix(p.prefix)).rejects.toThrow('own drive_c');
 });
 it('rejects tampered source before creating user state',async()=>{
   const f=await fixture();await fs.appendFile(path.join(f.assets,'source/winhttp.c'),'tampered');
   await expect(prepareGameRuntimePack(f.request,f.assets)).rejects.toThrow('checksum mismatch');
   await expect(fs.stat(f.data)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('rejects incompatible runtime DLLs and foreign sidecars without replacing them',async()=>{
   for(const change of ['base','alias']){const f=await fixture();const p=await setup(f);
    await fs.writeFile(path.join(p.system,change==='base'?'winhttp.dll':'mxhttp.dll'),'foreign');
    await expect(p.pack.validatePrefix(p.prefix)).rejects.toThrow('exact unmodified');
    await expect(p.pack.configurePrefix(p.prefix)).rejects.toThrow('exact unmodified');
    expect(await fs.readFile(path.join(p.system,'winhttp.dll'),'utf8')).toBe(change==='base'?'foreign':f.original);
    expect((await fs.readdir(p.system)).some(n=>n.startsWith('.007-runtime-'))).toBe(false);
   }
 });
 it('refuses normal bottles and symlink/hardlink destinations',async()=>{
   const f=await fixture();const p=await setup(f);
   await expect(p.pack.configurePrefix(path.join(f.data,'bottles-crossover-preview/xbox'))).rejects.toThrow('dedicated bottle');
   const outside=path.join(f.root,'outside');await fs.writeFile(outside,f.original);
   await fs.symlink(outside,path.join(p.system,'mxhttp.dll'));await expect(p.pack.configurePrefix(p.prefix)).rejects.toThrow('Invalid runtime pack destination');
   await fs.unlink(path.join(p.system,'mxhttp.dll'));await fs.link(outside,path.join(p.system,'mxhttp.dll'));
   await expect(p.pack.configurePrefix(p.prefix)).rejects.toThrow('Invalid runtime pack destination');
   expect(await fs.readFile(outside,'utf8')).toBe(f.original);expect(await fs.readFile(path.join(p.system,'winhttp.dll'),'utf8')).toBe(f.original);
 });
 it('checks parent directories before Wine setup',async()=>{
   const f=await fixture();const p=await setup(f);await fs.rename(p.system,p.system+'-outside');await fs.symlink(p.system+'-outside',p.system);
   await expect(p.pack.validatePrefix(p.prefix)).rejects.toThrow('setup directories');
 });
 it('rejects paths or unsupported environment settings in metadata',async()=>{
   const f=await fixture();expect(()=>parseRuntimePack({...f.manifest,sources:{...f.manifest.sources,'../../extra':digest('x')}})).toThrow();
   expect(()=>parseRuntimePack({...f.manifest,environment:{MACXUS_007_PUBLIC_CONFIG:'1',WINEPREFIX:'/elsewhere'}})).toThrow();
 });
});
