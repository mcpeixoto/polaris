import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import yaml

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('verify-desktop-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleaseValidation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.targets = {
            'latest-mac.yml': ['Polaris-0.8.1-mac-arm64.zip', 'Polaris-0.8.1-mac-x64.zip'],
            'latest.yml': ['Polaris-Setup-0.8.1.exe'],
            'latest-linux.yml': ['Polaris-0.8.1-linux-x86_64.AppImage', 'polaris_0.8.1_amd64.deb'],
        }
        names = [*self.targets, 'Polaris-0.8.1-mac-arm64.dmg', 'Polaris-0.8.1-mac-x64.dmg']
        for manifest, targets in self.targets.items():
            names.extend(targets)
            self.write(manifest, {'version': '0.8.1', 'path': targets[0], 'sha512': 'checksum', 'files': [{'url': name, 'size': 100, 'sha512': 'checksum'} for name in targets]})
        self.release = {'assets': [{'name': name, 'size': 100, 'state': 'uploaded'} for name in names]}

    def write(self, name, data):
        (self.root / name).write_text(yaml.safe_dump(data))

    def test_complete_release(self):
        self.assertIn('verified', module.validate('v0.8.1', self.release, self.root))

    def test_each_required_asset_is_required(self):
        for asset in self.release['assets']:
            with self.subTest(asset=asset['name']):
                release = copy.deepcopy(self.release)
                release['assets'].remove(asset)
                with self.assertRaises(ValueError):
                    module.validate('v0.8.1', release, self.root)

    def test_manifest_version_targets_size_and_checksum(self):
        name = 'latest-mac.yml'
        original = yaml.safe_load((self.root / name).read_text())
        for mutation in ['version', 'missing-arch', 'foreign-target', 'size', 'checksum', 'legacy']:
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(original)
                if mutation == 'version': data['version'] = '0.8.0'
                if mutation == 'missing-arch': data['files'].pop()
                if mutation == 'foreign-target': data['files'][0]['url'] = 'https://example.com/evil.zip'
                if mutation == 'size': data['files'][0]['size'] = 0
                if mutation == 'checksum': data['files'][0].pop('sha512')
                if mutation == 'legacy': data['path'] = 'missing.zip'
                self.write(name, data)
                with self.assertRaises(ValueError):
                    module.validate('v0.8.1', self.release, self.root)


if __name__ == '__main__':
    unittest.main()
