import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storeProductFixtures, storeProductFixtureHeader } from './store-product-fixtures.mjs';
import { buildStoreProbes, storeProbeBuilds, verifyStoreProbeCrt } from './build-store-probes.mjs';

const options = { build: '/tmp/build with spaces', source: '/tmp/source', tests: '/tmp/tests', project: '/tmp/project' };
test('XML helper probes use pinned Wine headers, driver and UCRT startup', () => {
  const probes = storeProbeBuilds(options);
  assert.equal(probes.length, 3);
  for (const probe of probes) {
    assert.equal(probe.command, `${options.build}/tools/winegcc/winegcc`);
    assert.deepEqual(probe.args.slice(0, 4), ['-b', 'x86_64-w64-mingw32', '--wine-objdir', options.build]);
    for (const arg of ['-D_UCRT', '/tmp/source/include/msvcrt', '-lwinecrt0', '-lucrtbase', '-lkernel32', '-lntdll'])
      assert.ok(probe.args.includes(arg), arg);
    assert.ok(probe.args.includes(`${options.build}/libs/xml2/x86_64-windows/libxml2.a`));
    assert.equal(probe.args[probe.args.indexOf('/tmp/source/include/msvcrt') - 1], '-isystem');
    assert.ok(!probe.args.includes('-lucrt'));
  }
});
test('PE inspection rejects the CI mixed-CRT crash and missing UCRT', () => {
  assert.doesNotThrow(() => verifyStoreProbeCrt('DLL Name: kernel32.dll\nDLL Name: UCRTBASE.dll\n'));
  for (const text of ['', 'DLL Name: msvcrt.dll', 'DLL Name: ucrtbase.dll\nDLL Name: msvcrt.dll',
    'DLL Name: ucrtbase.dll\nDLL Name: MSVCR120.dll']) assert.throws(() => verifyStoreProbeCrt(text), /Wine UCRT/);
});
test('builder checks all compiled executables and fails closed on mixed imports', () => {
  const tests = fs.mkdtempSync(path.join(os.tmpdir(), 'store probe fixtures '));
  const local = { ...options, tests };
  const calls = [];
  try {
    buildStoreProbes(local, (...args) => { calls.push(args); return 'DLL Name: ucrtbase.dll'; });
    assert.equal(calls.length, 7);
    assert.equal(calls[0][0], 'make');
    assert.equal(calls.filter(call => call[0].endsWith('/winegcc')).length, 3);
    assert.equal(calls.filter(call => call[0].endsWith('objdump') && call[3] === true).length, 3);
    assert.ok(fs.readFileSync(path.join(tests, 'store-product-fixtures.h'), 'utf8').includes('Synthetic add-on'));
    assert.throws(() => buildStoreProbes(local, () => 'DLL Name: msvcrt.dll'), /Wine UCRT/);
  } finally { fs.rmSync(tests, { recursive: true, force: true }); }
});

test('synthetic fixtures retain exact SKU ownership and negative/filter controls', () => {
  const fixtures = storeProductFixtures();
  assert.equal(fixtures.fixture.Products[0].ProductId, 'B00000000001');
  assert.equal(fixtures['two-skus'].Products[0].DisplaySkuAvailabilities[1].Sku.SkuId, '0011');
  assert.equal(fixtures['bad-price'].Products[0].DisplaySkuAvailabilities[0].Availabilities[0].OrderManagementData.Price.ListPrice, -1);
  assert.equal(fixtures.delisted.Products[0].DisplaySkuAvailabilities[0].Availabilities[0].Actions.includes('Purchase'), false);
  assert.equal(fixtures.duplicate.Products.length, 2);
  assert.equal(fixtures.fixture.Products.length, 1);
  assert.equal(storeProductFixtureHeader(), storeProductFixtureHeader());
  assert.ok(!storeProductFixtureHeader().includes(process.cwd()));
});
