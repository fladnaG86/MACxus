import importlib.util, pathlib, shutil, subprocess, tempfile, unittest

spec=importlib.util.spec_from_file_location('clock_reconstruction',pathlib.Path(__file__).with_name('build.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class Reconstruction(unittest.TestCase):
    def test_current_integrated_source_reconstructs_and_reaches_compilation(self):
        with tempfile.TemporaryDirectory(prefix='clock reconstruction ') as folder:
            root=pathlib.Path(folder)
            def execute(args,**kw):subprocess.run(list(map(str,args)),check=True,capture_output=True,**kw)
            source=runner.reconstruct_source(root/'source',execute)
            bridge=(source/'metal4/metal4-query-bridge.m').read_text()
            self.assertEqual(bridge.count('int32_t macxus_metal4_calibrate_v1('),1)
            self.assertEqual((source/'shim/gpu_clock_reporting.h').read_text().count('HRESULT result = mx_get_calibration('),1)
            for name in ['clock-pe.c','clock-unix.c','clock-abi.h','clock-native.h','clock-math.h']:
                self.assertEqual((source/'clock'/name).read_bytes(),(runner.REPO/'assets/fh5-preview/source/clock'/name).read_bytes())
            cc=shutil.which('clang') or shutil.which('cc')
            if not cc:self.skipTest('A C compiler is required to exercise reconstructed inputs')
            execute([cc,'-O2','-Wall','-Wextra','-Werror',source/'clock/math-probe.c','-o',root/'probe'])
            result=subprocess.run([root/'probe'],check=True,capture_output=True,text=True)
            self.assertIn('CLOCK_MATH checks=300003',result.stdout)

if __name__=='__main__':unittest.main()
