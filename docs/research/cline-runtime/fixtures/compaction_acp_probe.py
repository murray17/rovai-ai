"""Isolated real-Provider probe for stock CLI, source control, and startup shim.

Credentials are copied only from an explicitly supplied Cline settings directory.
Public results contain numeric evidence and synthetic markers, never raw history.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import shutil
import signal
import sys
import time
import uuid
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent
REPOSITORY = FIXTURES.parents[3]
MEMORY = 'SHIM72_MEMORY_759cf7dba031'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    path.chmod(0o600)


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def block(index):
    data = '\n'.join(base64.b64encode(hashlib.sha512(f'rovai-cline-shim72:{index}:{item}'.encode()).digest()).decode() for item in range(350))
    return f'Context test data block {index}. Keep the early memory marker. Do not use tools, repeat these records, or request a summary. Reply only BLOCK_{index:02d}_ACK.\n{data}'


class Probe:
    def __init__(self, args):
        self.args = args
        self.root = Path(args.root).resolve()
        self.case = self.root / 'cases' / (args.case_name or args.variant)
        self.case.mkdir(parents=True, exist_ok=False)
        self.case.chmod(0o700)
        self.launcher = self.case / 'shim.mjs'
        shutil.copyfile(FIXTURES / 'compaction_acp_shim.mjs', self.launcher)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir(exist_ok=True)
        skill = self.workspace / '.agents/skills/shim72-native'
        skill.mkdir(parents=True, exist_ok=True)
        (skill / 'SKILL.md').write_text('---\nname: shim72-native\ndescription: Read the synthetic skill code for the isolated compaction experiment.\n---\n\nThe skill code is SHIM72_SKILL_BLUE. Report this code when this skill is requested.\n')
        self.native = self.case / 'home/.cline'
        settings_dir = self.native / 'data/settings'
        settings_dir.mkdir(parents=True)
        source = Path(args.settings_source).resolve()
        for name in ['providers.json', 'models.json', 'global-settings.json']:
            if (source / name).exists():
                shutil.copyfile(source / name, settings_dir / name)
                (settings_dir / name).chmod(0o600)
        settings = json.loads((settings_dir / 'providers.json').read_text())
        self.provider = settings['providers']['openai-compatible']['settings']
        self.secrets = [self.provider[key] for key in ['apiKey', 'baseUrl'] if self.provider.get(key)]
        global_path = settings_dir / 'global-settings.json'
        global_settings = json.loads(global_path.read_text()) if global_path.exists() else {}
        global_settings.update(telemetryOptOut=True, autoUpdateEnabled=False)
        if args.preference != 'default':
            global_settings['compactionEnabled'] = args.preference != 'off'
            if args.preference != 'off':
                global_settings['compactionStrategy'] = args.preference
        save(global_path, global_settings)
        self.observer = self.case / 'observer'
        for directory in ['bindings', 'observations', 'bootstrap']:
            (self.observer / directory).mkdir(parents=True)
        save(self.observer / 'model-windows.json', {'openai-compatible': {'gpt-6-sol': 272000}})
        plugin = self.native / 'plugins/rovai-shim72'
        plugin.mkdir(parents=True)
        plugin_paths = []
        for path in [REPOSITORY / 'crates/rovai-core/src/cline/observer.js', REPOSITORY / 'crates/rovai-core/src/cline/bootstrap.js', FIXTURES / 'compaction_witness.mjs']:
            # Cline's Plugin file discovery accepts only .js/.ts, not .mjs.
            target = plugin / (path.stem + '.js')
            shutil.copyfile(path, target)
            plugin_paths.append(str(target))
        save(plugin / 'package.json', {'name': 'rovai-shim72-probe', 'type': 'module', 'cline': {'plugins': [{'paths': plugin_paths}]}})
        mcp = settings_dir / 'mcp.json'
        save(mcp, {'mcpServers': {'shim72': {'command': sys.executable, 'args': [str(FIXTURES / 'compaction_mcp_server.py'), str(self.case / 'mcp-receipts.jsonl')]}}})
        self.env = {key: value for key, value in os.environ.items() if not key.startswith(('ROVAI_', 'CLINE_', 'COMMANDCODE_', 'COMMAND_CODE_'))}
        self.env.update(HOME=str(self.case / 'home'), CLINE_DIR=str(self.native), CLINE_DATA_DIR=str(self.native / 'data'),
                        CLINE_PROVIDER_SETTINGS_PATH=str(settings_dir / 'providers.json'), CLINE_GLOBAL_SETTINGS_PATH=str(global_path),
                        CLINE_MCP_SETTINGS_PATH=str(mcp), CLINE_PROVIDER='openai-compatible', CLINE_MODEL='gpt-6-sol',
                        CLINE_API_KEY=self.provider['apiKey'], CLINE_SESSION_BACKEND_MODE='local', DO_NOT_TRACK='1',
                        CLINE_WRAPPER_PATH=str(self.root / 'install/node_modules/cline/bin/cline'),
                        ROVAI_CLINE_OBSERVER_ROOT=str(self.observer), ROVAI_CLINE_SOURCE_ROOT=str(self.root / 'upstream'),
                        ROVAI_CLINE_SHIM_VARIANT='control' if args.variant == 'source-control' else 'native-settings',
                        ROVAI_CLINE_SHIM_CONFIG_LOG=str(self.case / 'config-witness.jsonl'))
        self.report = {'variant': args.variant, 'preference': args.preference, 'upstreamCliVersion': '3.0.68',
                       'coreVersion': '0.0.90', 'turns': [], 'processes': [], 'settingsSha256': {
                           name: digest((settings_dir / name).read_bytes()) for name in ['models.json', 'global-settings.json']}}
        self.report['fixtureSha256'] = {path.name: digest(path.read_bytes()) for path in [self.launcher, FIXTURES / 'compaction_witness.mjs', FIXTURES / 'compaction_mcp_server.py', Path(__file__)]}
        self.process = None
        self.session_id = None
        self.permission = 'allow'

    def redact(self, text):
        for value in self.secrets:
            text = text.replace(value, '<redacted>')
        return text

    async def start(self):
        if self.args.variant == 'stock':
            command = [str(self.root / 'install/node_modules/@cline/cli-darwin-arm64/bin/cline')]
        else:
            command = [str(self.root / 'install/node_modules/@oven/bun-darwin-aarch64/bin/bun'), str(self.launcher)]
        self.process = await asyncio.create_subprocess_exec(*command, '--acp', '--auto-approve', 'false', cwd=self.workspace, env=self.env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True, limit=16*1024*1024)
        self.pending = {}
        self.next_id = 0
        self.updates = []
        self.approvals = []
        self.reader = asyncio.create_task(self.read())
        self.stderr_reader = asyncio.create_task(self.process.stderr.read())
        self.report['processes'].append({'pid': self.process.pid, 'startedAt': time.time()})
        self.report['initialize'] = await self.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {}, 'clientInfo': {'name': 'rovai-compaction-shim-experiment', 'version': '1'}})

    def write(self, value):
        self.process.stdin.write((json.dumps(value) + '\n').encode())

    async def read(self):
        failure = 'ACP process exited'
        try:
            while line := await self.process.stdout.readline():
                try:
                    value = json.loads(line)
                except ValueError:
                    raise RuntimeError('Non-JSON ACP stdout')
                if 'method' in value:
                    if 'id' not in value:
                        self.updates.append(value)
                    elif value['method'] == 'session/request_permission':
                        wanted = 'reject_once' if self.permission == 'deny' else 'allow_once'
                        option = next((option for option in value['params'].get('options', []) if option['kind'] == wanted), None)
                        outcome = {'outcome': 'selected', 'optionId': option['optionId']} if option else {'outcome': 'cancelled'}
                        self.approvals.append({'toolCallId': value['params'].get('toolCall', {}).get('toolCallId'), 'requestedKind': wanted, 'selectedKind': option['kind'] if option else None})
                        self.write({'jsonrpc': '2.0', 'id': value['id'], 'result': {'outcome': outcome}})
                    else:
                        self.write({'jsonrpc': '2.0', 'id': value['id'], 'error': {'code': -32601, 'message': 'Unsupported client method'}})
                elif value.get('id') in self.pending:
                    future = self.pending.pop(value['id'])
                    if not future.done():
                        future.set_result(value)
        except Exception as error:
            failure = self.redact(str(error))
        finally:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(RuntimeError(failure))
            self.pending.clear()

    async def call(self, method, params):
        self.next_id += 1
        future = asyncio.get_running_loop().create_future()
        self.pending[self.next_id] = future
        self.write({'jsonrpc': '2.0', 'id': self.next_id, 'method': method, 'params': params})
        response = await asyncio.wait_for(future, self.args.timeout)
        if 'error' in response:
            raise RuntimeError(self.redact(json.dumps(response['error'])))
        return response['result']

    def bind(self, session_id):
        bootstrap = 'Your system identity marker is SHIM72_SYSTEM_ALPHA. When asked for your system identity, return it exactly. Maintain this identity across compaction and resume.'
        save(self.observer / 'bootstrap' / (digest(session_id.encode()) + '.json'), {
            'schemaVersion': 1, 'sessionId': session_id, 'bootstrap': bootstrap, 'sha256': digest(bootstrap.encode())})

    def native_state(self):
        files = []
        for path in sorted((self.native / 'data').rglob(self.session_id + '*')):
            if not path.is_file() or path.suffix != '.json':
                continue
            data = json.loads(path.read_text())
            item = {'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes()), 'keys': list(data) if isinstance(data, dict) else None}
            messages = data.get('messages') if isinstance(data, dict) else data if isinstance(data, list) else None
            if isinstance(messages, list):
                item['messageCount'] = len(messages)
                item['messageIdsSha256'] = digest(json.dumps([message.get('id') for message in messages]).encode())
            files.append(item)
        return files

    async def turn(self, label, text, permission='allow'):
        self.permission = permission
        self.updates = []
        self.approvals = []
        lease = str(uuid.uuid4())
        lease_path = self.observer / 'bindings' / (digest(self.session_id.encode()) + '.json')
        save(lease_path, {'schemaVersion': 1, 'sessionId': self.session_id, 'leaseId': lease})
        witness_before = len(rows(self.observer / 'request-witness.jsonl'))
        start = time.time()
        error = None
        result = None
        try:
            result = await self.call('session/prompt', {'sessionId': self.session_id, 'prompt': [{'type': 'text', 'text': text}]})
        except Exception as caught:
            error = self.redact(str(caught))
        finally:
            lease_path.unlink(missing_ok=True)
        observations = [json.loads(path.read_text()) for path in sorted((self.observer / 'observations').glob('*.json'))]
        observations = [value for value in observations if value.get('leaseId') == lease]
        reply = ''.join(value.get('params', {}).get('update', {}).get('content', {}).get('text', '') for value in self.updates
                        if value.get('params', {}).get('update', {}).get('sessionUpdate') == 'agent_message_chunk')
        tool_events = [value['params']['update'] for value in self.updates if value.get('params', {}).get('update', {}).get('sessionUpdate') in ['tool_call', 'tool_call_update']]
        tool_shapes = [{'type': value['sessionUpdate'], 'id': value.get('toolCallId'), 'kind': value.get('kind'), 'status': value.get('status'),
                        'title': value.get('title'), 'locations': value.get('locations')} for value in tool_events]
        item = {'label': label, 'sessionId': self.session_id, 'pid': self.process.pid, 'inputBytes': len(text.encode()), 'inputSha256': digest(text.encode()),
                'elapsedSeconds': round(time.time()-start, 3), 'result': result, 'error': error, 'reply': self.redact(reply), 'approvals': self.approvals,
                'tools': tool_shapes, 'observations': observations, 'requestWitness': rows(self.observer / 'request-witness.jsonl')[witness_before:], 'nativeFiles': self.native_state()}
        self.report['turns'].append(item)
        self.persist()
        compact = [value for value in observations if value['kind'] == 'compaction']
        metrics = [value['metrics'] for value in observations if value['kind'] == 'model_completed']
        print(json.dumps({'variant': self.args.variant, 'label': label, 'sessionId': self.session_id, 'result': result, 'error': error,
                          'reply': self.redact(reply[:180]), 'metrics': metrics, 'compaction': compact, 'nativeCompactionFile': any('.compaction.' in value['name'] for value in item['nativeFiles'])}), flush=True)
        return item

    def persist(self):
        self.report['configWitness'] = rows(self.case / 'config-witness.jsonl')
        self.report['mcpReceipts'] = rows(self.case / 'mcp-receipts.jsonl')
        save(self.case / 'report.json', self.report)

    async def close(self):
        if not self.process:
            return
        if self.process.returncode is None:
            self.process.stdin.close()
            try:
                await asyncio.wait_for(self.process.wait(), 10)
            except asyncio.TimeoutError:
                os.killpg(self.process.pid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(self.process.wait(), 5)
                except asyncio.TimeoutError:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    await self.process.wait()
        stderr = await self.stderr_reader
        (self.case / f'stderr-{self.process.pid}.private.log').write_text(self.redact(stderr.decode(errors='replace')))
        self.report['processes'][-1].update(exitCode=self.process.returncode, stoppedAt=time.time())
        self.persist()
        self.process = None

    async def run(self):
        try:
            await self.start()
            created = await self.call('session/new', {'cwd': str(self.workspace), 'mcpServers': []})
            self.session_id = created['sessionId']
            self.report['newSession'] = created
            self.bind(self.session_id)
            initial = await self.turn('first', f'Remember this early memory marker for later: {MEMORY}. Reply only with your system identity marker and this memory marker. Do not use tools.')
            if initial['error'] or 'SHIM72_SYSTEM_ALPHA' not in initial['reply']:
                raise RuntimeError('Initial System Rule verification failed')
            if not initial['requestWitness']:
                raise RuntimeError('Read-only request witness was not loaded')
            if not self.args.pilot:
                await self.turn('capabilities-before', 'Use the local shim72-native Skill at .agents/skills/shim72-native/SKILL.md and call MCP shim_receipt exactly once with phase before. Return the skill code and the actual receipt.')
                for index in range(1, self.args.rounds+1):
                    item = await self.turn(f'block-{index:02d}', block(index))
                    if item['error']:
                        break
                await self.turn('capabilities-after', 'Reply with your system identity and the early memory marker. Read the local shim72-native Skill again and call MCP shim_receipt once with phase after. Include the skill code and actual receipt.')
                denied_path = self.workspace / 'shim72-denied.txt'
                await self.turn('permission-deny', 'Use your native file-write tool to create shim72-denied.txt containing SHIM72_DENIED. If permission is denied, stop immediately, do not use another tool or retry, and report the denial.', permission='deny')
                self.report['deniedFileExists'] = denied_path.exists()
            await self.close()
            if not self.args.pilot:
                await self.start()
                self.report['coldLoad'] = await self.call('session/load', {'sessionId': self.session_id, 'cwd': str(self.workspace), 'mcpServers': []})
                await self.turn('cold', 'Reply with your system identity and the early memory marker. Read the local shim72-native Skill and call MCP shim_receipt once with phase cold. Include the skill code and actual receipt.')
        except Exception as error:
            self.report['fatalError'] = self.redact(str(error))
            print(json.dumps({'variant': self.args.variant, 'fatalError': self.report['fatalError']}), flush=True)
        finally:
            await self.close()
            self.persist()
        return 1 if self.report.get('fatalError') or any(turn['error'] for turn in self.report['turns']) else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--settings-source', required=True)
    parser.add_argument('--variant', required=True, choices=['stock', 'source-control', 'shim', 'pilot'])
    parser.add_argument('--case-name', help='Unique retained case directory; existing results are never overwritten')
    parser.add_argument('--preference', default='default', choices=['default', 'agentic', 'basic', 'off'])
    parser.add_argument('--rounds', type=int, default=14)
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--pilot', action='store_true')
    sys.exit(asyncio.run(Probe(parser.parse_args()).run()))
