import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detachMacTestVolume } from '../mac-test-volume.mjs';

test('retries transient busy volumes with bounded backoff, then succeeds', async () => {
  const calls = [], waits = [];
  await detachMacTestVolume('/temporary fixture path', {
    run: (tool, args) => {
      calls.push([tool, args]);
      if (calls.length < 3) throw Object.assign(new Error('Resource busy'), { status: 16 });
    },
    wait: async ms => { waits.push(ms); }, log: () => {},
  });
  assert.deepEqual(calls, Array(3).fill(['hdiutil', ['detach', '/temporary fixture path']]));
  assert.deepEqual(waits, [250, 500]);
});

test('persistent busy errors stop after five attempts without force-ejecting', async () => {
  const error = Object.assign(new Error('Resource busy'), { status: 16 });
  let calls = 0;
  const waits = [];
  await assert.rejects(detachMacTestVolume('/fixture', {
    run: () => { calls++; throw error; }, wait: async ms => { waits.push(ms); }, log: () => {},
  }), failure => failure === error);
  assert.equal(calls, 5);
  assert.deepEqual(waits, [250, 500, 1000, 2000]);
});

test('permission and tool failures propagate immediately', async () => {
  for (const error of [Object.assign(new Error('Denied'), { status: 1 }), Object.assign(new Error('Missing'), { code: 'ENOENT' })]) {
    let calls = 0;
    await assert.rejects(detachMacTestVolume('/fixture', {
      run: () => { calls++; throw error; },
      wait: () => { throw Error('Must not retry'); }, log: () => {},
    }), failure => failure === error);
    assert.equal(calls, 1);
  }
});

const gone = () => Object.assign(new Error('detach failed'), { status: 1, stderr: 'hdiutil: detach failed - No such file or directory\n' });
function inventoryRunner(images, { busyFirst = false } = {}) {
  const calls = [];
  const run = (tool, args, options) => {
    calls.push([tool, args, options]);
    if (args[0] === 'detach') {
      if (busyFirst && calls.length === 1) throw Object.assign(new Error('Resource busy'), { status: 16 });
      throw gone();
    }
    if (tool === 'hdiutil' && args[0] === 'info') return '<plist>inventory</plist>';
    assert.equal(tool, 'plutil'); assert.deepEqual(args, ['-extract', 'images', 'json', '-o', '-', '-']);
    assert.equal(options.input, '<plist>inventory</plist>');
    return typeof images === 'string' ? images : JSON.stringify(images);
  };
  return { calls, run };
}

test('busy detach followed by a missing mount succeeds only with authoritative image absence', async () => {
  const { calls, run } = inventoryRunner([], { busyFirst: true });
  const waits = [];
  await detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run, wait: async ms => waits.push(ms), log: () => {} });
  assert.deepEqual(waits, [250]);
  assert.deepEqual(calls.map(([tool, args]) => [tool, args[0]]), [['hdiutil', 'detach'], ['hdiutil', 'detach'], ['hdiutil', 'info'], ['plutil', '-extract']]);
  assert.ok(!JSON.stringify(calls).includes('force'));
});

test('an attached image, including an unmounted device, still fails cleanup', async () => {
  for (const images of [
    [{ 'image-path': '/fixture.sparseimage', 'system-entities': [] }],
    [{ 'image-path': '/another.sparseimage', 'system-entities': [{ 'mount-point': '/fixture' }] }],
  ]) {
    const { run } = inventoryRunner(images);
    await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run, wait: async () => {}, log: () => {} }), error => error.status === 1);
  }
});

test('image identity comparison resolves canonical aliases', async () => {
  const { run } = inventoryRunner([{ 'image-path': '/private/tmp/fixture.sparseimage', 'system-entities': [] }]);
  await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/tmp/fixture.sparseimage', canonical: async file => file.replace(/^\/tmp\//, '/private/tmp/'), run, wait: async () => {}, log: () => {} }), error => error.status === 1);
});

test('missing mountpoint with a disappearing backing image gets bounded cleanup grace', async () => {
  let inventories = 0;
  const waits = [];
  const { run: originalRun, calls } = inventoryRunner([]);
  const run = (tool, args, options) => {
    if (tool === 'plutil' && ++inventories < 3) {
      return JSON.stringify([{ 'image-path': '/fixture.sparseimage', 'system-entities': [] }]);
    }
    return originalRun(tool, args, options);
  };
  await detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run, wait: async ms => waits.push(ms), log: () => {} });
  assert.deepEqual(waits, [250, 500]);
  assert.equal(inventories, 3);
  assert.equal(calls.filter(([, args]) => args[0] === 'detach').length, 1);
});

test('persistent missing-mount inventory never removes or force-detaches the image', async () => {
  const { calls, run } = inventoryRunner([{ 'image-path': '/fixture.sparseimage', 'system-entities': [] }]);
  const waits = [];
  await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run, wait: async ms => waits.push(ms), log: () => {} }), error => error.status === 1);
  assert.deepEqual(waits, [250, 500, 1000, 2000]);
  assert.equal(calls.filter(([, args]) => args[0] === 'detach').length, 1);
  assert.ok(calls.every(([tool]) => ['hdiutil', 'plutil'].includes(tool)));
  assert.ok(!JSON.stringify(calls).includes('force'));
});

test('foreign mountpoint ownership never triggers another detach or permits owned-image deletion', async () => {
  for (const foreignAppearsAfter of [0, 1]) {
    for (const ownedStillListed of [true, false]) {
      let inventories = 0, detaches = 0;
      const waits = [];
      const run = (tool, args) => {
        if (args[0] === 'detach') {
          detaches++;
          // A second detach would succeed on the foreign image. It must never
          // occur, even when ownership changes during the inventory grace.
          if (detaches === 1) throw gone();
          return '';
        }
        if (tool === 'hdiutil') return '<plist>inventory</plist>';
        const foreign = inventories++ >= foreignAppearsAfter;
        return JSON.stringify([
          ...(!foreign || ownedStillListed ? [{ 'image-path': '/fixture.sparseimage', 'system-entities': [] }] : []),
          ...(foreign ? [{ 'image-path': '/foreign.sparseimage', 'system-entities': [{ 'mount-point': '/fixture' }] }] : []),
        ]);
      };
      await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run, wait: async ms => waits.push(ms), log: () => {} }), error => error.status === 1);
      assert.equal(detaches, 1);
      assert.equal(waits.length, foreignAppearsAfter);
    }
  }
});

test('unrelated RAM images do not require filesystem identity resolution', async () => {
  const { run } = inventoryRunner([{ 'image-path': 'ram://2048', 'system-entities': [{ 'mount-point': '/another-mount' }] }]);
  await detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => { assert.equal(file, '/fixture.sparseimage'); return file; }, run });
});

test('missing or malformed inventory, identity failures and real errors are never treated as detached', async () => {
  for (const images of ['not-json', {}, [{}], [{ 'image-path': '/fixture.sparseimage' }], [{ 'image-path': '', 'system-entities': [] }], [{ 'image-path': 'unknown-source', 'system-entities': [] }], [{ 'image-path': '/other', 'system-entities': [null] }], [{ 'image-path': '/other', 'system-entities': [{ 'mount-point': 7 }] }]]) {
    const { run } = inventoryRunner(images);
    await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run }));
  }
  for (const failure of [Object.assign(new Error('Denied'), { status: 1, stderr: 'Permission denied' }), Object.assign(new Error('Tool missing'), { code: 'ENOENT' })]) {
    let calls = 0;
    await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => file, run: () => { calls++; throw failure; } }), error => error === failure);
    assert.equal(calls, 1);
  }
  const { run } = inventoryRunner([{ 'image-path': '/unresolvable', 'system-entities': [] }]);
  await assert.rejects(detachMacTestVolume('/fixture', { imagePath: '/fixture.sparseimage', canonical: async file => { if (file === '/unresolvable') throw Error('Identity unavailable'); return file; }, run }), /Identity unavailable/);
});
