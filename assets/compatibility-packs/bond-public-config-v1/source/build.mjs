// Copyright (c) 2026 MACxus contributors. SPDX-License-Identifier: MIT
// Standalone recipe: no game files, installation paths or network access required.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(source);
const hash = b => createHash('sha256').update(b).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out') throw Error('Usage: node source/build.mjs --out NEW_OUTPUT_DIRECTORY');
const output = path.resolve(args[1]);
try { await fs.lstat(output); throw Error('Output already exists; select a new directory.'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const compiler = process.env.CC || 'x86_64-w64-mingw32-gcc';
const version = execFileSync(compiler, ['-dumpfullversion'], { encoding: 'utf8' }).trim();
if (version !== manifest.toolchain.gcc) throw Error(`Expected MinGW GCC ${manifest.toolchain.gcc}; received ${version}.`);
for (const [name, expected] of Object.entries(manifest.sources)) {
  if (!['winhttp.c', 'winhttp.def', 'build.mjs', 'test.c'].includes(name)) throw Error('Invalid source lock name.');
  if (hash(await fs.readFile(path.join(source, name))) !== expected) throw Error(`Source checksum mismatch: ${name}.`);
}
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-007-build-'));
try {
  for (const name of ['winhttp.c', 'winhttp.def']) await fs.copyFile(path.join(source, name), path.join(work, name));
  // This C forwarder has no TLS, constructors or CRT-managed state. Use its
  // DllMain directly and import C helpers from msvcrt; toolchain CRT startup
  // objects differ between Homebrew's macOS bottles even at the same version.
  // Strip at link time so those bottles' debug paths cannot enter the payload.
  execFileSync(compiler, ['-shared', '-nostdlib', '-s', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-cast-function-type',
    'winhttp.c', 'winhttp.def', '-o', 'winhttp.dll', '-Wl,--no-insert-timestamp,--image-base,0x180000000,--entry,DllMain',
    '-lkernel32', '-lmsvcrt', '-lgcc'],
    { cwd: work, stdio: 'inherit', env: { ...process.env, SOURCE_DATE_EPOCH: '0' } });
  const dll = await fs.readFile(path.join(work, 'winhttp.dll'));
  if (hash(dll) !== manifest.dllSHA256) throw Error('Built DLL differs from the accepted candidate; validate before changing the manifest.');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output); // exclusive; an existing destination is never reused
  await fs.writeFile(path.join(output, 'winhttp.dll'), dll, { flag: 'wx', mode: 0o644 });
  await fs.writeFile(path.join(output, 'build-receipt.json'), JSON.stringify({
    pack: manifest.id, dllSHA256: hash(dll), toolchain: manifest.toolchain, sources: manifest.sources,
    sourcePathPolicy: 'relative-inputs-stripped-v2', entryPoint: 'DllMain', gameCodeIncluded: false, gameLaunched: false,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(`${manifest.id}: accepted DLL reproduced.`);
} finally { await fs.rm(work, { recursive: true, force: true }); }
