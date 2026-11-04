import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPackage } from '@electron/asar';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runtimePackRoot, verifyRuntimePackDirectory, verifyPackagedRuntimePack } from './runtime-packs.mjs';
const reference=new URL('../assets/compatibility-packs/bond-public-config-v1/',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');

test('actual ASAR contains complete own source, recipe, license and accepted payload',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-pack-asar-'));
 try{
  const app=path.join(temp,'app'),pack=path.join(app,runtimePackRoot);await fs.mkdir(path.dirname(pack),{recursive:true});await fs.cp(reference,pack,{recursive:true,filter:p=>!p.includes('/payload')});
  const manifest=JSON.parse(await fs.readFile(path.join(pack,'manifest.json'),'utf8'));manifest.dllSHA256=hash('synthetic payload');await fs.mkdir(path.join(pack,'payload'));await fs.writeFile(path.join(pack,'payload/winhttp.dll'),'synthetic payload');await fs.writeFile(path.join(pack,'manifest.json'),JSON.stringify(manifest));
  await verifyRuntimePackDirectory(pack);let archive=path.join(temp,'good.asar');await createPackage(app,archive);await verifyPackagedRuntimePack(archive);
  await fs.unlink(path.join(pack,'source/build.mjs'));archive=path.join(temp,'missing-source.asar');await createPackage(app,archive);await assert.rejects(verifyPackagedRuntimePack(archive));
  await fs.copyFile(new URL('source/build.mjs',reference),path.join(pack,'source/build.mjs'));await fs.writeFile(path.join(pack,'payload/winhttp.dll'),'tampered');archive=path.join(temp,'bad-payload.asar');await createPackage(app,archive);await assert.rejects(verifyPackagedRuntimePack(archive),/checksum mismatch/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('standalone recipe reproduces accepted bytes across roots with spaces and rejects changed sources',async t=>{
 let version;try{version=execFileSync(process.env.CC||'x86_64-w64-mingw32-gcc',['-dumpfullversion'],{encoding:'utf8'}).trim();}catch{t.skip('MinGW compiler unavailable');return;}
 const accepted=JSON.parse(await fs.readFile(new URL('manifest.json',reference),'utf8')).toolchain.gcc;
 if(version!==accepted){t.skip(`Accepted MinGW GCC ${accepted} unavailable; found ${version}`);return;}
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-pack-reproduction-'));
 try{
  const outputs=[];
  for(const dirname of ['short','a different nested root with spaces/pack']){
   const pack=path.join(temp,dirname);await fs.mkdir(path.dirname(pack),{recursive:true});await fs.cp(reference,pack,{recursive:true,filter:p=>!p.includes('/payload')});const out=path.join(pack,'built');
   execFileSync(process.execPath,[path.join(pack,'source/build.mjs'),'--out',out],{stdio:'pipe'});outputs.push(await fs.readFile(path.join(out,'winhttp.dll')));
   assert.throws(()=>execFileSync(process.execPath,[path.join(pack,'source/build.mjs'),'--out',out],{stdio:'pipe'}));
  }
  assert.deepEqual(outputs[0],outputs[1]);
  const pack=path.join(temp,'short');await fs.appendFile(path.join(pack,'source/winhttp.c'),'tampered');assert.throws(()=>execFileSync(process.execPath,[path.join(pack,'source/build.mjs'),'--out',path.join(temp,'must-not-exist')],{stdio:'pipe'}));
  await assert.rejects(fs.stat(path.join(temp,'must-not-exist')),{code:'ENOENT'});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
