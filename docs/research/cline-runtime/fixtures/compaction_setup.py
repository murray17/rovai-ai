"""Prepare pinned, unmodified upstream artifacts; does not make model requests.

macOS arm64 only, matching the qualification in the adjacent research report.
Run with --root pointing to a new absolute directory. Requires npm and Python 3.
"""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

COMMIT = '241c1884a7461ef35f6c384a027a38e8d03b3b33'
ARCHIVE_SHA256 = '679dfc4085e0085061ba0ca4aa83716f0b6d29146856c3cb519672f3f248c256'
FIXTURES = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    assert platform.system() == 'Darwin' and platform.machine() == 'arm64', 'Only the qualified macOS arm64 setup is provided'
    assert args.root.is_absolute(), 'Use an explicit absolute directory'
    args.root.mkdir(mode=0o700, exist_ok=False)
    root = args.root.resolve()
    archive = root / 'cline-upstream.tar.gz'
    urllib.request.urlretrieve(f'https://codeload.github.com/cline/cline/tar.gz/{COMMIT}', archive)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == ARCHIVE_SHA256, 'Upstream archive digest changed'
    extracted = 0
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            relative = Path(*Path(member.name).parts[1:])
            if not member.isfile() or relative.parts[:2] != ('apps', 'cli'):
                continue
            assert '..' not in relative.parts
            destination = root / 'upstream' / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(package.extractfile(member).read())
            extracted += 1
    install = root / 'install'
    install.mkdir()
    # Bootstrap the pinned Bun executable without lifecycle scripts. The next
    # step uses the retained lock, not the current registry's latest versions.
    subprocess.run(['npm', 'install', '--prefix', str(install), '--ignore-scripts', '--no-audit', '--no-fund', 'bun@1.4.2'], check=True)
    for name in ['package.json', 'bun.lock']:
        shutil.copyfile(FIXTURES / 'compaction-dependencies' / name, install / name)
    bun = install / 'node_modules/@oven/bun-darwin-aarch64/bin/bun'
    subprocess.run([str(bun), 'install', '--frozen-lockfile', '--ignore-scripts'], cwd=install, check=True)
    (root / 'node_modules').symlink_to(install / 'node_modules', target_is_directory=True)
    print(json.dumps({'root': str(root), 'commit': COMMIT, 'archiveSha256': ARCHIVE_SHA256, 'unmodifiedCliFiles': extracted}))


if __name__ == '__main__':
    main()
