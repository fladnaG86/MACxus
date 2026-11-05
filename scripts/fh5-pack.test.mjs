import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { createHash } from 'node:crypto';
import { createPackage } from '@electron/asar';
import { finished } from 'node:stream/promises';
import { stageFH5Bundle, stageFH5Source, verifyFH5Directory, verifyPackagedFH5 } from './fh5-pack.mjs';
const hash = data => createHash('sha256').update(data).digest('hex');
async function fixture() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fh5 distribution paths '));const app=path.join(root,'app'),assets=path.join(app,'assets/fh5-preview'),bundle=path.join(root,'build');
 await fs.mkdir(path.join(bundle,'payload'),{recursive:true});await fs.mkdir(assets,{recursive:true});
 const files=Object.fromEntries(['d3d12.dll','macxus-metal4-timestamps.dylib','windows.web.dll','xgameruntime.dll','macxus-clock.dll','macxus-clock.so'].map(name=>[name,hash('owned-'+name)]));
 for(const name of Object.keys(files))await fs.writeFile(path.join(bundle,'payload',name),'owned-'+name);
 const sourceArchive={name:'fh5-preview-v1-source.tar.gz',sha256:hash('complete-source-fixture')};
 await fs.writeFile(path.join(bundle,sourceArchive.name),'complete-source-fixture');
 for(const name of ['README.md','COPYING.GPL-3.0','COPYING.LGPL-2.1','source.lock.json','loader-entitlements.plist'])await fs.writeFile(path.join(assets,name),'fixture-'+name);
 const manifest={schema:1,id:'fh5-preview-v1',storeId:'9NNX1VVR3KNQ',files,sourceArchive,sourceLockSHA256:hash('fixture-source.lock.json'),loaderEntitlementsSHA256:hash('fixture-loader-entitlements.plist')};
 await fs.writeFile(path.join(assets,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(path.join(bundle,'build.json'),JSON.stringify(manifest));return{root,app,assets,bundle,manifest};
}
test('optional pack is inactive without payload; staging requires exact accepted build and source archive',async()=>{
 const f=await fixture();try{
  assert.equal((await verifyFH5Directory(f.assets)).enabled,false);
  await fs.appendFile(path.join(f.bundle,'payload/d3d12.dll'),'corrupt');
  await assert.rejects(stageFH5Bundle(f.bundle,f.assets),/checksum/);
  await assert.rejects(fs.stat(path.join(f.assets,'payload')),/ENOENT/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('publishes corresponding source next to release artifacts and excludes it from the ASAR',async()=>{
 const f=await fixture();try{
  await stageFH5Bundle(f.bundle,f.assets);assert.equal((await verifyFH5Directory(f.assets)).enabled,true);
  const release=path.join(f.root,'release');const staged=await stageFH5Source(f.assets,release);assert.equal(staged.length,1);assert.equal(hash(await fs.readFile(staged[0].file)),f.manifest.sourceArchive.sha256);
  const bad=path.join(f.root,'bad.asar');await finished(await createPackage(f.app,bad));await assert.rejects(verifyPackagedFH5(bad),/release asset/);
  await fs.rm(path.join(f.assets,'source-release'),{recursive:true});const good=path.join(f.root,'good.asar');await finished(await createPackage(f.app,good));assert.equal((await verifyPackagedFH5(good)).enabled,true);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('rejects linked staging directories and refuses a damaged installed payload cache',async()=>{
 const f=await fixture();try{
  const other=path.join(f.root,'other');await fs.mkdir(other);await fs.symlink(other,path.join(f.assets,'source-release'));
  await assert.rejects(stageFH5Bundle(f.bundle,f.assets),/must not be links/);assert.deepEqual(await fs.readdir(other),[]);
  await fs.unlink(path.join(f.assets,'source-release'));await stageFH5Bundle(f.bundle,f.assets);
  await fs.appendFile(path.join(f.assets,'payload/windows.web.dll'),'tampered');await assert.rejects(stageFH5Bundle(f.bundle,f.assets),/checksum/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
