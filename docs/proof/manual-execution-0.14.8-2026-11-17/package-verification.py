"""Build a committed-source cumulative patch and verify two existing sources.

Usage: python3 THIS_FILE FULL_0148_ZIP BASE_0146_ZIP BASE_0147_ZIP PATCH_ZIP DEST
All writes are to PATCH_ZIP and the disposable extraction directory DEST.
"""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, stat, subprocess, sys

full_path, old6_path, old7_path, patch_path, destination = map(Path, sys.argv[1:])
expected = 'bff7cfc0a19525fd92f9ed9e06cfc6bb75c611ab21b80d4d004a249f0cf18515'
base_specs = [
    ('0.14.6', old6_path, '2bd030180335095956e73eec773041a921a9f824b9c411e38fa8a8ffaf24b07d'),
    ('0.14.7', old7_path, '37f7df4a4138bf652dc48cbd8c4678c186a297f4cd5cb7d93199cc26e3c23842'),
]
def digest(value):
    return hashlib.sha256(value).hexdigest()
def protected(name):
    return (name in {'compose.yaml', '.env', 'backup-policy.json', 'Start-AeroPlan-Restored.ps1'}
            or name.startswith('.env.') and name != '.env.example'
            or name in {'compose.backup.yaml', 'compose.services.yaml', 'compose.production.yaml', 'compose.full-restore.yaml'}
            or name.split('/')[0] in {'data', 'secrets', 'node_modules', '.sites-runtime', 'qa-data'})
def check_zip(z):
    assert z.testzip() is None
    for entry in z.infolist():
        p = PurePosixPath(entry.filename)
        assert not p.is_absolute() and '..' not in p.parts and '\\' not in entry.filename
        assert stat.S_IFMT(entry.external_attr >> 16) != stat.S_IFLNK, 'Unexpected symbolic link in source archive'
def source_files(z):
    return {name.removeprefix('AeroPlan-Docker/'): z.read(name) for name in z.namelist() if not name.endswith('/')}
def fingerprint(root):
    code = "import {sourceFingerprint} from './selfhost/build-fingerprint.mjs'; console.log(JSON.stringify(await sourceFingerprint()));"
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=root, text=True))

destination.mkdir(parents=True, exist_ok=True)
with ZipFile(full_path) as full:
    check_zip(full)
    new = source_files(full)
    assert json.loads(new['release.json'])['version'] == '0.14.8'
    assert not any(name.split('/')[0] in {'data', 'secrets', 'node_modules', '.sites-runtime'} for name in new)
    assert not any(name == '.env' or name.startswith('.env.') and name != '.env.example' for name in new)
    source_commit = full.comment.decode()
    full.extractall(destination / 'full')
full_root = destination / 'full/AeroPlan-Docker'
assert fingerprint(full_root)['fingerprint'] == expected
baselines = []
changed = set()
for version, filename, sha in base_specs:
    assert digest(filename.read_bytes()) == sha
    with ZipFile(filename) as old:
        check_zip(old)
        files = source_files(old)
        assert json.loads(files['release.json'])['version'] == version
        assert not [n for n in files if n not in new and not protected(n)], 'Deletion-aware update required'
        changed.update(n for n, data in new.items() if not protected(n) and files.get(n) != data)
        baselines.append({'release': version, 'sha256': sha, 'sourceCommit': old.comment.decode()})
manifest = {'release': '0.14.8', 'sourceCommit': source_commit,
            'compatibleSourceVersions': [v['release'] for v in baselines], 'baseArchives': baselines,
            'files': [{'path': n, 'bytes': len(new[n]), 'sha256': digest(new[n])} for n in sorted(changed)],
            'protected': ['compose.yaml', '.env* except .env.example', 'data/', 'secrets/', 'generated Compose overlays', 'backup-policy.json', 'Start-AeroPlan-Restored.ps1']}
patch_path.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(patch_path, 'w', compression=ZIP_DEFLATED, compresslevel=6) as patch:
    for name in sorted(changed):
        info = ZipInfo(name)
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = ZIP_DEFLATED
        patch.writestr(info, new[name], compresslevel=6)
    patch.writestr('UPDATE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
with ZipFile(patch_path) as patch:
    check_zip(patch)
    assert set(patch.namelist()) == changed | {'UPDATE_MANIFEST.json'}
    for item in manifest['files']:
        value = patch.read(item['path'])
        assert value == new[item['path']] and len(value) == item['bytes'] and digest(value) == item['sha256']
    assert not any(protected(n) for n in changed)
    results = []
    for version, filename, sha in base_specs:
        folder = destination / ('patched-' + version)
        with ZipFile(filename) as old:
            old.extractall(folder)
        root = folder / 'AeroPlan-Docker'
        names = ['compose.yaml', '.env', '.env.local', 'data/preserve.json', 'data/objects/preserve.txt',
                 'secrets/backup.key', 'compose.services.yaml', 'compose.backup.yaml', 'compose.production.yaml',
                 'compose.full-restore.yaml', 'backup-policy.json', 'Start-AeroPlan-Restored.ps1']
        sentinels = {n: ('SYNTHETIC PRESERVED ' + version + ' ' + n).encode() for n in names}
        for name, value in sentinels.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(value)
        before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
        patch.extractall(root)
        for name, value in sentinels.items():
            assert (root / name).read_bytes() == value
        untouched = [n for n in before if n not in changed]
        for name in untouched:
            assert (root / name).read_bytes() == before[name]
        for name in changed:
            assert (root / name).read_bytes() == new[name]
        fp = fingerprint(root)
        assert fp['fingerprint'] == expected
        results.append({'baseline': version, 'protectedSentinelsPreserved': len(sentinels),
                        'untouchedFilesPreserved': len(untouched), 'updatedFilesExact': len(changed),
                        'sourceFingerprint': fp['fingerprint'], 'sourceFiles': fp['sourceFiles']})
print(json.dumps({'release': '0.14.8', 'sourceCommit': source_commit, 'fullSha256': digest(full_path.read_bytes()),
                  'patchSha256': digest(patch_path.read_bytes()), 'crcSafePathsAndNoSymlinks': 'passed',
                  'manifestHashesSizesAndFullByteMatch': 'passed', 'protectedPathsExcluded': 'passed',
                  'sourceFingerprint': expected, 'baselines': results,
                  'windowsDockerExecuted': False, 'browserPixelsExecuted': False}, ensure_ascii=False))
