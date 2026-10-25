import path from 'node:path';
import { execFileSync } from 'node:child_process';

const binaries = ['xodus-cli', 'xodus-service'];
const execute = (tool, args) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** No Keychain lookup unless a maintainer explicitly requests certificate signing. */
export function resolveMacSigningIdentity(requested, run = execute) {
  const selector = requested?.trim();
  if (!selector) return null;
  const output = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  const identities = [...output.matchAll(/^\s*\d+\)\s+([a-f\d]{40})\s+"(.*)"\s*$/gim)]
    .map(match => ({ hash: match[1].toUpperCase(), name: match[2] }));
  const matches = identities.filter(item => item.hash === selector.toUpperCase() || item.name === selector);
  if (matches.length !== 1) throw Error('MACXUS_SIGNING_IDENTITY must match exactly one valid code-signing identity in the build Keychain. Use its SHA-1 fingerprint to disambiguate.');
  return matches[0].hash;
}

export function verifyMacBackendSigning(directory, identity, run = execute) {
  if (identity === null) return;
  if (!/^[A-F\d]{40}$/.test(identity)) throw Error('Invalid backend signing certificate fingerprint.');
  for (const name of binaries) {
    const requirement = `=identifier "io.macxus.${name}" and certificate leaf = H"${identity}"`;
    run('codesign', ['--verify', '--strict', '--test-requirement', requirement, path.join(directory, name)]);
  }
}

/** Sign copies in the shipping bundle, never Cargo's reusable build output. */
export function signMacBackend(directory, identity, run = execute) {
  if (identity === null) return;
  if (!/^[A-F\d]{40}$/.test(identity)) throw Error('Invalid backend signing certificate fingerprint.');
  for (const name of binaries) {
    run('codesign', ['--force', '--sign', identity, '--identifier', `io.macxus.${name}`, path.join(directory, name)]);
  }
  verifyMacBackendSigning(directory, identity, run);
}
