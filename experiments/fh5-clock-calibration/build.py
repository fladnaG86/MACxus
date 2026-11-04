"""Build and verify an opt-in clock experiment. Never launches FH5 or uses accounts."""
from pathlib import Path
import argparse, os, subprocess, shutil, json, secrets, hashlib, stat, tempfile

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]

def validate_prefix(prefix):
    """Check write ancestors and C: before any process uses a copied prefix."""
    prefix=Path(prefix)
    for relative in ['', 'drive_c', 'drive_c/windows', 'drive_c/windows/system32', 'dosdevices']:
        target=prefix/relative
        if not stat.S_ISDIR(target.lstat().st_mode):
            raise ValueError('Synthetic prefix directory is missing or linked: '+relative)
    mapping=prefix/'dosdevices/c:'
    if not mapping.is_symlink() or mapping.resolve(strict=True)!=(prefix/'drive_c').resolve(strict=True):
        raise ValueError('Synthetic prefix C: must resolve to its own drive_c')
    for name in ['system.reg','user.reg','userdef.reg']:
        target=prefix/name
        if target.exists() or target.is_symlink():
            if not stat.S_ISREG(target.lstat().st_mode):
                raise ValueError('Synthetic prefix registry file is linked: '+name)
    return prefix/'drive_c/windows/system32'

def install_clock(prefix, source):
    system=validate_prefix(prefix)
    # Copy to an exclusively created sibling, then replace the directory entry.
    # A preserved DLL symlink/hardlink is detached, never written through.
    fd,temporary=tempfile.mkstemp(prefix='.macxus-clock-',suffix='.tmp',dir=system)
    try:
        with os.fdopen(fd,'wb') as out,Path(source).open('rb') as data:
            shutil.copyfileobj(data,out)
        os.chmod(temporary,0o644)
        os.replace(temporary,system/'macxus-clock.dll')
    finally:
        if os.path.lexists(temporary):os.unlink(temporary)

def reconstruct_source(destination, execute):
    # The current source already contains the native export and opt-in hook.
    # Reconstruct only the base D3D12 shim patches; never apply the old prototype
    # text transformations or append a second calibration export.
    shutil.copytree(REPO/'assets/fh5-preview/source',destination)
    for patch in ['fh5-timestamp.patch','metal4-frequency.patch','clock-reporting.patch']:
        execute(['git','apply',destination/'metal4'/patch],cwd=destination/'shim')
    return destination

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('output',type=Path);p.add_argument('--sdk',required=True,type=Path)
    p.add_argument('--engine',required=True,type=Path)
    p.add_argument('--prefix-template',type=Path,help='Optional previously account-free synthetic prefix; never supply an account/game bottle')
    a=p.parse_args();r=a.output.resolve()
    sdk=a.sdk.resolve();src=sdk/'wine-src';build=sdk/'wine-build';cx=a.engine.resolve()
    for forbidden in [HERE,REPO/'assets/fh5-preview',sdk,cx,*([a.prefix_template.resolve()] if a.prefix_template else [])]:
        if r==forbidden or forbidden in r.parents:raise ValueError('Keep output outside source, engine, SDK and template trees')
    r.mkdir(parents=True,exist_ok=False)
    env={k:v for k,v in os.environ.items() if not k.startswith(('WINE','CX_','DYLD_','MACXUS_','XODUS_','XUSER_','NEXUS_'))}
    results=[]
    def run(args,name=None,extra=None,cwd=None,timeout=60):
        result=subprocess.run(list(map(str,args)),env={**env,**(extra or {})},cwd=cwd,capture_output=True,text=True,timeout=timeout)
        if name:
            (r/(name+'.log')).write_text(result.stdout+result.stderr)
            results.append({'name':name,'exitCode':result.returncode,'summary':[x for x in result.stdout.splitlines() if x.startswith(('CLOCK_','NATIVE_CALIBRATION','ASYNC_OK','CALIBRATED_QUERY','MISSING_BRIDGE'))]})
            print(name,result.returncode,results[-1]['summary'],flush=True)
        if result.returncode:raise RuntimeError('Command failed: '+str(args[0])+'\n'+result.stdout[-4000:]+result.stderr[-4000:])
        return result
    for arch in ['x86_64-windows','x86_64-unix']:(r/'dlls'/arch).mkdir(parents=True)
    own=reconstruct_source(r/'source',run)
    bridge=own/'metal4/metal4-query-bridge.m'
    clang=['clang','-arch','x86_64','-mmacosx-version-min=26.0','-O2','-Wall','-Wextra','-Werror','-I'+str(own)]
    run(clang+['-dynamiclib',own/'clock/clock-unix.c','-install_name','@rpath/macxus-clock.so','-o',r/'dlls/x86_64-unix/macxus-clock.so'])
    run(clang+['-fobjc-arc','-dynamiclib',bridge,'-framework','Foundation','-framework','Metal','-install_name','@rpath/macxus-metal4-timestamps.dylib','-o',r/'macxus-metal4-timestamps.dylib'])
    run([build/'tools/winegcc/winegcc','-b','x86_64-w64-mingw32','--wine-objdir',build,'-shared','-Wl,--wine-builtin','-D__WINESRC__','-O2','-Wall','-I'+str(build/'include'),'-I'+str(src/'include'),own/'clock/clock-pe.c',own/'clock/macxus-clock.spec','-o',r/'dlls/x86_64-windows/macxus-clock.dll','-lwinecrt0','-lkernel32','-lntdll','-Wl,--no-insert-timestamp','-Wl,--build-id=none'])
    gcc=['x86_64-w64-mingw32-gcc','-O2','-Wall','-Wextra','-Wl,--no-insert-timestamp']
    run(gcc+[own/'clock/clock-probe.c','-o',r/'clock-probe.exe'])
    run(gcc+['-I'+str(own),own/'tests/gpu-clock-reporting.c','-o',r/'disabled-hook-probe.exe'])
    run(gcc+['-I'+str(own),'-shared',*[own/'shim'/name for name in ['d3d12.c','dxil_shadingrate.c','inspect.c','d3d12.def']],'-Wl,--image-base,0x180000000','-o',r/'d3d12.dll','-lws2_32','-lbcrypt'])
    # Drive the actual proxy's queue vtable around real GPU submissions.
    query=own/'tests/timestamps-async.c';text=query.read_text()
    text=text.replace('        ID3D12CommandQueue_ExecuteCommandLists(queue,1,lists);','        UINT64 g0=0,c0=0,g1=0,c1=0;\n        CHECK(ID3D12CommandQueue_GetClockCalibration(queue,&g0,&c0));\n        ID3D12CommandQueue_ExecuteCommandLists(queue,1,lists);')
    text=text.replace('        if(wait_done())return 2;','        if(wait_done())return 2;\n        CHECK(ID3D12CommandQueue_GetClockCalibration(queue,&g1,&c1));')
    text=text.replace('        previous=values[1];','        if(values[0]<g0 || values[1]>g1 || c1<c0){puts("CALIBRATION_QUERY_FAIL");return 4;}\n        printf("CALIBRATED_QUERY iteration=%u bracketed=1\\n",iteration);\n        previous=values[1];')
    query.write_text(text)
    run(gcc+[query,'-o',r/'query-probe.exe'])
    run(clang+['-fobjc-arc',own/'clock/native-probe.m','-framework','Foundation','-framework','Metal','-o',r/'native-probe'])
    run(['clang','-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer','-Wall','-Wextra','-Werror',own/'clock/math-probe.c','-o',r/'math-probe'])
    run([r/'math-probe'],'math')
    run([r/'native-probe'],'native')
    prefix=r/'prefix'
    if a.prefix_template:
        shutil.copytree(a.prefix_template.resolve(),prefix,symlinks=True)
        validate_prefix(prefix)
    else:prefix.mkdir()
    env.update(WINEPREFIX=str(prefix),CX_ROOT=str(cx),WINESERVER=str(cx/'bin/wineserver'),WINEDEBUG='-all,err+all',WINEDLLPATH=':'.join(map(str,[r/'dlls',cx/'lib/apple_gptk/wine/x86_64-windows',cx/'lib/apple_gptk/wine',cx/'lib/wine/x86_64-windows',cx/'lib/wine'])),WINEDLLOVERRIDES='winemenubuilder.exe,winedbg.exe=d;macxus-clock=b;d3d12=n,b')
    wine=cx/'lib/wine/x86_64-unix/wine'
    try:
        if not a.prefix_template:run([wine,'wineboot','--init'],'wineboot',timeout=120)
        install_clock(prefix,r/'dlls/x86_64-windows/macxus-clock.dll')
        run([wine,r/'clock-probe.exe','--missing-bridge'],'missing-bridge')
        run([wine,r/'disabled-hook-probe.exe'],'disabled-hook')
        injected={'DYLD_INSERT_LIBRARIES':str(r/'macxus-metal4-timestamps.dylib'),'MACXUS_GPU_QUERY_COOKIE':secrets.token_hex(8),'MACXUS_GPU_BRIDGE_LOG':str(r/'native-bridge'),'MACXUS_GPU_BRIDGE_PER_PROCESS':'1','D3DM_MTL4':'1'}
        run([wine,r/'clock-probe.exe'],'guest-clocks',injected)
        query_env={**injected,'HB_D3D12_REAL':'Z:'+str(cx/'lib/apple_gptk/wine/x86_64-windows/d3d12.dll').replace('/','\\'),'MACXUS_TIMESTAMP_ONLY':'1','MACXUS_APPEND_ONLY':'1','HB_TSSHIM_DEBUG':'0','MACXUS_GPU_CLOCK_CALIBRATION':'1'}
        run([wine,r/'query-probe.exe',r/'d3d12.dll'],'guest-query',query_env)
    finally:
        subprocess.run([str(cx/'bin/wineserver'),'-k'],env=env,capture_output=True,timeout=10)
        (r/'result.json').write_text(json.dumps({'gameLaunched':False,'accountUsed':False,'results':results,'files':{str(f.relative_to(r)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [r/'d3d12.dll',r/'macxus-metal4-timestamps.dylib',r/'dlls/x86_64-windows/macxus-clock.dll',r/'dlls/x86_64-unix/macxus-clock.so']}},indent=2)+'\n')
if __name__=='__main__':main()
