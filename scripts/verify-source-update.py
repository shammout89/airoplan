"""Validate source archives and rehearse an overlay without using any production data.

Usage: python3 scripts/verify-source-update.py FULL_ZIP UPDATE_ZIP NEW_DIRECTORY
       NODE_MODULES_DIR BASELINE_ZIP...
The directory must be new/empty. Its extracted trees are retained for build tests.
"""
import hashlib
import json
import re
import stat
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath


def sha(data):
    return hashlib.sha256(data).hexdigest()


def archive(filename, prefix=""):
    with zipfile.ZipFile(filename) as source:
        assert source.testzip() is None, "CRC failure"
        names = set()
        result = {}
        for item in source.infolist():
            name = item.filename
            assert name not in names, "Duplicate archive path"
            names.add(name)
            assert not name.startswith("/") and "\\" not in name and "\0" not in name
            assert ":" not in name and ".." not in PurePosixPath(name).parts
            assert not stat.S_ISLNK(item.external_attr >> 16), "Archive symlink"
            if name.endswith("/"):
                continue
            assert not prefix or name.startswith(prefix)
            result[name[len(prefix):]] = source.read(item)
        return result, source.comment.decode("ascii", errors="replace").strip()


def protected(name):
    return name in {"compose.yaml", "Start-AeroPlan-Restored.ps1", "backup-policy.json", "full-backup-policy.json"} or bool(
        re.match(r"compose\.(production|backup|services|full-restore)\.yaml$", name)
        or re.match(r"(data|secrets|node_modules|\.sites-runtime|qa-data)/", name)
        or re.match(r"\.env($|\.)", name) and name != ".env.example"
    )


def extract(entries, directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, data in entries.items():
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def fingerprint(directory, modules):
    (directory / "node_modules").symlink_to(modules, target_is_directory=True)
    command = "import {sourceFingerprint} from './selfhost/build-fingerprint.mjs';console.log(JSON.stringify(await sourceFingerprint()))"
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", command], cwd=directory, text=True))


def main():
    full_name, patch_name, directory, modules, *base_names = sys.argv[1:]
    root = Path(directory).resolve()
    assert not root.exists() or not any(root.iterdir()), "Use a new, empty rehearsal directory"
    assert base_names, "Explicit baseline archives are required"
    modules = Path(modules).resolve()
    assert modules.is_dir()
    full, commit = archive(full_name, "AeroPlan-Docker/")
    patch, _ = archive(patch_name)
    manifest = json.loads(patch.pop("UPDATE_MANIFEST.json"))
    assert manifest["sourceCommit"] == commit
    version = json.loads(full["release.json"])["version"]
    assert version == manifest["release"]
    assert len(patch) == len(manifest["files"])
    assert set(patch) == {entry["path"] for entry in manifest["files"]}
    assert not any(protected(name) for name in patch), "Runtime files in update"
    assert not any(re.match(r"(node_modules|data|secrets|\.sites-runtime)/", name) for name in full)
    for item in manifest["files"]:
        name = item["path"]
        assert item["bytes"] == len(patch[name]) and item["sha256"] == sha(patch[name])
        assert full[name] == patch[name], "Patch differs from full committed source"
    full_directory = root / "full" / "AeroPlan-Docker"
    extract(full, full_directory)
    expected = fingerprint(full_directory, modules)
    sentinels = [".env", "compose.yaml", "compose.production.yaml", "compose.services.yaml", "compose.backup.yaml", "compose.full-restore.yaml", "Start-AeroPlan-Restored.ps1", "data/aeroplan.sqlite", "data/authentication.key", "data/objects/synthetic-object", "secrets/synthetic-backup.key", "data/full-backup-policy.json"]
    results = []
    for base_name in base_names:
        old, _ = archive(base_name, "AeroPlan-Docker/")
        old_version = json.loads(old["release.json"])["version"]
        baseline = next(b for b in manifest["baseArchives"] if b["release"] == old_version)
        assert baseline["sha256"] == sha(Path(base_name).read_bytes()), "Unexpected baseline bytes"
        target = root / ("patched-" + old_version) / "AeroPlan-Docker"
        extract(old, target)
        preserved = {}
        for index, name in enumerate(sentinels):
            data = ("SYNTHETIC PROTECTED " + old_version + " " + str(index)).encode()
            file = target / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            preserved[name] = data
        extract(patch, target)
        assert all((target / name).read_bytes() == data for name, data in preserved.items())
        assert all(protected(name) or (target / name).read_bytes() == data for name, data in full.items())
        actual = fingerprint(target, modules)
        assert actual == expected, "Patched source fingerprint differs"
        assert json.loads((target / "release.json").read_text())["version"] == version
        results.append({"sourceRelease":old_version, "baselineSha256":baseline["sha256"], "protectedSentinels":len(preserved), "allUnprotectedFilesMatchFullSource":True, "fingerprint":actual, "directory":str(target)})
    assert set(manifest["compatibleSourceVersions"]) == {r["sourceRelease"] for r in results}
    report = {"release":version, "sourceCommit":commit, "archiveChecks":"safe paths, no symlinks/duplicates, CRC, per-file hash/size, full/patch byte equality", "fullSha256":sha(Path(full_name).read_bytes()), "patchSha256":sha(Path(patch_name).read_bytes()), "patchFiles":len(patch), "fullFingerprint":expected, "baselines":results, "dockerExecuted":False, "targetWindowsBrowserExecuted":False}
    (root / "rehearsal.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
