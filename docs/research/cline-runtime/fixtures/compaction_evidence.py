"""Validate retained experiment evidence and export only allowlisted public fields."""
import argparse
import hashlib
import json
import sqlite3
import tarfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent
MEMORY = 'SHIM72_MEMORY_759cf7dba031'
SYSTEM = 'SHIM72_SYSTEM_ALPHA'
SKILL = 'SHIM72_SKILL_BLUE'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text())


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def native_files(case, session_id):
    result = []
    for path in sorted((case / 'home/.cline/data').rglob(session_id + '*.json')):
        data = read(path)
        item = {'name': path.name, 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
        if isinstance(data.get('messages'), list):
            item['messageCount'] = len(data['messages'])
            item['messageIdsSha256'] = sha(json.dumps([m.get('id') for m in data['messages']]).encode())
        for key in ['source_message_count', 'source_prefix_hash', 'source_last_message_key', 'conversation_id']:
            if key in data:
                item[key] = data[key]
        result.append(item)
    return result


def check_receipts(receipts, replies):
    assert [item['phase'] for item in receipts] == ['before', 'after', 'cold']
    assert len({item['receipt'] for item in receipts}) == 3
    for item in receipts:
        assert item['receipt'] in replies[item['phase']]
        assert SKILL in replies[item['phase']]
    for phase in ['after', 'cold']:
        assert SYSTEM in replies[phase] and MEMORY in replies[phase]


def direct_case(root, variant):
    case = root / 'cases' / variant
    report = read(case / 'report.json')
    assert 'fatalError' not in report
    session_id = report['newSession']['sessionId']
    assert len(report['turns']) == 19
    assert len(report['processes']) == 2 and all(p['exitCode'] == 0 for p in report['processes'])
    assert len({p['pid'] for p in report['processes']}) == 2
    turns = []
    observations = []
    messages_path = next((case / 'home/.cline/data').rglob(session_id + '.messages.json'))
    final_ids = [m.get('id') for m in read(messages_path)['messages']]
    for turn in report['turns']:
        assert turn['sessionId'] == session_id and turn['error'] is None
        assert turn['result']['stopReason'] == 'end_turn'
        if turn['label'].startswith('block-'):
            assert turn['reply'] == 'BLOCK_' + turn['label'][-2:] + '_ACK'
        obs = turn['observations']
        assert [o['seq'] for o in obs] == list(range(1, len(obs) + 1))
        assert obs[0]['kind'] == 'run_started' and obs[-1]['kind'] == 'run_finished'
        for state in turn['nativeFiles']:
            if state['name'].endswith('.messages.json'):
                assert sha(json.dumps(final_ids[:state['messageCount']]).encode()) == state['messageIdsSha256']
        turns.append({key: turn[key] for key in ['label', 'sessionId', 'inputBytes', 'inputSha256', 'elapsedSeconds', 'result', 'error', 'approvals', 'observations', 'nativeFiles']})
        observations.extend(obs)
    compact = [o for o in observations if o['kind'] == 'compaction']
    assert len(compact) == (2 if variant == 'shim' else 0)
    if compact:
        assert [o['phase'] for o in compact] == ['started', 'completed']
        assert all(o['trigger'] == 'auto_compaction' for o in compact)
        assert compact[-1]['tokensAfter'] < compact[-1]['tokensBefore']
        assert compact[-1]['messagesAfter'] < compact[-1]['messagesBefore']
    assert report['deniedFileExists'] is False
    denied = next(t for t in report['turns'] if t['label'] == 'permission-deny')
    assert len(denied['approvals']) == 1 and denied['approvals'][0]['selectedKind'] == 'reject_once'
    replies = {phase: next(t['reply'] for t in report['turns'] if t['label'] == label)
               for phase, label in [('before', 'capabilities-before'), ('after', 'capabilities-after'), ('cold', 'cold')]}
    check_receipts(report['mcpReceipts'], replies)
    assert all(item['otherFieldsPreserved'] for item in report['configWitness'])
    if variant != 'stock':
        expected = {'enabled': True} if variant == 'shim' else None
        assert len(report['configWitness']) == 2 and all(w['compaction'] == expected for w in report['configWitness'])
    return {'sessionId': session_id, 'turns': turns, 'processes': report['processes'],
            'modelSettingsSha256': report['settingsSha256']['models.json'], 'configWitness': report['configWitness'],
            'mcpReceipts': report['mcpReceipts'], 'capabilityReplies': replies,
            'canonicalMessageIdPrefixesPreserved': True, 'deniedFileExists': False,
            'maxSuccessfulInputTokens': max(o['metrics'].get('inputTokens', 0) for o in observations if o['kind'] == 'model_completed'),
            'compactionCount': len(compact) // 2, 'nativeFilesAfterCold': native_files(case, session_id),
            'beforeModelWitnessAvailable': any(t['requestWitness'] for t in report['turns'])}


def product_case(root, name, require_witness=True):
    case = root / 'cases' / name
    report = read(case / 'report.json')
    assert 'fatalError' not in report
    assert len(report['processes']) == 2 and all(p['code'] == 0 for p in report['processes'])
    binding = report['turns'][0]['bindings']
    assert len(binding) == 1
    session_id = binding[0]['native_session_id']
    turns = []
    all_witness = []
    for turn in report['turns']:
        assert turn['bindings'] == binding and turn['run']['status'] == 'succeeded'
        assert len(turn['messages']) == 1 and turn['messages'][0]['sourceAgentRunId'] == turn['run']['id']
        assert turn['run']['runtimeModel']['modelId'] == 'gpt-6-sol'
        witness = turn.get('witness', [])
        if require_witness:
            before = [w for w in witness if w['kind'] == 'readonly_before_model']
            assert before and all(w['sessionId'] == session_id for w in witness)
            assert all(w['systemMarkerCount'] == 1 and w['userSystemMarkerCount'] == 0 for w in before)
        all_witness.extend(witness)
        turns.append({'label': turn['label'], 'runId': turn['run']['id'], 'status': turn['run']['status'],
                      'startedAt': turn['run']['startedAt'], 'endedAt': turn['run']['endedAt'],
                      'inputSha256': turn['inputSha256'], 'inputBytes': turn['inputBytes'],
                      'binding': turn['bindings'][0], 'messages': turn['messages'], 'witness': witness})
    if require_witness:
        before = [w for w in all_witness if w['kind'] == 'readonly_before_model']
        assert len({w['systemSha256'] for w in before}) == 1
        assert len({tuple(w['toolNames']) for w in before}) == 1
        assert all('shim72__shim_receipt' in w['toolNames'] and 'skills' in w['toolNames'] for w in before)
    connection = sqlite3.connect('file:' + str(case / 'user-data/rovai.sqlite') + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    persisted = [dict(row) for row in connection.execute("SELECT id,agent_run_id,execution_epoch,event_type,payload_preview_json FROM agent_run_execution_evidence WHERE event_type='runtime.compaction.display' ORDER BY occurred_at")]
    for item in persisted:
        item['payload'] = json.loads(item.pop('payload_preview_json'))
    completed = [row for row in persisted if row['payload']['phase'] == 'completed']
    assert completed and all(row['payload']['completionEvidence'] == 'native_terminal' for row in completed)
    assert len({(row['payload']['compactionId'], row['payload']['phase']) for row in persisted}) == len(persisted)
    unique_notifications = {event['params']['evidenceId']: event['params'] for event in report['compactionEvents']}
    assert set(unique_notifications) == {row['id'] for row in persisted}
    for row in persisted:
        event = unique_notifications[row['id']]
        assert event['nativeMethod'] == 'cline.plugin.compaction.v1' and event['payload'] == row['payload']
    if require_witness:
        native_completed = [w for w in all_witness if w['kind'] == 'readonly_native_compaction' and w['nativeMetadata']['phase'] == 'completed']
        assert len(native_completed) == len(completed)
        for w in native_completed:
            event = next(row for row in completed if row['payload']['compactionId'].startswith(w['runId'] + ':'))
            assert event['payload']['tokens']['after'] == w['nativeMetadata']['tokensAfter']
            assert event['payload']['tokens']['before'] == w['nativeMetadata']['tokensBefore']
    receipts = rows(case / 'mcp-receipts.jsonl')
    replies = {phase: next(t['messages'][0]['body'] for t in report['turns'] if t['label'] == label)
               for phase, label in [('before', 'capabilities-before'), ('after', 'capabilities-after'), ('cold', 'cold')]}
    check_receipts(receipts, replies)
    return {'case': name, 'threadId': report['threadId'], 'agentId': report['agentId'], 'turns': turns,
            'processes': report['processes'], 'executableSha256': report['executableSha256'],
            'executedShimSha256': report['shimSha256'], 'configWitness': rows(case / 'config-witness.jsonl'),
            'mcpReceipts': receipts, 'persistedCompactionEvents': persisted,
            'rawNotificationCount': len(report['compactionEvents']), 'uniquePersistedEventCount': len(persisted),
            'compactionCount': len(completed), 'nativeFilesAfterCold': native_files(case, session_id),
            'bindingUnchanged': True, 'allPublicSendsCorrelatedBySourceAgentRunId': True,
            'beforeModelWitnessRetained': require_witness}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--settings-source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    models = read(args.settings_source / 'models.json')
    assert models['providers']['openai-compatible']['models']['gpt-6-sol']['contextWindow'] == 272000
    direct = {variant: direct_case(root, variant) for variant in ['stock', 'source-control', 'shim']}
    assert len({case['modelSettingsSha256'] for case in direct.values()}) == 1
    for turns in zip(*(case['turns'] for case in direct.values())):
        assert len({(t['label'], t['inputSha256']) for t in turns}) == 1
    preferences = {}
    for mode, expected in {'default': {'enabled': True}, 'basic': {'enabled': True, 'strategy': 'basic'}, 'off': {'enabled': False}, 'agentic': {'enabled': True, 'strategy': 'agentic'}}.items():
        report = read(root / 'cases' / ('preference-' + mode) / 'report.json')
        assert 'fatalError' not in report and report['turns'][0]['error'] is None
        assert report['configWitness'][0]['compaction'] == expected
        preferences[mode] = report['configWitness']
    source_manifest = []
    with tarfile.open(root / 'cline-upstream.tar.gz') as archive:
        for member in archive.getmembers():
            path = Path(*Path(member.name).parts[1:])
            if member.isfile() and path.parts[:2] == ('apps', 'cli'):
                upstream = archive.extractfile(member).read()
                assert (root / 'upstream' / path).read_bytes() == upstream
                source_manifest.append([str(path), sha(upstream)])
    packages = {}
    for name in ['cline', '@cline/core', '@cline/shared', '@cline/agents', '@cline/llms', '@cline/sdk', '@oven/bun-darwin-aarch64']:
        path = root / 'install/node_modules' / name
        value = {'version': read(path / 'package.json')['version']}
        if (path / 'dist/index.js').exists():
            value['entrySha256'] = sha((path / 'dist/index.js').read_bytes())
        packages[name] = value
    evidence = {'schemaVersion': 1, 'observedDate': '2026-10-07', 'classification': 'experimental_native_compaction_observed',
                'platform': 'macos-arm64', 'provider': 'openai-compatible / sub2api', 'model': 'gpt-6-sol', 'nativeContextWindow': 272000,
                'upstreamCommit': '241c1884a7461ef35f6c384a027a38e8d03b3b33',
                'upstreamArchiveSha256': sha((root / 'cline-upstream.tar.gz').read_bytes()),
                'unmodifiedCliSourceFiles': len(source_manifest), 'cliSourceManifestSha256': sha(json.dumps(sorted(source_manifest)).encode()),
                'packages': packages, 'dependencyLockSha256': sha((root / 'install/bun.lock').read_bytes()),
                'officialBinarySha256': sha((root / 'install/node_modules/@cline/cli-darwin-arm64/bin/cline').read_bytes()),
                'directAblation': direct, 'preferenceConfigMatrix': preferences,
                'product': product_case(root, 'product-final'),
                'preliminaryProductRun': product_case(root, 'product-v3', require_witness=False),
                'harnessCorrections': [
                    {'case': 'pilot', 'stage': 'before_initialize', 'detail': 'createRequire resolution rejected ESM-only Core exports; switched to Bun import resolution; no model request.'},
                    {'cases': ['shim', 'source-control'], 'detail': 'Initial .mjs witness was ignored by native Plugin discovery. Numeric production observer remained active. Corrected deployment to .js; final product evidence contains 32 durable beforeModel observations.'},
                    {'case': 'product', 'detail': 'Probe assumed admission immediately returned agentRunIds; Core was stopped with the input queued. No model request from this case.'},
                    {'case': 'product-v2', 'detail': 'Two successful Runs were misgrouped by nullable threadTurnId. Corrected evidence correlation to sourceAgentRunId; no duplicate send in the actual database.'},
                    {'case': 'product-v3', 'detail': '16 successful Runs and 3 persisted native compactions. Host cleanup removed temporary request witness; repeated product-final with a durable witness path.'},
                ],
                'validation': {'matchingPromptHashesAcrossDirectCases': True, 'nativeModelWindowUnmodified': True,
                               'sourceArchiveMatchesExtractedCli': True, 'canonicalMessageIdPrefixesPreserved': True,
                               'productionImplementationChanged': False},
                'boundaries': ['No overflow recovery/retry qualification in this experiment.',
                               'basic/off/agentic preference matrix validates startup config and first real request, not all long-context strategies.',
                               'Source control/shim first pass omitted beforeModel witness because .mjs was ignored; final product pass retains .js witness outside Host cleanup.',
                               'Original 918618-token overflow baseline belongs to CLI 3.0.65, not 3.0.68.',
                               'Native compaction token estimates are separate from Provider inputTokens.',
                               'Native skill file consumption was tested; not every skill discovery/enablement combination.']}
    if (root / 'final-verification.json').exists():
        evidence['finalVerification'] = read(root / 'final-verification.json')
    # Exact private credential matching, not a guessed secret regex.
    provider = read(args.settings_source / 'providers.json')['providers']['openai-compatible']['settings']
    public_text = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
    for key in ['apiKey', 'baseUrl']:
        assert not provider.get(key) or provider[key] not in public_text, 'Private provider value would enter evidence'
    args.output.write_text(public_text)
    print(json.dumps({'output': str(args.output), 'directTurns': [len(c['turns']) for c in direct.values()],
                      'productRuns': len(evidence['product']['turns']), 'productCompactions': evidence['product']['compactionCount'],
                      'publicCredentialMatches': 0, 'sha256': sha(public_text.encode())}))


if __name__ == '__main__':
    main()
