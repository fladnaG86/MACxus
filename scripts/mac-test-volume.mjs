import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

// A finished test process can leave security/indexing work briefly holding the
// disposable image open. Retry detach only for EBUSY. Once the mountpoint is
// gone, poll inventory only; never detach a later occupant of that path.
export async function detachMacTestVolume(mountpoint, {
  run = (tool, args, options = {}) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }),
  wait = delay,
  log = console.warn,
  imagePath,
  canonical = realpath,
} = {}) {
  const expectedImage = imagePath ? await canonical(imagePath) : undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      run('hdiutil', ['detach', mountpoint]);
      return;
    } catch (error) {
      // A busy detach may finish while hdiutil is returning its error. Never
      // infer completion from the next error alone: require a valid inventory
      // proving that both our exact image and mountpoint are absent.
      if (expectedImage && error.status === 1
          && /detach failed - No such file or directory/.test(String(error.stderr ?? ''))) {
        for (let poll = attempt; ; poll++) {
          const plist = run('hdiutil', ['info', '-plist']);
          const images = JSON.parse(run('plutil', ['-extract', 'images', 'json', '-o', '-', '-'], { input: plist }));
          if (!Array.isArray(images)) throw Error('Invalid attached-image inventory during test-volume cleanup.');
          let ownedImageAttached = false;
          for (const image of images) {
            if (!image || typeof image !== 'object' || typeof image['image-path'] !== 'string'
                || (!path.isAbsolute(image['image-path']) && !/^ram:\/\/\d+$/.test(image['image-path']))
                || !Array.isArray(image['system-entities'])) throw Error('Incomplete attached-image inventory during test-volume cleanup.');
            // RAM images cannot be our backing file. Keep mountpoint ownership
            // separate: another image at this path must never permit a retry.
            const owned = path.isAbsolute(image['image-path']) && await canonical(image['image-path']) === expectedImage;
            if (owned) ownedImageAttached = true;
            for (const entity of image['system-entities']) {
              if (!entity || typeof entity !== 'object') throw Error('Invalid attached-image entity during test-volume cleanup.');
              if ('mount-point' in entity && (typeof entity['mount-point'] !== 'string' || !path.isAbsolute(entity['mount-point']))) throw Error('Invalid attached-image mountpoint during test-volume cleanup.');
              if (!owned && typeof entity['mount-point'] === 'string' && path.resolve(entity['mount-point']) === path.resolve(mountpoint)) throw error;
            }
          }
          if (!ownedImageAttached) return;
          if (poll === 4) throw error;
          log('The disposable Mac image is still listed; waiting for confirmed detachment.');
          await wait(250 * 2 ** poll);
        }
      }
      if (error.status !== 16 || attempt === 4) throw error;
      log('The disposable Mac test volume is still attached; retrying its normal detach.');
      await wait(250 * 2 ** attempt);
    }
  }
}
