"""Source-release consumer regression: no manifest, engine, Wine or account."""
import hashlib, importlib.util, json, shutil, subprocess, sys, tarfile, tempfile, unittest
from unittest.mock import patch
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('release_build',HERE/'build.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
sha=lambda data:hashlib.sha256(data).hexdigest()

class Consumer(unittest.TestCase):
    def test_archived_full_builder_writes_receipt_and_archive_without_application_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();recipe=root/'recipe';scripts=recipe/'scripts/fh5-pack';assets=recipe/'assets/fh5-preview'
            scripts.mkdir(parents=True);shutil.copyfile(HERE/'build.py',scripts/'build.py')
            for name in ['scripts/runtime-tests','scripts/runtime-compat','assets/fh5-preview/source/shim','assets/fh5-preview/source/metal4']:(recipe/name).mkdir(parents=True)
            (recipe/'scripts/fh5-pack.mjs').write_text('// fixture')
            (scripts/'runtime-patches.lock.json').write_text('{"patches":[]}')
            (recipe/'scripts/runtime-patches.lock.json').write_text('unrelated shared lock')
            for name in ['COPYING.GPL-3.0','COPYING.LGPL-2.1']:(assets/name).write_text('fixture license')
            versions={'mingwGCC':'16.2.0','appleClang':'fixture clang','macOSSDK':'27.0'}
            lock={'sources':{},'sourceDateEpoch':0,'toolchain':versions,'runtimeSourceLockSHA256':sha((scripts/'runtime-patches.lock.json').read_bytes()),'wineCommit':'f'*40}
            (assets/'source.lock.json').write_text(json.dumps(lock))
            descriptor={'schema':1,'id':'fh5-preview-v1','storeId':'9NNX1VVR3KNQ','version':'20261015','buildTag':'fixture','engineFiles':{},'sourceReleaseDescriptor':1}
            (assets/'verification.json').write_text(json.dumps(descriptor))
            spec=importlib.util.spec_from_file_location('archived_builder_fixture',scripts/'build.py')
            archived=importlib.util.module_from_spec(spec);spec.loader.exec_module(archived)
            def execute(args,cwd,capture=False,env=None):
                args=list(map(str,args))
                if '-dumpfullversion' in args:return b'16.2.0\n'
                if '--version' in args:return b'fixture clang\n'
                if '--show-sdk-version' in args:return b'27.0\n'
                if args[0].endswith('objdump'):return b'DLL Name: ucrtbase.dll\n'
                if '--format=tar.gz' in args:
                    target=next(x.removeprefix('--output=') for x in args if x.startswith('--output='))
                    with tarfile.open(target,'w:gz'):pass
                if '-o' in args:
                    target=Path(args[args.index('-o')+1]);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'fixture output')
                return b''
            def reconstruct(mirror,output,source_lock):output.mkdir()
            def compile_runtime(source,sdk_source,sdk_build,output,source_lock,env):
                for name in ['xgameruntime.dll','windows.web.dll','libxml2.a']:(output/name).write_bytes(b'fixture runtime')
                return ['fixture.c']
            output=root/'build'
            with patch.object(archived,'execute',execute),patch.object(archived,'reconstruct',reconstruct),patch.object(archived,'compile_runtime',compile_runtime),patch.object(sys,'argv',['build.py',str(output),'--runtime-mirror',str(root/'mirror'),'--sdk-source',str(root/'sdk-source'),'--sdk-build',str(root/'sdk-build')]):
                archived.main()
            receipt=json.loads((output/'build.json').read_text());archive=output/receipt['sourceArchive']['name']
            self.assertEqual(sha(archive.read_bytes()),receipt['sourceArchive']['sha256'])
            with tarfile.open(archive) as stream:
                names=stream.getnames();self.assertNotIn('corresponding-source/recipe/assets/fh5-preview/manifest.json',names)
                shipped=json.load(stream.extractfile('corresponding-source/recipe/assets/fh5-preview/verification.json'))
                self.assertEqual(shipped['files'],receipt['files']);self.assertNotIn('sourceArchive',shipped)

    def test_archived_descriptor_verifies_payload_without_recursive_manifest_or_engine(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);recipe=root/'recipe';scripts=recipe/'scripts/fh5-pack';assets=recipe/'assets/fh5-preview';bundle=root/'build';payload=bundle/'payload'
            scripts.mkdir(parents=True);assets.mkdir(parents=True);payload.mkdir(parents=True)
            shutil.copyfile(HERE/'verify.py',scripts/'verify.py')
            source=b'fixture source lock';(assets/'source.lock.json').write_bytes(source)
            files={name:sha(name.encode()) for name in ['d3d12.dll','xgameruntime.dll','windows.web.dll','macxus-metal4-timestamps.dylib','macxus-clock.dll','macxus-clock.so']}
            for name in files:(payload/name).write_text(name)
            receipt={'sourceLockSHA256':sha(source),'files':files,'sourceArchive':{'sha256':'archive hash must stay out'}}
            manifest={'schema':1,'id':'fh5-preview-v1','storeId':'9NNX1VVR3KNQ','version':'20261015','buildTag':'fixture','engineFiles':{'never-accessed':sha(b'engine')}}
            descriptor=build.verification_descriptor(manifest,receipt)
            self.assertNotIn('sourceArchive',descriptor)
            (assets/'verification.json').write_text(json.dumps(descriptor));(bundle/'build.json').write_text(json.dumps(receipt))
            command=[sys.executable,str(scripts/'verify.py'),str(bundle),'--check-inputs-only','--output',str(root/'evidence')]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertFalse((assets/'manifest.json').exists())
            self.assertFalse(json.loads((root/'evidence/inputs.json').read_text())['engineVerified'])
            (payload/'d3d12.dll').write_text('tampered');command[-1]=str(root/'tamper-evidence')
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertTrue((HERE/'SDK.md').is_file());self.assertTrue((HERE/'prepare-sdk.py').is_file())

if __name__=='__main__':unittest.main()
