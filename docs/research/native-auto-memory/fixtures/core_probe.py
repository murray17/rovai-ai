import asyncio, json, os, sqlite3, hashlib, uuid, re
from pathlib import Path
from contextlib import closing
import probe as p
import shutil
import shlex

options=p.configure(managed=True)
REPO=options.repo.resolve(strict=True)
NODE=str(Path(shutil.which('node')).resolve(strict=True))
CORE=REPO/'target/debug/rovai-core'
results=[]

async def run(kind, with_mcp=False):
    case=p.ROOT/('managed-'+kind+'-'+uuid.uuid4().hex[:6]); case.mkdir(mode=0o700)
    cwd=case/'project'; home=case/'native'; host=case/'host'; data=case/'data'
    for d in [cwd,home,host,data]: d.mkdir(mode=0o700)
    env=p.BASE|{'HOME':str(host),'CODEX_HOME':str(home),'CLAUDE_CONFIG_DIR':str(home),
                'ANTHROPIC_BASE_URL':p.URL,'ANTHROPIC_API_KEY':'synthetic-fixture',
                'ANTHROPIC_MODEL':'claude-sonnet-4-6','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1',
                'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'0'}
    if kind=='codex-cli':
        cfg=f'''model = "gpt-5.4"
model_provider = "fixture"
[model_providers.fixture]
name = "fixture"
base_url = "{p.URL}/v1"
wire_api = "responses"
requires_openai_auth = false
[projects.{json.dumps(str(cwd))}]
trust_level = "trusted"
[features]
memories = true
[memories]
generate_memories = true
use_memories = true
'''
        p.put(home/'config.toml',cfg)
        p.put(cwd/'.git/HEAD','ref: refs/heads/main\n')
        p.put(cwd/'.codex/config.toml','[features]\nmemories=true\n[memories]\ngenerate_memories=true\nuse_memories=true\n')
        p.put(home/'memories/memory_summary.md',p.MEMORY)
        p.put(home/'memories/MEMORY.md',p.MEMORY)
        p.put(cwd/'AGENTS.md',p.RULE)
    else:
        p.put(home/'settings.json',json.dumps({'env':{'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'0'}}))
        p.put(cwd/'.claude/settings.json',json.dumps({'env':{'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'0'}}))
        p.put(home/'projects'/re.sub('[^a-zA-Z0-9]','-',str(cwd))/'memory/MEMORY.md',p.MEMORY)
        p.put(cwd/'CLAUDE.md',p.RULE)
    args=[str(CORE),'--data-dir',str(data),'--skill-library-root',str(case/'skills'),
          '--mcp-config-path',str(data/'mcp.json')]
    key='v1-'+hashlib.sha256(b'rovai-runtime-camp-files-instance-v1\0'+str(data).encode()).hexdigest()
    args+=['--runtime-camp-files-root',str(host/'.rovai/instances'/key/'runtime-files')]
    async def start(cold=False):
        launch=args.copy()
        if options.old_core and not cold: launch[0]=str(options.old_core.resolve(strict=True))
        return await p.RPC().start(launch,env,cwd,initialize=False)
    rpc=await start()
    try:
        await rpc.call('health.check',{})
        if with_mcp:
            for attempt in range(100):
                try: config=await rpc.call('mcp.config.get',{}); break
                except RuntimeError as error:
                    if 'initializing' not in str(error): raise
                    await asyncio.sleep(.1)
            definition={'mcpServers':{'fixture_echo':{'command':NODE,
                        'args':[str(REPO/'crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')],
                        'env':{'ROVAI_MCP_SMOKE_SOURCE':'fixture-mcp','ROVAI_MCP_SMOKE_CALL_MARKER':str(case/'mcp-calls')}}}}
            if not config['servers']:
                result=await rpc.call('mcp.servers.create',{'expectedConfigDigest':config['configDigest'],'definitionJson':json.dumps(definition)})
                assert result['status']=='ok',result['status']
            config=await rpc.call('mcp.config.get',{})
            result=await rpc.call('mcp.assignments.set',{'expectedConfigDigest':config['configDigest'],
                     'serverId':config['servers'][0]['serverId'],'agentId':'agent_2','assigned':True})
            assert result['status']=='ok',result['status']
            config=await rpc.call('mcp.config.get',{})
            result=await rpc.call('mcp.servers.setEnabled',{'expectedConfigDigest':config['configDigest'],
                     'serverId':config['servers'][0]['serverId'],'enabled':True})
            assert result['status']=='ok',result['status']
            assert result['config']['servers'][0]['enabled']
        exe=p.CODEX if kind=='codex-cli' else p.CLAUDE
        saved=await rpc.call('runtime.startup.save',{'runtimeKind':kind,'expectedRevision':0,
             'configuration':{'programPath':exe,'environment':[{'name':k,'value':v} for k,v in env.items() if k not in p.BASE]}})
        checked=await rpc.call('runtime.product.check',{'runtimeKind':kind})
        assert checked.get('ready'), 'Runtime fixture configuration was not ready'
        profile=await rpc.call('members.get',{'agentId':'agent_2'})
        permissions={'sandbox_mode':'danger-full-access','approval_policy':'never'} if kind=='codex-cli' else {'permission_mode':'bypassPermissions'}
        selected=await rpc.call('members.runtime.set',{'commandId':str(uuid.uuid4()),'command':{
            'agentId':'agent_2','expectedVersion':profile['version'],'adapterKind':kind,
            'model':{'mode':'runtime_default'},'permissions':{'adapterKind':kind,'schemaVersion':1,'values':permissions}}})
        assert selected['status']=='applied',selected

        created=await rpc.call('threads.create',{'commandId':str(uuid.uuid4()),'name':'Native memory isolation',
                'workspace':{'projectPath':str(cwd)},'memberAgentIds':['agent_2'],'defaultLeadAgentId':'agent_2','collaborationMode':'peer'})
        assert created['status']=='applied',created
        tid=created['payload']['threadId']
        helper=case/'memory_tools.py'
        p.put(helper,'''import subprocess,json,uuid
from pathlib import Path
def call(args):
    out=subprocess.run(['rovai']+args,capture_output=True,text=True)
    if out.returncode: raise RuntimeError(out.stdout or out.stderr)
    return json.loads(out.stdout)
request=Path(__file__).parent/'write.json'
request.write_text(json.dumps({'action':'add','scope':'companion','kind':'lesson','body':'SYNTHETIC_ROVAI_MEMORY: inspect receipts before reporting success.','retrievalKeys':['fixture memory']}))
state=Path(__file__).parent/'memory-state.json'
if state.exists(): written=json.loads(state.read_text())
else:
    written=call(['memory','write','--input-file',str(request)])
    state.write_text(json.dumps(written))
request=Path(__file__).parent/'read.json'
request.write_text(json.dumps({'memoryIds':[written['memoryId']]}))
read=call(['memory','read','--input-file',str(request)])
searched=call(['memory','search','--query','fixture memory'])
sent=call(['send','--public-only','--body','MEMORY_TOOLS_VERIFIED'])
result={'writeEffective':written.get('outcome')=='effective','readContainsBody':'SYNTHETIC_ROVAI_MEMORY' in json.dumps(read),'searchFound':written['memoryId'] in json.dumps(searched),'sendCommitted':bool(sent)}
(Path(__file__).parent/('tool-receipt-'+uuid.uuid4().hex+'.json')).write_text(json.dumps(result))
print(json.dumps(result))
''')
        seen=set()
        original_binding=None
        for phase in ['first','warm','cold']:
            if phase=='cold':
                await rpc.close()
                memory_file=(home/'memories/memory_summary.md' if kind=='codex-cli' else
                             home/'projects'/re.sub('[^a-zA-Z0-9]','-',str(cwd))/'memory/MEMORY.md')
                p.put(memory_file,p.MEMORY+'\n'+p.FRESH_MEMORY+'\n')
                rpc=await start(cold=True); await rpc.call('health.check',{})
            n=len(p.records)
            p.managed_tool_command='/usr/bin/python3 '+shlex.quote(str(helper))
            p.managed_tool_pending=True
            p.managed_mcp_pending=with_mcp
            sent=await rpc.call('thread.messages.send',{'commandId':str(uuid.uuid4()),'threadId':tid,
                'content':{'version':2,'segments':[{'kind':'text','text':(p.HISTORY if phase=='first' else 'Continue the conversation.')+' CORE_NATIVE_PROBE '+phase}]},
                'sourceAttachments':[],'quotes':[],'replyToThreadMessageId':None,
                'execution':{'taskId':None,'purpose':'Isolated native memory acceptance','completionRole':'required'}})
            sent=sent.get('commandResult',sent)
            assert sent['status']=='accepted',sent
            run=None
            for _ in range(180):
                snapshot=await rpc.call('camps.snapshot',{'threadId':tid})
                run=next((r for r in snapshot['agentRuns'] if r['id'] not in seen),None)
                if run and run['status'] in ['succeeded','failed','cancelled']: break
                await asyncio.sleep(.5)
            assert run,'no AgentRun'
            seen.add(run['id'])
            with closing(sqlite3.connect(data/'rovai.sqlite')) as db:
                binding=db.execute('select native_session_id,native_binding_id,native_binding_generation from conversation where id=?',(run['conversationId'],)).fetchone()
            receipts=[json.loads(f.read_text()) for f in case.glob('tool-receipt-*.json')]
            manifest=next((m for m in snapshot.get('contextManifests',[]) if m.get('agentRunId')==run['id']),{})

            if original_binding is None: original_binding=binding
            calls=(case/'mcp-calls').read_text().count('called') if (case/'mcp-calls').exists() else 0
            result={'kind':kind,'withMcp':with_mcp,'phase':phase,'status':run['status'],'binding':binding,
                    'sameBinding':binding==original_binding,'requests':p.records[n:],'toolReceipts':receipts,'mcpCalls':calls,
                    'hostIds':[m['params'].get('hostInstanceId') for m in rpc.notes if m.get('method')=='agent_run.started' and m.get('params',{}).get('agentRunId')==run['id']],
                    'mcpStatuses':[s['status'] for s in manifest.get('mcpExposure',{}).get('servers',[])]}
            if kind=='codex-cli':
                for dbfile in home.glob('state*.sqlite'):
                    with closing(sqlite3.connect(dbfile)) as native_db:
                        row=native_db.execute('select memory_mode from threads where id=?',(binding[0],)).fetchone()
                        if row: result['nativeMemoryInputMode']=row[0]
                assert result.get('nativeMemoryInputMode')==('enabled' if options.old_core else 'disabled')
            results.append(result); p.put(p.ROOT/'results.json',json.dumps(results,indent=2))
            print(json.dumps(result),flush=True)
            assert run['status']=='succeeded' and binding==original_binding
            assert len(receipts)==len(seen) and all(all(r.values()) for r in receipts)
            assert p.records[n:]
            if not options.old_core:
                assert all(not r['memory'] and r['rule'] and r['history'] for r in p.records[n:])
            else:
                # The enabled baseline can also issue background extraction
                # requests. The input marker identifies the project conversation.
                main_requests=[r for r in p.records[n:] if r['history']]
                assert main_requests and all(r['rule'] for r in main_requests)
                if phase!='cold': assert all(r['memory'] for r in main_requests)
            if with_mcp: assert calls==len(seen) and result['mcpStatuses']==['ready']
            if phase=='cold': assert all(not r['updatedMemory'] for r in p.records[n:])
            if kind=='codex-cli' and phase!='first':
                first=next(r for r in results if r.get('binding')==binding and r.get('phase')=='first')
                assert bool(result['hostIds']) and (first['hostIds']==result['hostIds'])==(phase=='warm')
    finally: await rpc.close()

async def main():
    for kind in ['codex-cli','claude-code-cli']:
        for with_mcp in [False,True]:
            try: await run(kind,with_mcp)
            except Exception as e:
                result={'kind':kind,'withMcp':with_mcp,'failure':str(e)}
                results.append(result); p.put(p.ROOT/'results.json',json.dumps(results,indent=2))
                print(json.dumps(result),flush=True)
    p.server.shutdown()
    assert not any('failure' in result for result in results), 'Inspect the bounded fixture results'
asyncio.run(main())
