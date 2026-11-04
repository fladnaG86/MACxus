import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPackage, extractFile } from '@electron/asar';
import { finished } from 'node:stream/promises';
import { verifyRuntimeDlls } from '../mac-runtime-dlls.mjs';

const names = ['gamingtcui.dll', 'twinapi.appcore.dll', 'windows.web.dll', 'winhttp.dll', 'xgameruntime.dll'];

test('validates actual ASAR contents and rejects missing, corrupt or mismatched runtime DLLs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-dll-test-'));
  try {
    const source = path.join(root, 'source');
    const dir = path.join(source, 'assets/mac-runtime-dlls');
    await fs.mkdir(dir, { recursive: true });
    const manifest = { runtime: 'fixture-runtime', sha256: {} };
    for (const name of names) {
      const bytes = Buffer.from(`synthetic DLL ${name}`);
      manifest.sha256[name] = createHash('sha256').update(bytes).digest('hex');
      await fs.writeFile(path.join(dir, name), bytes);
    }
    const verify = async (label, value = manifest) => {
      await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(value));
      const archive = path.join(root, `${label}.asar`);
      await finished(await createPackage(source, archive));
      return verifyRuntimeDlls(name => extractFile(archive, `assets/mac-runtime-dlls/${name}`), manifest);
    };
    await verify('valid');
    await assert.rejects(verify('wrong-runtime', { ...manifest, runtime: 'other' }), /manifest/);
    await assert.rejects(verify('wrong-hashes', { ...manifest, sha256: {} }), /manifest/);
    await fs.writeFile(path.join(dir, names[0]), 'corrupt');
    await assert.rejects(verify('corrupt'), /Corrupt Mac runtime DLL/);
    await fs.rm(path.join(dir, names[0]));
    await assert.rejects(verify('missing'), /Missing Mac runtime DLL/);
    await assert.rejects(verifyRuntimeDlls(() => '{}', { runtime: 'fixture', sha256: {} }), /manifest/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
