#!/usr/bin/env python3
"""Gate A: exercise an unchanged native release on a clean Linux account.

Uses only the Python standard library. Never installs or calls an Agent Runtime.
Pass the directory selected by install-server.sh, and the expected source SHA.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
    assert os.geteuid() != 0, 'Run acceptance as an ordinary user'
    package = args.package.resolve(strict=True)
    manifest = json.loads((package / 'manifest.json').read_text())
    assert manifest['commit'] == args.expected_source and not manifest['dirty']
    assert manifest['target'] == 'linux-x64' and manifest['profile'] == 'release'
    for name, expected in manifest['files'].items():
        path = (package / name).resolve(strict=True)
        assert path.is_relative_to(package)
        with path.open('rb') as source:
            digest = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        assert digest.hexdigest() == expected, f'Package hash mismatch: {name}'
    checks = []
    processes = []
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def http(origin, route, body=None, session=None):
        headers = {'Content-Type': 'application/json', 'Origin': origin}
        if session:
            headers['Authorization'] = 'Bearer ' + session
        request = urllib.request.Request(origin + route, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with opener.open(request, timeout=20) as response:
            return response.status, response.read()

    def call(origin, session, operation, params=None):
        deadline = time.monotonic() + 30
        while True:
            _, raw = http(origin, '/api/v1/request', {'operation': operation, 'params': params or {}}, session)
            response = json.loads(raw)
            error = response.get('error')
            if error and error.get('code') == 'subsystem_unavailable' and time.monotonic() < deadline:
                time.sleep(0.2)
                continue
            assert error is None, f'{operation}: {error and error.get("code")}'
            return response['result']

    with tempfile.TemporaryDirectory(prefix='rovai-linux-os-') as temporary:
        root = Path(temporary).resolve()
        data = root / 'data'
        home = root / 'account'
        home.mkdir(mode=0o700)
        isolated_path = root / 'bin'
        isolated_path.mkdir()
        for tool in ['sh', 'bash', 'git', 'env']:
            source = shutil.which(tool)
            if source:
                (isolated_path / tool).symlink_to(source)
        environment = {'HOME': str(home), 'PATH': str(isolated_path), 'LANG': 'C.UTF-8'}
        binary = str(package / 'rovai-server')
        command = [binary, '--data-dir', str(data), '--listen', '127.0.0.1:0']
        print(json.dumps({'channel': 'automatic_acceptance', 'dataDir': str(data), 'skillLibraryRoot': str(data / 'skills'), 'runtime': False}), flush=True)

        def start():
            process = subprocess.Popen(command, cwd=root, env=environment, umask=0o077, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            processes.append(process)
            lines = queue.Queue()
            def collect():
                for line in process.stdout:
                    lines.put(line)
                lines.put(None)
            threading.Thread(target=collect, daemon=True).start()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                line = lines.get(timeout=max(0.1, deadline - time.monotonic()))
                assert line is not None, 'Server exited before readiness'
                match = re.search(r'Address\s+(http://127\.0\.0\.1:\d+)', line)
                if match:
                    return process, match[1]
            raise TimeoutError('Server readiness timed out')

        def stop(process):
            process.terminate()
            assert process.wait(timeout=30) == 0, 'Server failed durable SIGTERM shutdown'

        try:
            process, origin = start()
            assert http(origin, '/')[0] == 200
            token = subprocess.check_output([binary, '--data-dir', str(data), 'token'], env=environment, text=True).strip()
            _, raw = http(origin, '/api/v1/login', {'protocolVersion': 4, 'administratorToken': token})
            session = json.loads(raw)
            try:
                http(origin, '/api/v1/request', {'operation': 'navigation.snapshot', 'params': {}})
                raise AssertionError('Unauthenticated request accepted')
            except urllib.error.HTTPError as error:
                assert error.code == 401
            call(origin, session['token'], 'navigation.snapshot')
            deadline = time.monotonic() + 30
            required_subsystems = {'skills', 'mcp', 'attachments', 'maintenance', 'builtin-tools'}
            while True:
                states = call(origin, session['token'], 'runtime.subsystems.get')
                selected = [state for state in states if state['id'] in required_subsystems]
                assert len(selected) == len(required_subsystems)
                assert all(state['state'] in ('initializing', 'ready') for state in selected), selected
                if all(state['state'] == 'ready' for state in selected):
                    break
                assert time.monotonic() < deadline, 'Server subsystems did not become ready'
                time.sleep(0.1)
            checks.append('private_service_umask_and_execution_subsystems')
            config = call(origin, session['token'], 'mcp.config.get')
            created = call(origin, session['token'], 'mcp.servers.create', {
                'expectedConfigDigest': config['configDigest'],
                'definitionJson': json.dumps({'mcpServers': {'linux-os-fixture': {'command': 'never-executed-fixture', 'args': []}}})
            })
            assert created['status'] == 'ok'
            checks.extend(['package_hashes', 'web_ui', 'authentication', 'authenticated_read_write', 'no_node_electron_or_rust_on_host_path'])
            duplicate = subprocess.run(command, cwd=root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=30)
            assert duplicate.returncode != 0 and 'owned_by_active_core' in duplicate.stdout
            checks.append('exclusive_data_root')
            stop(process)
            process, origin = start()
            restored = subprocess.check_output([binary, '--data-dir', str(data), 'token'], env=environment, text=True).strip()
            assert token == restored
            config = call(origin, session['token'], 'mcp.config.get')
            assert any(server['name'] == 'linux-os-fixture' for server in config['servers'])
            assert (data / 'rovai.sqlite').is_file() and (data / 'skills').is_dir()
            assert (data / 'logs/server.log').is_file()
            stop(process)
            checks.extend(['durable_sigterm', 'restart', 'persisted_data', 'persisted_session', 'persisted_token'])
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
    report = {'schemaVersion': 1, 'gate': 'server_os', 'runtimeQualification': False,
              'sourceCommit': manifest['commit'], 'packageManifestSha256': hashlib.sha256((package / 'manifest.json').read_bytes()).hexdigest(),
              'platform': platform.platform(), 'libc': platform.libc_ver(),
              'osRelease': Path('/etc/os-release').read_text(), 'checks': checks, 'status': 'passed'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'gate': report['gate'], 'status': report['status'], 'checks': checks}), flush=True)


if __name__ == '__main__':
    main()
