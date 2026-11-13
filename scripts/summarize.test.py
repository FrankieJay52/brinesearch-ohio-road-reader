"""Network-free checks against genuine retained November 13 official responses."""
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import unittest

os.environ.setdefault('ODOT_CAPTURE_CHANNEL', 'Network-free retained-capture parser tests')
ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('summarize', ROOT / 'scripts/summarize.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
FIXTURE = ROOT / 'scripts/fixtures/2026-11-13-official-capture'
SOURCES = {row['county']: row for row in json.loads((ROOT / 'county-sources.json').read_text())['counties']}


class CompleteBodyTest(unittest.TestCase):
    def read(self, county, capture=FIXTURE):
        return reader.read_county(str(capture), SOURCES[county], {'dir': '/nonexistent-prior-capture', 'times': {}})

    def test_hamilton_decorative_rules_do_not_create_missing_text(self):
        row = self.read('Hamilton')
        self.assertEqual(row['outcome'], 'complete', row['reasons'])
        self.assertTrue(row['pageData']['bodyHashMatched'])
        self.assertEqual(row['pageData']['plainBodyBlocksNotShown'], [])
        self.assertEqual(row['pageData']['browserBlocksNotInPlainBody'], [])
        self.assertEqual(row['plainGet']['requestedAt'], '2026-11-13T22:58:05.245Z')

    def test_jefferson_official_rendering_omission_is_still_failed(self):
        row = self.read('Jefferson')
        self.assertEqual(row['outcome'], 'failed')
        self.assertFalse(row['pageData']['bodyHashMatched'])
        self.assertIn('rendered browser body does not match complete CMS body', row['reasons'])
        self.assertTrue(any('4th Street on-ramp closure near Toronto' in text
                            for text in row['pageData']['plainBodyBlocksNotShown']))

    def test_missing_section_cannot_be_a_complete_zero_notice_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            capture = pathlib.Path(temporary)
            shutil.copytree(FIXTURE, capture, dirs_exist_ok=True)
            file = capture / 'records/hamilton.json'
            record = json.loads(file.read_text())
            record['browser']['blocks'] = []
            file.write_text(json.dumps(record))
            row = self.read('Hamilton', capture)
            self.assertEqual(row['outcome'], 'failed')
            self.assertIn('no county section on the page', row['reasons'])
            self.assertFalse(row['pageData']['bodyHashMatched'])

    def test_retained_text_tampering_cannot_keep_complete_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            capture = pathlib.Path(temporary)
            shutil.copytree(FIXTURE, capture, dirs_exist_ok=True)
            file = capture / 'visible-text/hamilton.txt'
            file.write_text(file.read_text() + '\nChanged saved file')
            row = self.read('Hamilton', capture)
            self.assertEqual(row['outcome'], 'failed')
            self.assertIn('retained browser text hash mismatch', row['reasons'])


if __name__ == '__main__':
    unittest.main()
