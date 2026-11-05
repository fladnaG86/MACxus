import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseRuntimePack } from '../src/shared/runtime-pack-schema.mjs';
import { runtimePackRoot, verifyRuntimePackDirectory } from './runtime-packs.mjs';
const project = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--rebuild')) throw Error('Usage: prepare-runtime-pack.mjs [--rebuild]');
const root = path.join(project, runtimePackRoot);
const m = parseRuntimePack(JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')));
const hash = b => createHash('sha256').update(b).digest('hex');
let valid = false;
try { valid = !args.includes('--rebuild') && hash(await fs.readFile(path.join(root, 'payload/winhttp.dll'))) === m.dllSHA256; } catch { /* Build below. */ }
if (!valid) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-runtime-pack-'));
  try {
    const output = path.join(work, 'output');
    execFileSync(process.execPath, [path.join(root, 'source/build.mjs'), '--out', output], { stdio: 'inherit' });
    const bytes = await fs.readFile(path.join(output, 'winhttp.dll'));
    if (hash(bytes) !== m.dllSHA256) throw Error('Unaccepted runtime compatibility artifact.');
    const payload = path.join(root, 'payload'); await fs.mkdir(payload, { recursive: true });
    const temporary = path.join(payload, `winhttp.dll.${process.pid}.tmp`);
    try { await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 }); await fs.rename(temporary, path.join(payload, 'winhttp.dll')); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}
await verifyRuntimePackDirectory(root);
console.log(`${m.id}: payload, recipe, tests and license verified.`);
