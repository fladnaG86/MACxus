// Kept apart from mac-backend-signing.mjs: that file is part of the backend's
// build recipe, so editing it would invalidate the backend and its Keychain grant.
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const execute = (tool, args) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A quarantined download whose seal is invalid is reported as "damaged", with no Open Anyway. */
export function verifyMacAppSeal(app, run = execute) {
  run('codesign', ['--verify', '--deep', '--strict', app]);
}

/**
 * Electron ships linker-signed stubs with no sealed resources, and identity: null
 * makes electron-builder skip signing. Seal inside-out, never with --deep: that
 * would re-sign the backend, whose code hash the Keychain grants are bound to.
 */
export function signMacApp(app, run = execute, entries = readdirSync) {
  const frameworks = path.join(app, 'Contents', 'Frameworks');
  const nested = entries(frameworks).filter(name => /\.(?:framework|app)$/.test(name)).sort();
  for (const target of [...nested.map(name => path.join(frameworks, name)), app]) {
    run('codesign', ['--force', '--sign', '-', target]);
  }
  verifyMacAppSeal(app, run);
}
