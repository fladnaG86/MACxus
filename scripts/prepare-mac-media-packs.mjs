import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// npm appends arguments only to the final command in an && chain. Dispatch
// explicitly so --rebuild reaches both pack builders in reproducibility CI.
const args = process.argv.slice(2);
execFileSync(process.execPath, [fileURLToPath(new URL('./prepare-compatibility-packs.mjs', import.meta.url)), ...args], { stdio: 'inherit' });
execFileSync(process.execPath, [fileURLToPath(new URL('./prepare-runtime-pack.mjs', import.meta.url)), ...args.filter(arg => arg === '--rebuild')], { stdio: 'inherit' });
