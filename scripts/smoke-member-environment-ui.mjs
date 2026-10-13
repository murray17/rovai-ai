// Production components with a private transport fixture; no Core, CLI or account access.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '..')
const fixture = await mkdtemp(join(tmpdir(), 'rovai-member-session-ui-'))
const src = join(root, '.local', 'member-session-ui-acceptance')
const source = path => JSON.stringify(join(root, 'apps/desktop/src/renderer/src', path))
await mkdir(src, { recursive: true })
await writeFile(join(src, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>')
await writeFile(join(src, 'fixture.jsx'), `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import ${source('styles.css')};
import {MemberEnvironmentEditor,useMemberEnvironment} from ${source('MemberEnvironmentEditor.tsx')};
import {MemberSessionReset} from ${source('MemberSessionReset.tsx')};
import {ThreadClientProvider} from ${source('camp-client.tsx')};
import {changeInterfaceLanguage} from ${source('interface-language.ts')};
let scenario='normal', calls=[], notice='', revision=1;
let values={ANTHROPIC_BASE_URL:'https://fixture.example',ANTHROPIC_API_KEY:'<saved>'};
const client={platform:'darwin',onEvent:()=>()=>{},request:async(method,p)=>{
  calls.push({method,...p});
  if(method==='member.runtimeEnvironment.get')return {revision,environment:values};
  if(method==='conversations.memberSession.get')return {conversationId:'camp-member-session',version:7,active:scenario==='active'};
  if(method==='conversations.restartNativeSession')return scenario==='conflict'?{status:'rejected',code:'conversation.version_conflict'}:{status:'applied'};
  throw Error(method);
}};
function Editor(){
 const [open,setOpen]=useState(false),[version,setVersion]=useState(1);
 const env=useMemberEnvironment('member-a','claude-code-cli',version,undefined,false);
 window.fixture={calls,scenario:v=>scenario=v,language:language=>changeInterfaceLanguage({setInterfaceLanguage:async value=>({interfaceLanguage:value})},language),notice:()=>notice,update:env.update};
 return <main style={{maxWidth:560,padding:20,margin:'0 auto'}}>
  <MemberEnvironmentEditor environment={env} disabled={false}/>
  <button data-save onClick={async()=>{const edit=env.edit();if(edit){values=JSON.parse(edit.json);revision++;setVersion(v=>v+1);await env.savedSuccessfully()}}}>Save</button>
  <button data-reset onClick={()=>setOpen(true)}>Reset</button>
  {open&&<MemberSessionReset campId="camp-a" member={{agentId:'member-a',displayName:'Alice'}} onClose={()=>setOpen(false)} onNotify={text=>notice=text}/>}
 </main>
}
createRoot(document.getElementById('root')).render(<ThreadClientProvider client={client}><Editor/></ThreadClientProvider>);
`)
await writeFile(join(fixture, 'main.cjs'), `
const assert=require('node:assert/strict'),{mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path'),{app,BrowserWindow}=require('electron');
const root=${JSON.stringify(fixture)},data=join(root,'user-data');mkdirSync(data,{recursive:true});mkdirSync(join(data,'managed-skill-library'));
app.setPath('userData',data);app.setPath('sessionData',join(data,'session'));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1040,height:800,useContentSize:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
 const run=s=>w.webContents.executeJavaScript(s,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async s=>{for(let i=0;i<150;i++){if(await run(s))return;await sleep(30)}throw Error('Timed out '+s+' '+await run('document.body.innerText'))};
 const click=async s=>{await run('document.querySelector('+JSON.stringify(s)+').click()');await sleep(60)};
 await w.loadFile(join(root,'renderer/index.html'));await wait('!!window.fixture && !document.querySelector("textarea").disabled');
 await click('summary');
 assert.equal(await run('document.body.innerText.includes("环境变量在智能体进程启动时读取")'),false);
 assert.equal(await run('document.querySelectorAll("input[type=checkbox]").length'),0);
 assert.equal(await run('document.querySelector("textarea").getBoundingClientRect().height'),104);
 await run('document.querySelector("textarea").focus()');
 assert.equal(await run('getComputedStyle(document.querySelector("textarea")).boxShadow'),'none');
 await run('window.fixture.update(JSON.stringify({ANTHROPIC_BASE_URL:"https://changed.example",ANTHROPIC_API_KEY:"<saved>"},null,2))');await sleep(60);await click('[data-save]');
 await wait('document.body.innerText.includes("已保存")');
 assert.equal(await run('document.querySelectorAll("[role=alert]").length'),0);
 await click('[data-reset]');await wait('!!document.querySelector("[role=dialog]") && !document.querySelector(".danger-button").disabled');
 await click('.danger-button');await wait('!document.querySelector("[role=dialog]")');
 const call=await run('window.fixture.calls.find(c=>c.method==="conversations.restartNativeSession")');
 assert.equal(call.command.conversationId,'camp-member-session');assert.equal(call.command.expectedVersion,7);
 assert.ok(await run('window.fixture.notice().includes("已重置")'));
 await run('window.fixture.scenario("active")');await click('[data-reset]');await wait('document.body.innerText.includes("队员正在执行任务")');
 assert.ok(await run('document.querySelector(".danger-button").disabled'));await click('[role=dialog] .quiet-button');
 await run('window.fixture.scenario("conflict")');await click('[data-reset]');await wait('!document.querySelector(".danger-button").disabled');await click('.danger-button');
 await wait('document.body.innerText.includes("会话已发生变化")');await click('[role=dialog] .quiet-button');
 w.setContentSize(390,844);await run('window.fixture.language("en")');await sleep(200);
 assert.equal(await run('document.body.innerText.includes("Saving does not affect running processes")'),false);
 assert.equal(await run('getComputedStyle(document.querySelector("textarea")).fontSize'),'16px');
 assert.ok(await run('document.documentElement.scrollWidth<=innerWidth'));
 writeFileSync(join(root,'mobile-en.png'),(await w.webContents.capturePage()).toPNG());
 await run('window.fixture.scenario("normal")');await click('[data-reset]');await wait('!!document.querySelector("[role=dialog]")');
 assert.ok(await run('document.body.innerText.includes("Reset Alice")'));
 assert.ok(await run('document.documentElement.scrollWidth<=innerWidth'));
 writeFileSync(join(root,'mobile-reset-en.png'),(await w.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({ok:true,checks:['saved-marker','no-combination-confirmation','no-process-start-timing-copy','reset-exact-conversation-version','active-work-block','conflict-retains-dialog','mobile-english','no-overflow','short-editor-no-focus-ring']}));app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
`)
let child, closed, passed = false
try {
  await build({ configFile: false, root: src, base: './', logLevel: 'error', plugins: [react()],
    build: { outDir: join(fixture, 'renderer'), emptyOutDir: true } })
  console.log(`Automatic acceptance: userData=${join(fixture, 'user-data')}; skills=${join(fixture, 'user-data/managed-skill-library')}; no Core/Runtime`)
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
  child = spawn(electron, [join(fixture, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  closed = once(child, 'close')
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk)
  const timer = setTimeout(() => child.kill('SIGTERM'), 45_000)
  let code; try { [code] = await closed } finally { clearTimeout(timer) }
  assert.equal(code, 0, output); console.log(output.split('\n').filter(line => line.startsWith('{')).join('\n')); passed = true
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed }
  await rm(src, { recursive: true, force: true })
  if (passed && !process.env.ROVAI_KEEP_MEMBER_ENV_UI) await rm(fixture, { recursive: true, force: true })
  else console.log(`UI evidence: ${fixture}`)
}
