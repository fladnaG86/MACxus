const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') {
    const { readBundledBackend } = await import('../dist-electron/main/bundled-backend.js');
    const backend = path.join(context.appOutDir, 'MACxus.app', 'Contents', 'Resources', 'backend');
    const { manifest } = await readBundledBackend(backend, 'arm64');
    const { verifyMacBackendSigning } = await import('./mac-backend-signing.mjs');
    verifyMacBackendSigning(backend, manifest.signingIdentity);
    return;
  }
  if (context.electronPlatformName !== 'linux') return;
  const root = context.appOutDir;
  const executable = path.join(root, 'xodus-nexus');
  const bootstrap = path.join(root, 'resources', 'font-bootstrap');
  await fs.rename(executable, executable + '.bin');
  await fs.mkdir(bootstrap, { recursive: true });
  await fs.copyFile(path.join(__dirname, 'launcher-font-wrapper.sh'), executable);
  await fs.chmod(executable, 0o755);
  await fs.copyFile(path.join(__dirname, 'launcher-font-bootstrap.mjs'), path.join(bootstrap, 'bootstrap.mjs'));
  await fs.copyFile(path.join(__dirname, '..', 'dist-electron', 'main', 'launcher-fonts.js'), path.join(bootstrap, 'launcher-fonts.mjs'));
};
