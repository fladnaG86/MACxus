"""Run only synthetic account-free pack probes. Never starts FH5 or an account service."""
import argparse, hashlib, json, os, secrets, shutil, subprocess, time
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build',type=Path);parser.add_argument('--engine',type=Path);parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--check-inputs-only',action='store_true')
    args=parser.parse_args()
    if not args.check_inputs_only and not args.engine: parser.error('--engine is required for runtime probes')
    build=args.build.resolve();root=args.output.resolve();root.mkdir(parents=True,exist_ok=False)
    receipt=json.loads((build/'build.json').read_text())
    assets=Path(__file__).resolve().parents[2]/'assets/fh5-preview'
    descriptor=assets/'manifest.json'
    if not descriptor.exists(): descriptor=assets/'verification.json'
    manifest=json.loads(descriptor.read_text())
    if descriptor.name=='verification.json' and (manifest.get('sourceReleaseDescriptor')!=1 or 'sourceArchive' in manifest):raise ValueError('Invalid source-release verification descriptor')
    if receipt['sourceLockSHA256']!=manifest['sourceLockSHA256']:raise ValueError('Build source lock differs from the verification descriptor')
    if hashlib.sha256((assets/'source.lock.json').read_bytes()).hexdigest()!=manifest['sourceLockSHA256']:raise ValueError('Verification source lock changed')
    if receipt['files']!=manifest['files']:raise ValueError('Build is not the committed pack candidate')
    for name,expected in receipt['files'].items():
        if name not in ['d3d12.dll','xgameruntime.dll','windows.web.dll','macxus-metal4-timestamps.dylib','macxus-clock.dll','macxus-clock.so'] or hashlib.sha256((build/'payload'/name).read_bytes()).hexdigest()!=expected:raise ValueError('Pack payload changed')
    if args.check_inputs_only:
        (root/'inputs.json').write_text(json.dumps({'payloadVerified':True,'sourceLockVerified':True,'engineVerified':False,'gameLaunched':False,'accountUsed':False})+'\n')
        print('Source-release descriptor and build payload verified; no engine or runtime accessed.');return
    engine=args.engine.resolve()
    for name,expected in manifest['engineFiles'].items():
        if hashlib.sha256((engine/name).read_bytes()).hexdigest()!=expected:raise ValueError('Unexpected Preview component: '+name)
    env={key:value for key,value in os.environ.items() if not key.startswith(('XODUS_','XUSER_','WINE','CX_','DYLD_','MACXUS_','NEXUS_','Steam','STEAM_'))}
    prefix=root/'prefix';prefix.mkdir();env.update(WINEPREFIX=str(prefix),CX_ROOT=str(engine),WINESERVER=str(engine/'bin/wineserver'),WINELOADER=str(engine/'lib/wine/x86_64-unix/wine'),WINEDEBUG='-all,err+all',WINEDLLOVERRIDES='winemenubuilder.exe,winedbg.exe=d;xgameruntime,windows.web=n,b')
    results=[]
    def run(name,command,extra_env=None):
        with (root/(name+'.log')).open('wb') as log:
            child=subprocess.Popen(list(map(str,command)),env={**env,**(extra_env or {})},stdout=log,stderr=subprocess.STDOUT)
            try:code=child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                subprocess.run([engine/'bin/wineserver','-k'],env=env,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);child.kill();child.wait();raise
        text=(root/(name+'.log')).read_text(errors='replace');summaries=[line for line in text.splitlines() if 'CHECKS' in line or line.startswith('FAIL ')]
        results.append({'name':name,'exitCode':code,'summary':summaries});print(name,code,summaries,flush=True)
        if code:raise ValueError('Synthetic probe failed: '+name)
    try:
        wine=engine/'lib/wine/x86_64-unix/wine';run('wineboot',[wine,'wineboot','--init'])
        system=prefix/'drive_c/windows/system32'
        for name in ['xgameruntime.dll','windows.web.dll','macxus-clock.dll']:
            temporary=system/(name+'.pack');shutil.copyfile(build/'payload'/name,temporary);temporary.replace(system/name)
        for name in ['data-fixture','input-layout-contracts','unused-blend-contracts','gpu-clock-reporting','io-lifetime','stream-debug-contracts','nvapi-profile','nvapi-memory','heap-import','store-addons']:
            run(name,[wine,build/'probes'/(name+'.exe')])
        provider=engine/'lib/apple_gptk/wine/x86_64-windows/nvapi64.dll'
        temporary=system/'nvapi64.dll.pack';shutil.copyfile(provider,temporary);temporary.replace(system/'nvapi64.dll')
        nvapi_env={'MACXUS_PROCESS_OBSERVER':'1','MACXUS_FH5_NVAPI_PROFILE':'1','MACXUS_FH5_NVAPI_MEMORY':'1',
                   'MACXUS_TIMESTAMP_ONLY':'1','MACXUS_APPEND_ONLY':'1','HB_TSSHIM_DEBUG':'0',
                   'HB_D3D12_REAL':'Z:'+str(engine/'lib/apple_gptk/wine/x86_64-windows/d3d12.dll').replace('/','\\'),
                   'WINEDLLPATH':':'.join(str(engine/name) for name in ['lib/apple_gptk/wine/x86_64-windows','lib/apple_gptk/wine','lib/wine/x86_64-windows','lib/wine']),
                   'WINEDLLOVERRIDES':env['WINEDLLOVERRIDES']+';d3d12=n,b;nvapi64=n,b'}
        run('nvapi-provider-accepted',[wine,build/'probes/nvapi-provider.exe',build/'payload/d3d12.dll','nvapi64.dll','accepted'],nvapi_env)
        run('nvapi-provider-foreign',[wine,build/'probes/nvapi-provider.exe',build/'payload/d3d12.dll',build/'probes/foreign/nvapi64.dll','rejected'],nvapi_env)
        swap=root/'replaced-provider';swap.mkdir();shutil.copyfile(build/'probes/foreign/nvapi64.dll',swap/'nvapi64.dll')
        run('nvapi-provider-replaced-file',[wine,build/'probes/nvapi-provider.exe',build/'payload/d3d12.dll',swap/'nvapi64.dll','rejected',provider],nvapi_env)
        heap_log=root/'heap-metadata.log';heap_log.touch()
        run('heap-import-native',[wine,build/'probes/heap-import.exe','--native',build/'payload/d3d12.dll'],
            {**nvapi_env,'D3DM_MTL4':'1','MACXUS_FH5_HEAP_TRACE':'1','MACXUS_PROCESS_OBSERVER_LOG':'Z:'+str(heap_log).replace('/','\\')})
        # The unmodified vendor loader correctly refuses native injection. This
        # control accepts failure semantics only; enabled PE/native calibration
        # is separately tested through the prepared game wrapper.
        run('clock-missing-bridge',[wine,build/'probes/clock-calibration.exe','--missing-bridge'],{'WINEDLLPATH':str(build/'payload')+':'+str(engine/'lib/wine'),'WINEDLLOVERRIDES':env['WINEDLLOVERRIDES']+';macxus-clock=b'})
        run('clock-math',[build/'probes/clock-math'])
        run('clock-native',[build/'probes/clock-native'])
        for name in ['metal4-counter-probe','metal4-state-probe','metal4-order-probe','metal4-lifetime-probe']:
            # State/order probes exercise the injected bridge, not raw Metal.
            # Counter/lifetime controls deliberately run without injection.
            injected = {'DYLD_INSERT_LIBRARIES':str(build/'payload/macxus-metal4-timestamps.dylib'),
                        'MACXUS_GPU_QUERY_COOKIE':secrets.token_hex(8),
                        'MACXUS_GPU_BRIDGE_LOG':str(root/(name+'-bridge.jsonl')),
                        'D3DM_MTL4':'1'} if name in ['metal4-state-probe','metal4-order-probe'] else None
            run(name,[build/'probes'/name],injected)
    finally:
        subprocess.run([engine/'bin/wineserver','-k'],env=env,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (root/'results.json').write_text(json.dumps({'gameLaunched':False,'accountUsed':False,'results':results},indent=2)+'\n')
if __name__=='__main__':main()
