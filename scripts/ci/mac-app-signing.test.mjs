import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signMacApp, verifyMacAppSeal } from '../mac-app-signing.mjs';

test('the app is sealed inside-out, leaving the backend signatures alone, and then verified strictly', () => {
  const calls = [];
  const entries = () => ['Squirrel.framework', 'MACxus Helper.app', 'Electron Framework.framework', 'LICENSES.txt'];
  signMacApp('/MACxus.app', (command, args) => { calls.push([command, args]); return ''; }, entries);
  const sign = target => ['codesign', ['--force', '--sign', '-', target]];
  assert.deepEqual(calls, [
    sign('/MACxus.app/Contents/Frameworks/Electron Framework.framework'),
    sign('/MACxus.app/Contents/Frameworks/MACxus Helper.app'),
    sign('/MACxus.app/Contents/Frameworks/Squirrel.framework'),
    sign('/MACxus.app'),
    ['codesign', ['--verify', '--deep', '--strict', '/MACxus.app']],
  ]);
});

test('a bundle with a broken seal stops the build', () => {
  const failure = () => { throw Error('code has no resources but signature indicates they must be present'); };
  assert.throws(() => verifyMacAppSeal('/MACxus.app', failure), /no resources/);
  assert.throws(() => signMacApp('/MACxus.app', failure, () => []), /no resources/);
});
