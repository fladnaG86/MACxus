import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { storeProductFixtureHeader } from './store-product-fixtures.mjs';

export function storeProbeBuilds({ build, source, tests, project }) {
  const common = ['-b', 'x86_64-w64-mingw32', '--wine-objdir', build,
    '-D__WINESRC__', '-D_UCRT', '-DLIBXML_STATIC', '-O2', '-Wall',
    '-I', tests, '-I', path.join(build, 'dlls/xgameruntime'), '-I', path.join(source, 'dlls/xgameruntime'),
    '-I', path.join(build, 'include'), '-I', path.join(source, 'include'),
    '-isystem', path.join(source, 'include/msvcrt'), '-I', path.join(source, 'libs/xml2/include')];
  return ['store-entitlements', 'store-products', 'package-content'].map(name => ({
    command: path.join(build, 'tools/winegcc/winegcc'),
    output: path.join(tests, `${name}-probe.exe`),
    args: [...common, ...(name === 'package-content' ? ['-Wextra', '-Werror'] : []),
      path.join(project, `scripts/runtime-tests/${name}-probe.c`),
      path.join(build, 'libs/xml2/x86_64-windows/libxml2.a'),
      '-o', path.join(tests, `${name}-probe.exe`),
      ...(name !== 'package-content' ? ['-lcombase', '-lole32', '-lcrypt32', '-lbcrypt', '-lwinhttp', '-ladvapi32'] : []),
      '-lwinecrt0', '-lucrtbase', '-lkernel32', '-lntdll'],
  }));
}

export function verifyStoreProbeCrt(peHeaders) {
  const imports = [...peHeaders.matchAll(/DLL Name:\s*(\S+)/g)].map(match => match[1].toLowerCase());
  if (!imports.includes('ucrtbase.dll') || imports.some(name => /^(?:msvcrt|msvcr\d+)\.dll$/.test(name)))
    throw new Error('Store probes must use Wine UCRT without legacy MSVCRT imports');
}

export function buildStoreProbes(options, run) {
  writeFileSync(path.join(options.tests, 'store-product-fixtures.h'), storeProductFixtureHeader());
  // Wine's XML archive and headers use UCRT. Plain MinGW gcc on older Ubuntu
  // defaults to MSVCRT, whose FILE objects cannot be passed to UCRT (or back).
  // Match Wine's own compiler driver, CRT headers, startup and import libraries.
  run('make', ['dlls/advapi32/x86_64-windows/libadvapi32.a', 'dlls/ole32/x86_64-windows/libole32.a'], options.build);
  for (const probe of storeProbeBuilds(options)) {
    run(probe.command, probe.args, options.build);
    verifyStoreProbeCrt(run('x86_64-w64-mingw32-objdump', ['-p', probe.output], options.build, true));
  }
}
