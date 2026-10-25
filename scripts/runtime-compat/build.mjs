// SPDX-License-Identifier: MIT
// Standalone, account-free build of the runtime's native SDK compatibility layer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export async function buildCompatibility(output) {
  const source = path.dirname(fileURLToPath(import.meta.url));
  await fs.mkdir(output, { recursive: true });
  const definition = await fs.readFile(path.join(source, 'playfab-save-folder.def'), 'utf8');
  const names = [...definition.matchAll(/^(PF\w+)(?:=\S+)? @(\d+)$/gm)];
  if (names.length !== 40 || names.some((item, i) => Number(item[2]) !== i + 1) ||
      names.map(item => item[1]).join() !== names.map(item => item[1]).sort().join())
    throw new Error('Unsupported SDK export contract');
  await fs.writeFile(path.join(output, 'pgs-exports.h'),
    `#define PGS_EXPORT_COUNT ${names.length}\nstatic const char *const pgs_exports[] = {\n` +
    names.map(item => `  "${item[1]}"`).join(',\n') + '\n};\n');
  const env = { ...process.env };
  for (const key of ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'CPATH', 'LIBRARY_PATH']) delete env[key];
  const run = (command, args) => execFileSync(command, args, { env, stdio: 'inherit' });
  // InitOnce/SRW locks and TaskDialog require Vista APIs. Older MinGW headers
  // default to an earlier Windows version, so declare the API baseline rather
  // than relying on the compiler distribution's default.
  const windowsTarget = ['-D_WIN32_WINNT=0x0600'];
  run('x86_64-w64-mingw32-gcc', ['-shared', '-O2', '-Wall', '-Wextra', '-Werror',
    ...windowsTarget,
    '-Wl,--no-insert-timestamp', '-o', path.join(output, 'PlayFabGameSave.dll'),
    path.join(source, 'playfab-save-folder.c'), path.join(source, 'playfab-session.c'),
    path.join(source, 'playfab-save-folder.def')]);
  run('gcc', ['-O2', '-Wall', '-Wextra', '-Werror', '-I', output,
    '-o', path.join(output, 'wine-launcher'), path.join(source, 'wine-launcher.c')]);
  run('x86_64-w64-mingw32-gcc', ['-O2', '-Wall', '-Wextra', '-Werror', '-Wl,--no-insert-timestamp',
    ...windowsTarget,
    '-o', path.join(output, 'gaming-services-version.exe'), path.join(source, 'gaming-services-version.c'), '-ladvapi32']);
  const elf = execFileSync('objdump', ['-T', path.join(output, 'wine-launcher')], { env, encoding: 'utf8' });
  for (const [, major, minor] of elf.matchAll(/GLIBC_(\d+)\.(\d+)/g)) {
    if (Number(major) > 2 || (Number(major) === 2 && Number(minor) > 35))
      throw new Error('Wine runtime shim must remain compatible with glibc <= 2.35');
  }
  const hashes = {};
  for (const name of ['PlayFabGameSave.dll', 'wine-launcher', 'gaming-services-version.exe'])
    hashes[name] = createHash('sha256').update(await fs.readFile(path.join(output, name))).digest('hex');
  await fs.copyFile(path.join(source, '../../LICENSE'), path.join(output, 'runtime-compat-LICENSE'));
  return hashes;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: build.mjs NEW_COMPONENT_DIRECTORY');
  console.log(JSON.stringify(await buildCompatibility(path.resolve(process.argv[2]))));
}
