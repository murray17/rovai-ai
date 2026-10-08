#!/usr/bin/env python3
"""Native CLI model-routing control. Synthetic provider, no real credentials or model claims.

Use --runtime command|opencode|pi --program /absolute/path --out /new/absolute/path.
Command accepts its installed cli.mjs entry (invoked with node), or a CLI executable.
Optional --auth-file references an already-authorized native Command Code login.
Only model/path/auth-match metadata is recorded; no wire prompts or credentials.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


class Provider(BaseHTTPRequestHandler):
    records = []

    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'object': 'list', 'data': [
            {'id': model, 'object': 'model'} for model in ['model-a', 'vendor/shared']
        ]}).encode())

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        provider = self.path.split('/')[1]
        self.records.append({'provider': provider, 'path': self.path, 'model': body.get('model'),
            'authMatched': self.headers.get('Authorization') == f'Bearer fixture-{provider}'})
        marker = f'ROUTED_{provider}_{len(self.records)}'
        base = {'id': marker, 'created': 1, 'model': body.get('model')}
        usage = {'prompt_tokens': 30, 'completion_tokens': 5, 'total_tokens': 35}
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if body.get('stream') else 'application/json')
        self.end_headers()
        if body.get('stream'):
            for choices in [[{'index': 0, 'delta': {'role': 'assistant', 'content': marker}, 'finish_reason': None}],
                            [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}], []]:
                row = {**base, 'object': 'chat.completion.chunk', 'choices': choices}
                if not choices:
                    row['usage'] = usage
                self.wfile.write(('data: ' + json.dumps(row) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
        else:
            self.wfile.write(json.dumps({**base, 'object': 'chat.completion', 'usage': usage,
                'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': marker}, 'finish_reason': 'stop'}]}).encode())


class Client:
    def __init__(self, args, command, env, workspace):
        self.args, self.command, self.env, self.workspace = args, command, env, workspace
        self.pending, self.events, self.sequence = {}, [], 0

    async def start(self):
        self.process = await asyncio.create_subprocess_exec(*self.command, cwd=self.workspace, env=self.env,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True, limit=8 * 1024 * 1024)
        self.reader = asyncio.create_task(self.read())
        if self.args.runtime != 'pi':
            return await self.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {},
                'clientInfo': {'name': 'rovai-model-routing-control', 'version': '1'}})

    def write(self, row):
        self.process.stdin.write((json.dumps(row) + '\n').encode())

    async def read(self):
        while line := await self.process.stdout.readline():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get('method') and 'id' in row:
                self.write({'jsonrpc': '2.0', 'id': row['id'], 'result': {'outcome': {'outcome': 'cancelled'}}})
            elif row.get('id') in self.pending:
                future = self.pending.pop(row['id'])
                if not future.done():
                    future.set_result(row)
            else:
                self.events.append(row)
        for future in self.pending.values():
            if not future.done():
                future.set_exception(RuntimeError('native_eof'))

    async def call(self, method, params=None):
        self.sequence += 1
        request_id = str(self.sequence)
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        row = {'id': request_id, 'type': method, **(params or {})} if self.args.runtime == 'pi' else {
            'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params or {}}
        self.write(row)
        return await asyncio.wait_for(future, 60)

    async def close(self):
        self.process.stdin.close()
        try:
            await asyncio.wait_for(self.process.wait(), 3)
        except asyncio.TimeoutError:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), 3)
            except asyncio.TimeoutError:
                os.killpg(self.process.pid, signal.SIGKILL)
                await self.process.wait()
        await self.reader


def result(row):
    if 'error' in row:
        error = row['error']
        return {'ok': False, 'error': error if isinstance(error, str) else {
            'code': error.get('code'), 'message': str(error.get('message', ''))[:250]}}
    return {'ok': row.get('success', True)}


async def probe(args):
    out = Path(args.out)
    if not out.is_absolute() or out.exists() or not Path(args.program).is_absolute():
        raise ValueError('Use absolute program and a NEW absolute output directory')
    out.mkdir(mode=0o700, parents=True)
    workspace = out / 'workspace'
    workspace.mkdir(mode=0o700)
    env = {key: value for key, value in os.environ.items() if key in ['PATH', 'TMPDIR', 'SHELL', 'LANG']}
    env.update(HOME=str(out / 'home'), XDG_CONFIG_HOME=str(out / 'config'), XDG_DATA_HOME=str(out / 'data'),
        XDG_CACHE_HOME=str(out / 'cache'), XDG_STATE_HOME=str(out / 'state'), DO_NOT_TRACK='1',
        COMMANDCODE_SKIP_UPDATES='1', CMD_LOCAL_ONLY='1')
    for name in ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']:
        Path(env[name]).mkdir(mode=0o700)
    Provider.records = []
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    models = {'model-a': {'name': 'Model A', 'contextWindow': 128000, 'maxOutput': 1024},
              'vendor/shared': {'name': 'Shared model', 'contextWindow': 128000, 'maxOutput': 1024}}
    if args.runtime == 'command':
        native = Path(env['HOME']) / '.commandcode'
        put(native / 'providers.json', {'provider': {f'rovai-{name}': {'name': name,
            'baseURL': f'{base}/{name}/v1', 'api': 'openai-completions', 'apiKey': f'$MODEL_PROBE_KEY_{name.upper()}',
            'models': models} for name in ['a', 'b']}})
        env.update(MODEL_PROBE_KEY_A='fixture-a', MODEL_PROBE_KEY_B='fixture-b')
        put(native / 'config.json', {'model': 'rovai-a/model-a', 'localOnly': True})
        put(native / 'settings.json', {})
        if args.auth_file:
            source = Path(args.auth_file)
            if not source.is_absolute() or not source.is_file():
                raise ValueError('auth-file must be an existing absolute native auth path')
            (native / 'auth.json').symlink_to(source)
            original_auth = hashlib.sha256(source.read_bytes()).digest()
        command = ([shutil.which('node'), args.program] if args.program.endswith('.mjs') else [args.program])
        command += ['--no-auto-update', '--skip-onboarding', 'acp']
    elif args.runtime == 'opencode':
        config = out / 'opencode.json'
        put(config, {'model': 'rovai-a/model-a', 'small_model': 'rovai-a/model-a',
            'enabled_providers': ['rovai-a', 'rovai-b'], 'provider': {f'rovai-{name}': {
                'npm': '@ai-sdk/openai-compatible', 'name': name,
                'options': {'baseURL': f'{base}/{name}/v1', 'apiKey': f'fixture-{name}'},
                'models': {key: {'name': key, 'limit': {'context': 128000, 'output': 1024}}
                    for key in models}} for name in ['a', 'b']}})
        env.update(OPENCODE_CONFIG=str(config), OPENCODE_DISABLE_DEFAULT_PLUGINS='true')
        command = [args.program, 'acp']
    else:
        native = out / 'pi'
        put(native / 'models.json', {'providers': {f'rovai-{name}': {
            'baseUrl': f'{base}/{name}/v1', 'api': 'openai-completions', 'apiKey': f'fixture-{name}',
            'models': [{'id': key, 'contextWindow': 128000, 'maxTokens': 1024} for key in models]}
            for name in ['a', 'b']}})
        env['PI_CODING_AGENT_DIR'] = str(native)
        command = [args.program, '--mode', 'rpc', '--provider', 'rovai-a', '--model', 'model-a',
            '--session', str(out / 'session.jsonl'), '--no-extensions', '--no-skills', '--no-prompt-templates']
    summary = {'syntheticProvider': True, 'runtime': args.runtime, 'program': args.program, 'cases': [],
        'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    client = Client(args, command, env, workspace)

    async def prompt(label, session=None):
        before = len(Provider.records)
        first_event = len(client.events)
        params = {'message': 'Reply with a short answer. Do not call tools.'} if args.runtime == 'pi' else {
            'sessionId': session, 'prompt': [{'type': 'text', 'text': 'Reply with a short answer. Do not call tools.'}]}
        row = await client.call('prompt' if args.runtime == 'pi' else 'session/prompt', params)
        if args.runtime == 'pi' and row.get('success'):
            for _ in range(600):
                if any(e.get('type') == 'agent_end' for e in client.events[first_event:]):
                    break
                await asyncio.sleep(.1)
            else:
                raise TimeoutError('pi_agent_end_timeout')
        summary['cases'].append({'case': label, **result(row),
            'stopReason': row.get('result', {}).get('stopReason'), 'requests': Provider.records[before:]})

    try:
        init = await client.start()
        summary['initialize'] = (init or {}).get('result', {})
        if args.runtime == 'pi':
            catalog = await client.call('get_available_models')
            summary['models'] = [f"{m['provider']}/{m['id']}" for m in catalog.get('data', {}).get('models', [])]
            session = None
        else:
            created = await client.call('session/new', {'cwd': str(workspace), 'mcpServers': []})
            if 'error' in created:
                raise RuntimeError(json.dumps(result(created)))
            state = created['result']
            session = state['sessionId']
            summary['models'] = state.get('models', {})
            summary['configOptions'] = state.get('configOptions', [])
        await prompt('default', session)
        for model in ['rovai-a/model-a', 'rovai-b/vendor/shared', 'rovai-a/vendor/shared', 'rovai-missing/absent']:
            methods = ['set_model'] if args.runtime == 'pi' else ['session/set_model', 'session/set_config_option']
            for method in methods:
                params = ({'provider': model.split('/')[0], 'modelId': model.split('/', 1)[1]} if args.runtime == 'pi' else
                    {'sessionId': session, **({'modelId': model} if method.endswith('/set_model') else
                    {'configId': 'model', 'value': model})})
                row = await client.call(method, params)
                summary['cases'].append({'case': 'select', 'method': method, 'model': model, **result(row)})
                # Even rejection is followed by a request: proves the prior selection survives.
                await prompt(f'after:{method}:{model}', session)
        if args.runtime != 'pi':
            second = (await client.call('session/new', {'cwd': str(workspace), 'mcpServers': []}))['result']['sessionId']
            await prompt('second-session-default', second)
            await prompt('first-session-return', session)
            if summary['initialize'].get('agentCapabilities', {}).get('loadSession'):
                await client.close()
                client = Client(args, command, env, workspace)
                await client.start()
                loaded = await client.call('session/load', {'sessionId': session, 'cwd': str(workspace), 'mcpServers': []})
                summary['cases'].append({'case': 'cold-load', **result(loaded)})
                if 'error' not in loaded:
                    await prompt('cold-request', session)
        else:
            await client.close()
            # Let the native saved model win, rather than overriding it on restart.
            cold_command = command[:]
            for flag in ['--provider', '--model']:
                index = cold_command.index(flag)
                del cold_command[index:index + 2]
            client = Client(args, cold_command, env, workspace)
            await client.start()
            state = await client.call('get_state')
            summary['coldModel'] = {k: state.get('data', {}).get('model', {}).get(k) for k in ['provider', 'id']}
            await prompt('cold-request')
    except Exception as error:
        summary['failure'] = {'type': type(error).__name__, 'message': str(error)[:250]}
    finally:
        await client.close()
        if args.runtime == 'command':
            catalog_process = await asyncio.create_subprocess_exec(*command[:-1], '--list-models',
                cwd=workspace, env=env, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
            try:
                catalog_bytes, _ = await asyncio.wait_for(catalog_process.communicate(), 30)
            except asyncio.TimeoutError:
                os.killpg(catalog_process.pid, signal.SIGKILL)
                await catalog_process.wait()
                catalog_bytes = b''
            summary['cliListedCustomModels'] = {model: model.encode() in catalog_bytes for model in [
                'rovai-a/model-a', 'rovai-a/vendor/shared', 'rovai-b/vendor/shared']}
            for model in ['rovai-a/model-a', 'rovai-b/vendor/shared', 'rovai-a/vendor/shared']:
                before = len(Provider.records)
                process = await asyncio.create_subprocess_exec(*command[:-1], '--model', model,
                    '--print', 'Reply briefly. Do not call tools.', '--output-format', 'json',
                    cwd=workspace, env=env, stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    start_new_session=True)
                try:
                    await asyncio.wait_for(process.wait(), 60)
                except asyncio.TimeoutError:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()
                summary['cases'].append({'case': 'native-cli-model', 'model': model,
                    'exitCode': process.returncode, 'requests': Provider.records[before:]})
            if args.auth_file:
                summary['nativeAuthSourceUnchanged'] = hashlib.sha256(source.read_bytes()).digest() == original_auth
        server.shutdown()
        server.server_close()
        summary['requests'] = Provider.records
        put(out / 'summary.json', summary)
        print(json.dumps({'out': str(out), 'cases': len(summary['cases']),
            'requests': len(Provider.records), 'failure': summary.get('failure')}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', choices=['command', 'opencode', 'pi'], required=True)
    parser.add_argument('--program', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--auth-file')
    asyncio.run(probe(parser.parse_args()))
