"""Rebuild only the whitelisted numeric RunCard comparison fixture.

Existing real observations retain their original evidence references. Synthetic
acceptance units are labeled separately. This script never reads native logs,
credentials, current user data, prompt text, or response bodies.
"""

import json, pathlib, collections
b = pathlib.Path(__file__).resolve().parent.parent / 'docs/research/runtime-monitoring'
samples = []

def add(runtime, mode, source, case, calls, provenance='existing_real_observation'):

    def one(c):
        if c.get('total') is not None:
            return c['total']
        input_total = c.get('input')
        if input_total is None:
            input_total = sum_nullable([c.get('uncached'), c.get('read'), c.get('write')])
        output = c.get('output')
        if output is None:
            output = c.get('reasoning')
        return sum_nullable([input_total, output])

    def two(c):
        (i, o) = (c.get('input'), c.get('output'))
        if c.get('total') is not None:
            if i is None and o is not None:
                i = c['total'] - o
            if o is None and i is not None:
                o = c['total'] - i
        return i + o if i is not None and o is not None else None

    def sum_nullable(v):
        return sum((x for x in v if x is not None)) if any((x is not None for x in v)) else None
    a = sum_nullable([one(c) for c in calls])
    z = sum_nullable([two(c) for c in calls])
    samples.append(dict(runtime=runtime, mode=mode, evidence=source, case=case, provenance=provenance, calls=calls, scheme1=a, scheme2=z, knownTokensDiscarded=(a or 0) - (z or 0)))

def from_expected(c):
    d = c['expectedParsed']
    return {k: v for (k, v) in dict(input=d.get('promptInputTotalTokens'), output=d.get('outputTokens'), read=d.get('cacheReadTokens'), write=d.get('cacheWriteTokens')).items() if v is not None}
name = 'fixtures/round5-native-usage-context.json'
for e in json.loads((b / name).read_text())['entries']:
    if e['runtime'] in ['codebuddy-cli', 'kimi-code-cli', 'opencode-cli', 'claude-code-cli', 'pi']:
        for (i, r) in enumerate(e['runs']):
            calls = [from_expected(c) for c in r['sourceRecords'] if 'expectedParsed' in c]
            add(e['runtime'], 'native_root_calls', name, f'ordinary-tools-session-continuation-{i + 1}', calls)
name = 'fixtures/round6-native-context-ratio.json'
for e in json.loads((b / name).read_text())['entries']:
    if e['runtime'] == 'copilot-cli':
        for (i, r) in enumerate(e['runs']):
            add(e['runtime'], 'subscribed_native_calls', name, f'session-continuation-{i + 1}', [from_expected(c) for c in r['sourceRecords']])
name = 'fixtures/round7-native-boundaries.json'
for e in json.loads((b / name).read_text())['entries']:
    if e['runtime'] in ['qoder-cli', 'grok-build']:
        for (i, r) in enumerate(e['runs']):
            add(e['runtime'], 'custom' if e['runtime'] == 'qoder-cli' else 'turn_completed', name, f'cold-resume-{i + 1}', [from_expected(c) for c in r.get('sourceRecords', []) if 'expectedParsed' in c])
# Independent reference only; these deltas never join the production source.
e = next((e for e in json.loads((b / name).read_text())['entries'] if e['runtime'] == 'codex-cli'))
previous = dict(inputTokens=0, outputTokens=0, totalTokens=0)
assert e['cumulativeEndDeltaMatchesEachRun']
for (i, (end, run)) in enumerate(zip(e['rawCumulativeEnds'], e['runs'])):
    call = dict(input=end['inputTokens'] - previous['inputTokens'], output=end['outputTokens'] - previous['outputTokens'], total=end['totalTokens'] - previous['totalTokens'])
    assert call['input'] == run['finalReadback']['promptInputTotalTokens'] and call['output'] == run['finalReadback']['outputTokens']
    add('codex-cli', 'validated_run_counter_reference', name, f'native-boundary-reference-{i + 1}', [call])
    previous = end
name = 'fixtures/round12-kiro-and-field-audit.json'
obj = json.loads((b / name).read_text())['nativeFieldAudit']
for (runtime, entry) in obj.items():
    calls = []
    for c in entry['calls']:
        d = c.get('rawNumericUsage', c.get('usage'))
        x = {}
        if runtime in ['codebuddy-cli', 'trae-cn-cli']:
            x = dict(input=d.get('prompt_tokens'), output=d.get('completion_tokens'), total=d.get('total_tokens'))
        elif runtime == 'qoder-cli':
            x = dict(input=d.get('input_tokens'), output=d.get('output_tokens'))
        elif runtime == 'qwen-code':
            x = dict(input=d.get('promptTokenCount'), output=d.get('candidatesTokenCount'), reasoning=d.get('thoughtsTokenCount'))
        elif runtime == 'zcode-app':
            x = dict(input=d.get('inputTokens'), output=d.get('outputTokens'), total=d.get('totalTokens'))
        elif runtime == 'deepseek-harness':
            x = dict(input=d['totalTokens'] - d['outputTokens'], output=d['outputTokens'], total=d['totalTokens'])
        calls.append({k: v for (k, v) in x.items() if v is not None})
    add(runtime, 'custom' if runtime == 'qoder-cli' else 'native', name, 'multi-call-cache-missing', calls)
name = 'fixtures/round8-native-format-compatibility.json'
for e in json.loads((b / name).read_text())['entries']:
    if e['runtime'] == 'antigravity-app':
        for (i, r) in enumerate(e['runs']):
            calls = []
            for c in r['sourceRecords']:
                d = c.get('step_update', {}).get('usage')
                if d:
                    calls.append(dict(output=d['output_tokens'], read=d['cache_read_tokens']))
            add(e['runtime'], 'stream_only_unknown_input', name, f'native-tools-{i + 1}', calls)
name = 'fixtures/round11-native-source-completion.json'
e = json.loads((b / name).read_text())['rawAndExpected']['antigravity-app']
calls = []
for c in e['calls']:
    d = c['nativeAtArrival']['usage']
    calls.append(dict(input=d['input'] + d['read'] + d['write'], output=d['output']))
add('antigravity-app', 'validated_native_sqlite', name, 'native-tools', calls)
name = 'command-cline-numeric-evidence-2026-10-04.json'
for (runtime, records) in json.loads((b / name).read_text())['records'].items():
    groups = collections.defaultdict(dict)
    for r in records:
        v = r['value']
        f = v['fields']
        if v['scope'] != 'session' and any((f.get(k) is not None for k in ['inputTokens', 'outputTokens'])):
            groups[v['nativeTurnId'] if runtime == 'cline' else r['stage']][v['identitySuffix']] = {k: v for (k, v) in dict(input=f.get('inputTokens'), output=f.get('outputTokens')).items() if v is not None}
    for (stage, calls) in groups.items():
        add('cline-cli' if runtime == 'cline' else 'command-code-cli', 'plugin' if runtime == 'cline' else 'historical_headless', name, stage, list(calls.values()))
for (case, calls) in [('inclusive-cache', [dict(input=50000, output=5000, read=40000)]), ('missing-cache-write-exclusive', [dict(uncached=10000, read=40000, output=5000)]), ('output-only', [dict(output=5000)]), ('total-only', [dict(total=55000)]), ('missing-call-between-known', [dict(input=25000, output=5000), {}, dict(input=45000, output=5000)]), ('separate-one-sided-calls', [dict(input=50000), dict(output=5000)]), ('failed-after-usage', [dict(input=50000, output=5000)]), ('cancelled-after-usage', [dict(input=50000, output=5000)]), ('no-usage', [{}]), ('explicit-zero', [dict(input=0, output=0)]), ('reasoning-is-output-subset', [dict(input=50000, output=5000, reasoning=3000)])]:
    add('all', 'acceptance', None, case, calls, 'synthetic_boundary')
out = dict(schemaVersion=1, auditBase='70aab893810b03e8f45b7281efa7bceb3452ef5c', privacy='Only numeric counts, aliased scenario identities and existing evidence references; no native text or logs.', samples=samples)
p = b / 'fixtures/runcard-token-comparison-2026-11-15.json'
p.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
for rt in sorted(set((s['runtime'] for s in samples))):
    ss = [s for s in samples if s['runtime'] == rt]
    print(rt, len(ss), sum((s['scheme1'] is not None for s in ss)), sum((s['scheme2'] is not None for s in ss)), sum((s['knownTokensDiscarded'] for s in ss)))
