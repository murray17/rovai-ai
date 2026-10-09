#!/usr/bin/env python3
"""Research only: installed CLI --model/--resume, System Mod and permission seams.

Uses a local synthetic provider and native tools in a new private workspace.
No model SDK, history-file reads/writes, credential copy, or production routing.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from model_selection_probe import put


MOD = r'''
import {readFileSync, appendFileSync, existsSync} from 'node:fs';
const root = process.env.HEADLESS_PROBE_ROOT;
const bootstrap = process.env.HEADLESS_PROBE_BOOTSTRAP;
const log = value => appendFileSync(`${root}/hooks.jsonl`, JSON.stringify({...value,at:Date.now()})+'\n', {mode:0o600});
export default function(cmd) {
  log({kind:'factory',bound:Boolean(cmd.session)});
  cmd.on('session_start', event => log({kind:'session_start',sessionId:event.sessionId,bound:Boolean(cmd.session)}));
  cmd.hooks({
    appendSystemPrompt({state}) {
      log({kind:'system',sessionId:state.sessionId,bound:Boolean(cmd.session)});
      return bootstrap;
    },
    async beforeToolCall({toolCallId,toolName,state}) {
      const policy = process.env.HEADLESS_PROBE_POLICY;
      log({kind:'before_tool',toolCallId,toolName,sessionId:state.sessionId,policy});
      if(policy==='deny') return {block:true,additionalContext:'Denied by the isolated approval fixture.'};
      if(policy!=='wait') return;
      // Demonstrates the native await/block seam; this is NOT a Rovai approval UI.
      const until=Date.now()+15000;
      while(Date.now()<until) {
        if(existsSync(`${root}/decision.json`)) {
          const decision=JSON.parse(readFileSync(`${root}/decision.json`));
          if(decision.toolCallId!==toolCallId || decision.sessionId!==state.sessionId) {
            return {block:true,additionalContext:'Mismatched approval fixture identity.'};
          }
          log({kind:'decision',allow:decision.allow,toolCallId,sessionId:state.sessionId});
          return decision.allow ? undefined : {block:true,additionalContext:'Approval fixture denied.'};
        }
        await new Promise(r=>setTimeout(r,25));
      }
      return {block:true,additionalContext:'Approval fixture timed out.'};
    }
  });
}
'''


class Provider(BaseHTTPRequestHandler):
    records = []
    scenario = 'text'
    call = 0
    workspace = None
    marker = None
    bootstrap = None
    label = None

    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        provider = self.path.split('/')[1]
        messages = body.get('messages', [])
        system = json.dumps([m for m in messages if m.get('role') in ['system', 'developer']])
        user = json.dumps([m for m in messages if m.get('role') == 'user'])
        tools = {t['function']['name']:t['function'] for t in body.get('tools', []) if 'function' in t}
        cls = type(self)
        cls.call += 1
        record = {'case':self.label,'provider':provider,'model':body.get('model'),
            'authMatched':self.headers.get('Authorization') == f'Bearer synthetic-{provider}',
            'systemBootstrapCount':system.count(self.bootstrap), 'userBootstrapCount':user.count(self.bootstrap),
            'earlyMemoryPresent':self.marker in user,'currentInputCount':user.count(f'INPUT_{self.label}'),
            'messageCount':len(messages),'toolNames':sorted(tools),'at':time.time()}
        cls.records.append(record)
        call = None
        if cls.call == 1 and self.scenario in ['write','shell','read']:
            if self.scenario == 'write':
                name, args = 'write_file', {'file_path':str(self.workspace / f'{self.label}.txt'),'content':'HEADLESS_TOOL_OK\n'}
            elif self.scenario == 'read':
                name, args = 'read_file', {'file_path':str(self.workspace / 'read-source.txt')}
            else:
                name, args = 'shell_command', {'command':
                    'python3 -c "import os,pathlib,time; pathlib.Path(\'cancel-child.pid\').write_text(str(os.getpid())); time.sleep(30)"', 'timeout':60}
            record['requestedToolAdvertised'] = name in tools
            call = {'id':f'call_{self.label}','type':'function','function':{'name':name,'arguments':json.dumps(args)}}
        content = f'CONTROL_{self.label}'
        self.send_response(200)
        self.send_header('Content-Type','text/event-stream' if body.get('stream') else 'application/json')
        self.end_headers()
        common = {'id':f'response_{self.label}_{cls.call}','created':1,'model':body.get('model')}
        usage = {'prompt_tokens':40,'completion_tokens':5,'total_tokens':45}
        if body.get('stream'):
            delta = {'role':'assistant', 'tool_calls':[{'index':0,**call}]} if call else {'role':'assistant','content':content}
            chunks = [({'index':0,'delta':delta,'finish_reason':None},None),
                ({'index':0,'delta':{},'finish_reason':'tool_calls' if call else 'stop'},None)]
            for choice,_ in chunks:
                self.wfile.write(('data: '+json.dumps({**common,'object':'chat.completion.chunk','choices':[choice]})+'\n\n').encode())
            self.wfile.write(('data: '+json.dumps({**common,'object':'chat.completion.chunk','choices':[],'usage':usage})+'\n\ndata: [DONE]\n\n').encode())
        else:
            message = {'role':'assistant','content':None,'tool_calls':[call]} if call else {'role':'assistant','content':content}
            self.wfile.write(json.dumps({**common,'object':'chat.completion','usage':usage,
                'choices':[{'index':0,'message':message,'finish_reason':'tool_calls' if call else 'stop'}]}).encode())


async def probe(args):
    out=Path(args.out)
    if not out.is_absolute() or out.exists() or not Path(args.program).is_absolute():
        raise ValueError('Use absolute program and a new absolute output directory')
    out.mkdir(parents=True,mode=0o700)
    home=out/'home'; native=home/'.commandcode'; workspace=out/'workspace'
    workspace.mkdir(mode=0o700)
    (workspace/'read-source.txt').write_text('READ_CONTROL\n')
    marker='MEMORY_'+uuid.uuid4().hex
    bootstrap='SYSTEM_'+uuid.uuid4().hex
    source=Path(args.auth_file)
    original=hashlib.sha256(source.read_bytes()).hexdigest()
    env={k:v for k,v in os.environ.items() if k in ['PATH','SHELL','TMPDIR','LANG']}
    env.update(HOME=str(home),DO_NOT_TRACK='1',COMMANDCODE_SKIP_UPDATES='1',CMD_LOCAL_ONLY='1',
        MODEL_PROBE_KEY_A='synthetic-a',MODEL_PROBE_KEY_B='synthetic-b',HEADLESS_PROBE_BOOTSTRAP=bootstrap)
    server=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    Provider.records=[];Provider.marker=marker;Provider.bootstrap=bootstrap;Provider.workspace=workspace
    models={'model-a':{'name':'Model A','contextWindow':128000,'maxOutput':1024},
            'vendor/shared':{'name':'Nested shared','contextWindow':128000,'maxOutput':1024}}
    put(native/'providers.json',{'provider':{f'rovai-{n}':{'name':f'Provider {n}',
        'baseURL':f'http://127.0.0.1:{server.server_port}/{n}/v1','api':'openai-completions',
        'apiKey':f'$MODEL_PROBE_KEY_{n.upper()}','models':models} for n in ['a','b']}})
    put(native/'config.json',{'model':'rovai-a/model-a','localOnly':True})
    put(native/'settings.json',{})
    (native/'auth.json').symlink_to(source)
    mod=out/'probe.mjs';mod.write_text(MOD);mod.chmod(0o600)
    command=([args.node,args.program] if args.program.endswith('.mjs') else [args.program])
    catalog=subprocess.run([*command,'--no-auto-update','--list-models'],cwd=workspace,env=env,capture_output=True,text=True,timeout=30)
    listing=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',catalog.stdout)
    (out/'catalog.txt').write_text(listing)
    summary={'program':args.program,'syntheticProvider':True,'noHistoryFilesReadOrWritten':True,
        'catalogExitCode':catalog.returncode,'catalogCustomIds':sorted(set(re.findall(r'(?m)^\s*(rovai-[ab]/\S+)',listing))),
        'cases':[],'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}

    async def run(label,model=None,session=None,scenario='text',flags=(),policy='allow',cancel=False,decision=None):
        case_root=out/label;case_root.mkdir(mode=0o700)
        Provider.label=label;Provider.scenario=scenario;Provider.call=0
        before=len(Provider.records);frames=[];start=time.monotonic()
        launch=[*command,'--no-auto-update','--skip-onboarding','--print','--output-format','json',
            '--max-turns','4','--mod',str(mod),*flags]
        if model:launch+=['--model',model]
        if session:launch+=['--resume',session]
        process=await asyncio.create_subprocess_exec(*launch,cwd=workspace,
            env={**env,'HEADLESS_PROBE_ROOT':str(case_root),'HEADLESS_PROBE_POLICY':policy},
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,
            start_new_session=True,limit=8*1024*1024)
        process.stdin.write((f'INPUT_{label}: '+(f'Remember {marker}.' if label=='first_a' else 'Continue the same conversation.')+'\n').encode())
        await process.stdin.drain();process.stdin.close()
        async def reader():
            while line:=await process.stdout.readline():
                try:frame=json.loads(line)
                except ValueError:continue
                # Do not persist run_end.nextState or private text/thinking.
                if frame.get('type')=='result':
                    frames.append({k:frame[k] for k in ['type','subtype','sessionId','stopReason','usage','durationMs','error'] if k in frame})
                elif frame.get('type')=='event':
                    event=frame.get('event',{});kind=event.get('type')
                    if kind not in ['run_end','text_delta','message_end']:
                        frames.append({k:event[k] for k in ['type','sessionId','toolCallId','toolName','model','stopReason'] if k in event})
        task=asyncio.create_task(reader());stderr_task=asyncio.create_task(process.stderr.read())
        target=workspace/f'{label}.txt';held=None;cancelled=False;child_pid=None
        try:
            if decision is not None or cancel:
                for _ in range(300):
                    hookfile=case_root/'hooks.jsonl'
                    hooks=[json.loads(x) for x in hookfile.read_text().splitlines()] if hookfile.exists() else []
                    tool=next((h for h in hooks if h.get('kind')=='before_tool'),None)
                    child_file=workspace/'cancel-child.pid'
                    ready=child_file.exists() if cancel else bool(tool)
                    if ready:
                        if cancel:
                            child_pid=int(child_file.read_text())
                            # Only the process group created for this isolated case.
                            os.killpg(process.pid,signal.SIGTERM);cancelled=True
                        else:
                            await asyncio.sleep(.25);held=not target.exists()
                            put(case_root/'decision.json',{'toolCallId':tool['toolCallId'],'sessionId':tool['sessionId'],'allow':decision})
                        break
                    if process.returncode is not None:break
                    await asyncio.sleep(.05)
            await asyncio.wait_for(process.wait(),45)
            await task;stderr=await stderr_task
        finally:
            if process.returncode is None:
                os.killpg(process.pid,signal.SIGKILL);await process.wait()
            if not task.done():task.cancel()
            if not stderr_task.done():stderr_task.cancel()
        hooks=[json.loads(x) for x in (case_root/'hooks.jsonl').read_text().splitlines()] if (case_root/'hooks.jsonl').exists() else []
        result=next((f for f in frames if f.get('type')=='result'),None)
        child_alive=None
        if child_pid:
            for _ in range(100):
                try:os.kill(child_pid,0);child_alive=True
                except ProcessLookupError:child_alive=False;break
                await asyncio.sleep(.05)
        case={'case':label,'requestedModel':model,'resume':session,'flags':list(flags),'exitCode':process.returncode,
            'durationMs':round((time.monotonic()-start)*1000),'pid':process.pid,'result':result,
            'requests':Provider.records[before:],'events':frames,'hooks':hooks,
            'fileCreated':target.exists(),'heldBeforeDecision':held,'cancelSent':cancelled,
            'observedToolChildPid':child_pid,'toolChildAliveAfterCancel':child_alive,
            'unknownModelStderr':bool(re.search(rb'unknown model|invalid model|model.*not found',stderr,re.I)),
            'stderrBytes':len(stderr),'stderrSha256':hashlib.sha256(stderr).hexdigest()}
        (case_root/'private-stderr.txt').write_bytes(stderr)
        (case_root/'private-stderr.txt').chmod(0o600)
        summary['cases'].append(case);put(out/'summary.json',summary)
        print(json.dumps({'case':label,'exitCode':process.returncode,'sessionId':(result or {}).get('sessionId'),
            'requests':len(case['requests']),'fileCreated':target.exists(),'hooks':len(hooks),'cancelSent':cancelled}),flush=True)
        return (result or {}).get('sessionId')

    try:
        session=await run('first_a','rovai-a/model-a')
        if not session:raise RuntimeError('Native first run did not return a Session ID; inspect the sanitized summary')
        await run('resume_b','rovai-b/vendor/shared',session)
        await run('resume_a','rovai-a/model-a',session)
        await run('invalid','rovai-missing/not-configured',session)
        await run('after_invalid','rovai-a/model-a',session)
        await run('saved_b','rovai-b/vendor/shared',session)
        await run('default_resume',session=session)
        if args.routing_only:
            summary['authSourceUnchanged']=hashlib.sha256(source.read_bytes()).hexdigest()==original
            put(out/'summary.json',summary)
            return
        await run('read_denied',session=session,scenario='read',policy='deny')
        # Explicitly full-permission fixtures only; never a default for ordinary runs.
        await run('write_full',session=session,scenario='write',flags=['--yolo'])
        put(native/'settings.json',{'permissions':{'defaultMode':'dont-ask','allow':['Write(*)','Edit(*)','Shell(*)']}})
        await run('write_preapproved',session=session,scenario='write',flags=['--permission-mode','dont-ask'])
        put(native/'settings.json',{})
        await run('write_wait_allow',session=session,scenario='write',flags=['--yolo'],policy='wait',decision=True)
        await run('write_wait_deny',session=session,scenario='write',flags=['--yolo'],policy='wait',decision=False)
        await run('cancel_shell',session=session,scenario='shell',flags=['--yolo'],cancel=True)
        await run('after_cancel','rovai-a/model-a',session)
        summary['authSourceUnchanged']=hashlib.sha256(source.read_bytes()).hexdigest()==original
        put(out/'summary.json',summary)
    finally:
        server.shutdown();server.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--program',required=True)
    parser.add_argument('--auth-file',required=True)
    parser.add_argument('--out',required=True)
    parser.add_argument('--node',default='node')
    parser.add_argument('--routing-only',action='store_true')
    asyncio.run(probe(parser.parse_args()))
