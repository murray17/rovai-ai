"""Manual isolated native CLI A/B probe. Loopback provider; no real credentials."""
import argparse, asyncio, json, os, threading, uuid, sqlite3, hashlib, re, subprocess, platform
from pathlib import Path
from contextlib import closing, suppress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = None
CODEX = None
CLAUDE = None
MEMORY = 'NATIVE_MEMORY_SENTINEL_c52a82b8'
FRESH_MEMORY = 'UPDATED_NATIVE_MEMORY_SENTINEL_21ecab47'
RULE = 'PROJECT_RULE_SENTINEL_29f1ad92'
HISTORY = 'TURN_HISTORY_SENTINEL_8c41db01'
records = []
managed_tool_command = None
managed_tool_pending = False
managed_mcp_pending = False

class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
        self.wfile.write(b'{"data":[]}')
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        raw = json.dumps(data)
        global managed_tool_pending, managed_mcp_pending
        tool_command = None
        mcp_call = False
        if managed_tool_pending and 'CORE_NATIVE_PROBE' in raw:
            tool_command = managed_tool_command
            managed_tool_pending = False
        elif managed_mcp_pending and 'CORE_NATIVE_PROBE' in raw:
            mcp_call = True
            managed_mcp_pending = False
        records.append({'path': self.path, 'memory': MEMORY in raw, 'rule': RULE in raw, 'history': HISTORY in raw,
                        'updatedMemory':FRESH_MEMORY in raw,
                        'generationGuide': {s:s.lower() in raw.lower() for s in ['When to save memories', 'When to save memory', 'How to save memories', 'auto memory']},
                        'memoryInSystem':MEMORY in json.dumps(data.get('system',data.get('instructions',''))),
                        'saveGuideInSystem':'How to save memories' in json.dumps(data.get('system',data.get('instructions',''))),
                        'maxTokens':data.get('max_tokens'), 'mcpOffered':'fixture_echo' in json.dumps(data.get('tools',[]))})
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
        def event(name, value):
            self.wfile.write(('event: '+name+'\ndata: '+json.dumps(value)+'\n\n').encode()); self.wfile.flush()
        if '/messages' in self.path:
            event('message_start', {'type':'message_start','message':{'id':'msg_fixture','type':'message','role':'assistant','model':data.get('model'),'content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':100,'output_tokens':0}}})
            if tool_command or mcp_call:
                event('content_block_start', {'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':'tool_'+uuid.uuid4().hex,'name':'mcp__fixture_echo__echo' if mcp_call else 'Bash','input':{}}})
                event('content_block_delta', {'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':json.dumps({'text':'acceptance'} if mcp_call else {'command':tool_command})}})
                event('content_block_stop', {'type':'content_block_stop','index':0})
                event('message_delta', {'type':'message_delta','delta':{'stop_reason':'tool_use','stop_sequence':None},'usage':{'output_tokens':5}})
                event('message_stop', {'type':'message_stop'})
                return
            event('content_block_start', {'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})
            event('content_block_delta', {'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'fixture-complete'}})
            event('content_block_stop', {'type':'content_block_stop','index':0})
            event('message_delta', {'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':5}})
            event('message_stop', {'type':'message_stop'})
        else:
            item={'id':'msg_fixture','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'fixture-complete','annotations':[]}]}
            if tool_command or mcp_call:
                item={'id':'fc_'+uuid.uuid4().hex,'type':'function_call','call_id':'call_'+uuid.uuid4().hex,'name':'echo' if mcp_call else 'exec_command','arguments':json.dumps({'text':'acceptance'} if mcp_call else {'cmd':tool_command})}
                if mcp_call: item['namespace']='mcp__fixture_echo'
            event('response.created',{'type':'response.created','response':{'id':'resp_fixture','object':'response','status':'in_progress','output':[]}})
            event('response.output_item.added',{'type':'response.output_item.added','output_index':0,'item':item if (tool_command or mcp_call) else dict(item,content=[],status='in_progress')})
            if not (tool_command or mcp_call): event('response.output_text.delta',{'type':'response.output_text.delta','item_id':'msg_fixture','output_index':0,'content_index':0,'delta':'fixture-complete'})
            event('response.output_item.done',{'type':'response.output_item.done','output_index':0,'item':item})
            event('response.completed',{'type':'response.completed','response':{'id':'resp_fixture','object':'response','status':'completed','output':[item],'usage':{'input_tokens':100,'output_tokens':5,'total_tokens':105,'input_tokens_details':{'cached_tokens':0}}}})

server=ThreadingHTTPServer(('127.0.0.1',0),Provider)
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}'
BASE={k:os.environ[k] for k in ('PATH','TMPDIR','LANG') if k in os.environ}

def configure(managed=False):
    global ROOT, CODEX, CLAUDE
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex', required=True, type=Path)
    parser.add_argument('--claude', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    if managed:
        parser.add_argument('--repo', required=True, type=Path)
        parser.add_argument('--old-core', type=Path, help='Optional baseline Core for first/warm; cold uses the new Core')
    args=parser.parse_args()
    os.umask(0o077)
    ROOT=args.out.resolve(); ROOT.mkdir(mode=0o700)  # Refuse an existing fixture.
    CODEX=str(args.codex.resolve(strict=True)); CLAUDE=str(args.claude.resolve(strict=True))
    BASE['HOME']=str(ROOT/'os-home'); Path(BASE['HOME']).mkdir()
    metadata={'platform':platform.platform(),'modelProvider':'loopback scripted fixture','runtimes':{}}
    for name,program in [('codex',CODEX),('claude',CLAUDE)]:
        env=BASE|{'CODEX_HOME':str(ROOT/'version-codex'),'CLAUDE_CONFIG_DIR':str(ROOT/'version-claude')}
        version=subprocess.run([program,'--version'],env=env,cwd=ROOT,capture_output=True,text=True,check=True,timeout=15).stdout.strip()
        digest=hashlib.sha256()
        with open(program,'rb') as binary:
            for chunk in iter(lambda:binary.read(1024*1024),b''): digest.update(chunk)
        metadata['runtimes'][name]={'version':version,'sha256':digest.hexdigest()}
    put(ROOT/'metadata.json',json.dumps(metadata,indent=2))
    return args

async def stop_process(process):
    """Bounded cleanup for these manual probes only."""
    process.stdin.close()
    for signal, timeout in [(None, 10), (process.terminate, 5), (process.kill, 5)]:
        if signal is not None:
            with suppress(ProcessLookupError): signal()
        try:
            await asyncio.wait_for(process.wait(), timeout)
            return
        except asyncio.TimeoutError:
            pass
    raise RuntimeError('Fixture process did not exit after forced termination')

class RPC:
    async def start(self, args, env, cwd, initialize=True):
        self.p=await asyncio.create_subprocess_exec(*args,env=env,cwd=cwd,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,limit=16*1024*1024)
        self.errors=asyncio.create_task(self.p.stderr.read()); self.n=0; self.notes=[]
        if initialize:
            try:
                await self.call('initialize',{'clientInfo':{'name':'rovai-memory-probe','version':'1'},'capabilities':{'experimentalApi':True}})
                self.send({'method':'initialized','params':{}})
            except BaseException:
                await self.close(); raise
        return self
    def send(self, msg): self.p.stdin.write((json.dumps(msg)+'\n').encode())
    async def read(self):
        line=await asyncio.wait_for(self.p.stdout.readline(),30)
        if not line: raise RuntimeError('Runtime exited before its RPC response')
        return json.loads(line)
    async def call(self, method, params):
        self.n+=1; n=self.n; self.send({'id':n,'method':method,'params':params})
        while True:
            msg=await self.read()
            if msg.get('id')==n:
                if 'error' in msg: raise RuntimeError(str(msg['error']))
                return msg['result']
            self.notes.append(msg)
    async def turn(self, tid, body):
        self.notes=[]
        r=await self.call('turn/start',{'threadId':tid,'input':[{'type':'text','text':body}]})
        while True:
            done=next((m for m in self.notes if m.get('method')=='turn/completed'),None)
            if done: return done['params']['turn']['status']
            self.notes.append(await self.read())
    async def close(self):
        try:
            await stop_process(self.p)
            try: self.stderr_text=(await asyncio.wait_for(self.errors,5)).decode(errors="replace")
            except asyncio.TimeoutError:
                raise RuntimeError('Fixture stderr did not reach EOF during cleanup') from None
        finally:
            if not self.errors.done(): self.errors.cancel()

def put(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(value)
    path.chmod(0o600)

async def codex(disabled):
    case=ROOT/('codex-off' if disabled else 'codex-on'); home=case/'home'; cwd=case/'project'
    cwd.mkdir(parents=True,exist_ok=True); home.mkdir(parents=True,exist_ok=True)
    settings=f'''model = "gpt-5.4"
model_provider = "fixture"
[model_providers.fixture]
name = "fixture"
base_url = "{URL}/v1"
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
    put(home/'config.toml',settings)
    put(cwd/'.git'/'HEAD','ref: refs/heads/main\n')
    project='[features]\nmemories = true\n[memories]\ngenerate_memories = true\nuse_memories = true\n'
    put(cwd/'.codex'/'config.toml',project)
    put(cwd/'AGENTS.md',RULE+'\n')
    put(home/'memories'/'memory_summary.md',MEMORY+'\n')
    put(home/'memories'/'MEMORY.md',MEMORY+'\n')
    args=[CODEX]
    if disabled:
        for key in ['features.memories','memories.generate_memories','memories.use_memories']: args+=['-c',key+'=false']
    args+=['app-server','--listen','stdio://']
    env=BASE|{'CODEX_HOME':str(home)}
    rpc=await RPC().start(args,env,cwd)
    try:
        config=await rpc.call('config/read',{'cwd':str(cwd),'includeLayers':True})
        cfg=config.get('config',{})
        def flags(c): return {'features.memories':c.get('features',{}).get('memories'),'memories.generate_memories':c.get('memories',{}).get('generate_memories'),'memories.use_memories':c.get('memories',{}).get('use_memories')}
        readback=flags(cfg)
        layers=[{'kind':l.get('name',{}).get('type'),'disabled':l.get('disabledReason'), 'flags':flags(l.get('config',{}))} for l in config.get('layers',[])]
        t=await rpc.call('thread/start',{'cwd':str(cwd),'approvalPolicy':'never','sandbox':'danger-full-access','ephemeral':False})
        tid=t['thread']['id']; start=len(records)
        status=await rpc.turn(tid,HISTORY)
        first=records[start:]
    finally: await rpc.close()
    put(home/'memories/memory_summary.md',MEMORY+'\n'+FRESH_MEMORY+'\n')
    rpc=await RPC().start(args,env,cwd)
    try:
        t=await rpc.call('thread/resume',{'threadId':tid,'cwd':str(cwd),'approvalPolicy':'never','sandbox':'danger-full-access'})
        start=len(records); resumed=await rpc.turn(tid,'Continue the same conversation.')
        cold=records[start:]
        resumed_id=t['thread']['id']
        thread_override=None
        if disabled:
            alternate=await rpc.call('thread/start',{'cwd':str(cwd),'approvalPolicy':'never','sandbox':'danger-full-access',
                'config':{'features.memories':True,'memories.generate_memories':True,'memories.use_memories':True}})
            start=len(records)
            alternate_status=await rpc.turn(alternate['thread']['id'],'Thread override control.')
            reread=await rpc.call('config/read',{'cwd':str(cwd)})
            thread_override={'status':alternate_status,'requests':records[start:],'configRead':flags(reread['config'])}
    finally: await rpc.close()
    state=[]
    for dbpath in home.glob('state*.sqlite'):
        with closing(sqlite3.connect(dbpath)) as db:
            cols=[r[1] for r in db.execute('pragma table_info(threads)')]
            keys=[k for k in cols if 'memory' in k]
            if keys:
                state.append(dict(zip(keys,db.execute('select '+','.join(keys)+' from threads where id=?',(tid,)).fetchone())))
    return {'runtime':'codex','disabled':disabled,'configRead':readback,'layers':layers,'startStatus':status,'resumeStatus':resumed,'sameThread':resumed_id==tid,'first':first,'cold':cold,'inputEligibility':state,'threadOverrideControl':thread_override,'configUnchanged':(home/'config.toml').read_text()==settings and (cwd/'.codex/config.toml').read_text()==project}

async def claude(disabled):
    case=ROOT/('claude-off' if disabled else 'claude-on'); home=case/'home'; cwd=case/'project'
    cwd.mkdir(parents=True,exist_ok=True); home.mkdir(parents=True,exist_ok=True)
    settings=json.dumps({'env':{'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'0','CLAUDE_CODE_MAX_OUTPUT_TOKENS':'2222'}})
    project=json.dumps({'env':{'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'0','CLAUDE_CODE_MAX_OUTPUT_TOKENS':'3333'}})
    put(home/'settings.json',settings); put(cwd/'.claude'/'settings.json',project)
    put(cwd/'CLAUDE.md',RULE+'\n')
    memory=home/'projects'/re.sub('[^a-zA-Z0-9]','-',str(cwd))/'memory'/'MEMORY.md'
    put(memory,MEMORY+'\n')
    managed=case/'managed-settings.json'
    put(managed,json.dumps({'env':{'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'1' if disabled else '0'}}))
    env=BASE|{'CLAUDE_CONFIG_DIR':str(home),'ANTHROPIC_BASE_URL':URL,'ANTHROPIC_API_KEY':'synthetic-fixture','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1','CLAUDE_CODE_DISABLE_AUTO_MEMORY':'1' if disabled else '0'}
    sid=str(uuid.uuid4())
    async def run(resume,body):
        args=[CLAUDE,'--print','--verbose','--output-format','stream-json','--model','claude-sonnet-4-6','--settings',str(managed),'--resume' if resume else '--session-id',sid]
        p=await asyncio.create_subprocess_exec(*args,env=env,cwd=cwd,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        try: out,err=await asyncio.wait_for(p.communicate(body.encode()),45)
        except asyncio.TimeoutError:
            with suppress(ProcessLookupError): p.kill()
            await asyncio.wait_for(p.wait(),5)
            raise
        events=[json.loads(l) for l in out.decode().splitlines() if l.startswith('{')]
        result=next((e for e in reversed(events) if e.get('type')=='result'),{})
        return {'exitCode':p.returncode,'error':result.get('is_error'),'sameSession':result.get('session_id')==sid,'subtype':result.get('subtype')}
    start=len(records); first=await run(False,HISTORY); first['requests']=records[start:]
    put(memory,MEMORY+'\n'+FRESH_MEMORY+'\n')
    start=len(records); cold=await run(True,'Continue the same conversation.'); cold['requests']=records[start:]
    return {'runtime':'claude','disabled':disabled,'first':first,'cold':cold,'configUnchanged':(home/'settings.json').read_text()==settings and (cwd/'.claude/settings.json').read_text()==project}

async def main():
    results=[]
    for fn in [codex,claude]:
        for disabled in [False,True]:
            try: result=await fn(disabled)
            except Exception as e: result={'runtime':fn.__name__,'disabled':disabled,'failure':str(e)}
            results.append(result); print(json.dumps(result),flush=True)
            put(ROOT/'results.json',json.dumps(results,indent=2))
    server.shutdown()
    assert not any('failure' in result for result in results), 'Inspect the bounded fixture results'
    for result in results:
        assert result['configUnchanged']
        for phase in ['first','cold']:
            requests=result[phase] if result['runtime']=='codex' else result[phase]['requests']
            # An enabled Codex can also make auxiliary requests without the user turn.
            # Identify the conversation by its input marker, retaining every request in evidence.
            conversation=[r for r in requests if r['history']]
            assert conversation and all(r['memory'] != result['disabled'] and r['rule'] for r in conversation)
            if result['disabled']: assert all(not r['memory'] for r in requests)
            if result['runtime']=='claude':
                if phase=='cold': assert all(r['updatedMemory'] != result['disabled'] for r in conversation)
                assert result[phase]['exitCode']==0 and result[phase]['sameSession'] and not result[phase]['error']
                assert all(r['maxTokens']==3333 and r['generationGuide']['How to save memories'] != result['disabled'] for r in conversation)
        if result['runtime']=='codex':
            assert result['sameThread'] and result['startStatus']==result['resumeStatus']=='completed'
            assert all(v != result['disabled'] for v in result['configRead'].values())
            assert result['inputEligibility']==[{'memory_mode':'disabled' if result['disabled'] else 'enabled'}]
            assert any(l['kind']=='project' and l['disabled'] is None and all(v is True for v in l['flags'].values()) for l in result['layers'])
            if result['disabled']:
                control=result['threadOverrideControl']
                assert control['status']=='completed' and any(r['memory'] and r['rule'] for r in control['requests'])
                assert all(v is False for v in control['configRead'].values())

if __name__ == '__main__':
    configure()
    asyncio.run(main())
