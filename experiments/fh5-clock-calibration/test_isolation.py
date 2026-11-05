import importlib.util, pathlib, shutil, tempfile, unittest

spec=importlib.util.spec_from_file_location('clock_build',pathlib.Path(__file__).with_name('build.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class PrefixIsolation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
        self.template=self.root/'template';self.prefix=self.root/'copy'
        (self.template/'drive_c/windows/system32').mkdir(parents=True)
        (self.template/'dosdevices').mkdir()
        (self.template/'dosdevices/c:').symlink_to('../drive_c')
        (self.template/'dosdevices/z:').symlink_to('/')
        self.sentinel=self.template/'sentinel.dll';self.sentinel.write_bytes(b'original-template')
        self.source=self.root/'new.dll';self.source.write_bytes(b'new-owned-module')
    def copy(self):shutil.copytree(self.template,self.prefix,symlinks=True)
    def test_destination_symlink_does_not_write_template(self):
        (self.template/'drive_c/windows/system32/macxus-clock.dll').symlink_to(self.sentinel)
        self.copy();runner.install_clock(self.prefix,self.source)
        self.assertEqual(self.sentinel.read_bytes(),b'original-template')
        target=self.prefix/'drive_c/windows/system32/macxus-clock.dll'
        self.assertFalse(target.is_symlink());self.assertEqual(target.read_bytes(),b'new-owned-module')
    def test_broken_destination_link_detached(self):
        (self.template/'drive_c/windows/system32/macxus-clock.dll').symlink_to(self.root/'absent')
        self.copy();runner.install_clock(self.prefix,self.source)
        self.assertFalse((self.root/'absent').exists())
    def test_external_parent_links_rejected(self):
        for relative in ['drive_c','drive_c/windows','drive_c/windows/system32','dosdevices']:
            with self.subTest(relative=relative):
                self.copy();target=self.prefix/relative
                saved=self.root/'moved';target.rename(saved);target.symlink_to(saved,target_is_directory=True)
                with self.assertRaises(ValueError):runner.install_clock(self.prefix,self.source)
                self.assertEqual(self.sentinel.read_bytes(),b'original-template')
                shutil.rmtree(self.prefix);shutil.rmtree(saved)
    def test_external_c_mapping_rejected(self):
        self.copy();mapping=self.prefix/'dosdevices/c:';mapping.unlink();mapping.symlink_to(self.template/'drive_c')
        with self.assertRaises(ValueError):runner.validate_prefix(self.prefix)
        self.assertFalse((self.template/'drive_c/windows/system32/macxus-clock.dll').exists())
    def test_registry_links_rejected(self):
        for name in ['system.reg','user.reg','userdef.reg']:
            with self.subTest(name=name):
                self.copy();(self.prefix/name).symlink_to(self.sentinel)
                with self.assertRaises(ValueError):runner.validate_prefix(self.prefix)
                shutil.rmtree(self.prefix)
        self.assertEqual(self.sentinel.read_bytes(),b'original-template')
    def test_ordinary_prefix_and_z_mapping_retained(self):
        self.copy();runner.install_clock(self.prefix,self.source)
        self.assertEqual((self.prefix/'dosdevices/z:').readlink(),pathlib.Path('/'))
        self.assertFalse(list((self.prefix/'drive_c/windows/system32').glob('.macxus-clock-*')))

if __name__=='__main__':unittest.main()
