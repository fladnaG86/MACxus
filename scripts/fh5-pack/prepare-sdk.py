"""Prepare only the pinned Wine PE build SDK; never install Wine or start a game."""
import argparse, json, os, re, shutil
from pathlib import Path
from build import REPO, PACK, execute, sha, check, sdk_digest, runtime_lock_file

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--wine-mirror', type=Path)
    parser.add_argument('--runtime-mirror', type=Path)
    parser.add_argument('--nghttp2-mirror', type=Path)
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 32: raise ValueError('jobs must be 1..32')
    root = args.output.resolve()
    if root == REPO or REPO.is_relative_to(root): raise ValueError('SDK output must not contain the recipe')
    root.mkdir(parents=True, exist_ok=False)
    pack_lock = json.loads((PACK / 'source.lock.json').read_text())
    lock_file = runtime_lock_file(pack_lock)
    lock = json.loads(lock_file.read_text())
    env = {k: v for k, v in os.environ.items() if not k.startswith(('WINE', 'CX_', 'DYLD_', 'MACXUS_', 'XODUS_', 'XUSER_', 'NEXUS_'))}
    env.update(SOURCE_DATE_EPOCH=str(pack_lock['sourceDateEpoch']), LC_ALL='C')
    def run(command, cwd=root): return execute(command, cwd, env=env)
    def checkout(name, target, mirror):
        source = lock['sources'][name]
        # Git creates an empty directory for the Wine xgameruntime gitlink.
        if target.exists():
            if target.is_symlink() or not target.is_dir() or any(target.iterdir()): raise ValueError('SDK checkout destination is not empty')
        else: target.mkdir(parents=True, exist_ok=False)
        run(['git', 'init', '--quiet', target])
        run(['git', '-C', target, 'fetch', '--depth', '1', '--no-tags', mirror.resolve() if mirror else source['url'], source['commit']])
        run(['git', '-C', target, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'])
        actual = execute(['git', '-C', target, 'rev-parse', 'HEAD'], root, True, env).decode().strip()
        if actual != source['commit']: raise ValueError('Pinned SDK checkout mismatch')
    source = root / 'wine-src'; build = root / 'wine-build'
    checkout('wine', source, args.wine_mirror)
    checkout('xgameruntime', source / 'dlls/xgameruntime', args.runtime_mirror)
    nghttp2=root/'nghttp2-src'
    checkout('nghttp2',nghttp2,args.nghttp2_mirror)
    # makedep scans the patched WinHTTP source even though this SDK builds only
    # xgameruntime/JSON. Supply pinned declarations, not a cached WinHTTP binary.
    headers=source/'include/nghttp2';headers.mkdir()
    shutil.copyfile(nghttp2/'lib/includes/nghttp2/nghttp2.h',headers/'nghttp2.h')
    version=lock['sources']['nghttp2']['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Unsupported pinned nghttp2 version')
    major,minor,patch=map(int,version.split('.'))
    if max(major,minor,patch)>255:raise ValueError('Unsupported nghttp2 version field')
    template=(nghttp2/'lib/includes/nghttp2/nghttp2ver.h.in').read_text()
    template=template.replace('@PACKAGE_VERSION@',version).replace('@PACKAGE_VERSION_NUM@',f'0x{major:02x}{minor:02x}{patch:02x}')
    if '@PACKAGE_' in template:raise ValueError('Unknown nghttp2 version template')
    (headers/'nghttp2ver.h').write_text(template)
    for patch in lock['patches']:
        file = REPO / patch['file']
        if sha(file) != patch['sha256']: raise ValueError('SDK patch checksum mismatch')
        if patch.get('repository'): continue
        run(['git', 'apply', '--check', file], source)
        run(['git', 'apply', file], source)
    check(source, lock['expectedXgameruntimeSources'])
    check(source, lock.get('expectedWineSources', {}))
    run(['python3', 'make_vulkan', '-x', 'vk.xml', '-X', 'video.xml'], source / 'dlls/winevulkan')
    run(['perl', 'tools/make_specfiles'], source)
    run(['autoreconf', '-fiv'], source)
    build.mkdir()
    run([os.path.relpath(source / 'configure', build), '--enable-archs=x86_64', '--disable-tests',
         '--without-x', '--without-wayland', '--without-gstreamer', '--without-vulkan'], build)
    run(['make', '-j' + str(args.jobs), 'dlls/xgameruntime/x86_64-windows/xgameruntime.dll',
         'dlls/windows.web/x86_64-windows/windows.web.dll'], build)
    for relative, expected in pack_lock['sdkGeneratedHeaders'].items():
        if sdk_digest(build / relative, relative) != expected: raise ValueError('Generated SDK input mismatch: ' + relative)
    (root / 'sdk.json').write_text(json.dumps({'schema': 1, 'wineCommit': pack_lock['wineCommit'],
        'generatedInputsVerified': len(pack_lock['sdkGeneratedHeaders']), 'gameLaunched': False,
        'installed': False}, indent=2) + '\n')
    print('Pinned SDK prepared and generated inputs verified; no installation or game launch.')

if __name__ == '__main__': main()
