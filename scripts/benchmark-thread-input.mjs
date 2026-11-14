// Offline production-component benchmark. No Core, Runtime, daily profile or credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpus, platform, release, tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'

const root = resolve(import.meta.dirname, '..')
const out = resolve(process.argv[2] ?? 'docs/prototypes/thread-input-performance')
const fixture = await mkdtemp(join(tmpdir(), 'rovai-thread-input-performance-'))
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const appSource = await readFile(join(root, 'apps/desktop/src/renderer/src/BusinessApp.tsx'), 'utf8')
// The fixture proxies only BusinessApp's execution-event ownership, not the whole App.
// Read the production owner to select its existing path; the benchmark source is unchanged across batches.
const legacyIngress = appSource.includes('const [liveRuntimeEvents, setLiveRuntimeEvents]')
const desktop = process.env.ROVAI_PERF_SURFACE === 'desktop'
const samples = Number(process.env.ROVAI_PERF_SAMPLES ?? 80)
const rounds = Number(process.env.ROVAI_PERF_ROUNDS ?? 3)
const counts = (process.env.ROVAI_PERF_COUNTS ?? '20,200,1000').split(',').map(Number)
const loads = (process.env.ROVAI_PERF_LOADS ?? 'idle,current,other').split(',')
const keyInterval = 100, eventInterval = 32
const initCounters = 'window.__inputPerf ??= {workspaceRenders:0,historyRows:0,markdownRenders:0,markdownParses:0};'
const modelExtension = `
clearInterval(streamingTimer);
const perfListeners = new Set();
model.client.onEvent = listener => { perfListeners.add(listener); return () => perfListeners.delete(listener) };
window.__inputPerfModel = {
 load(count) {
   halt(); timers.forEach(clearTimeout); timers.clear(); streams.clear();
   const id = 'input-performance-' + count + '-' + Date.now();
   const text = '会话输入与执行进展核对。\\n\\n- 保留草稿和选区\\n- 保留消息顺序\\n\\n| 项目 | 状态 |\\n| --- | --- |\\n| 草稿 | 已保存 |\\n\\n~~~ts\\nconst sample = { count: 42, active: true };\\nconsole.log(sample);\\n~~~';
   const messages = Array.from({length:count}, (_,i)=>makeMessage('perf-message-'+i,i+1,text,i%2 ? 0 : -1));
   const run = {...makeRun('perf-current-run',0,'running',[messages.at(-2).id]),executionEvidenceCount:0,executionEvidenceChangeSequence:0,anchorMessageId:messages.at(-2).id,publicTailSequenceAtStart:count-2};
   update({generation:state.generation+1,snapshot:{...state.snapshot,thread:{...state.snapshot.thread,id},messages,agentRuns:[run],turns:[],tasks:[],executionEvidence:[],messageDeliveries:[],agentRunFileChanges:[],agentRunImages:[],memberCreations:[]},draft:{...state.draft,threadId:id,body:'',content:{version:2,segments:[]},quotes:[],attachments:[],replyIntent:null,continuationIntent:null}});
 },
 emit(sequence,other,planned) {
   window.__inputPerf.received.push({sequence,lag:Date.now()-planned});
   const event={method:'agent.text.block',params:{threadId:other?'other-performance-thread':state.snapshot.thread.id,agentRunId:other?'perf-other-run':'perf-current-run',executionEpoch:1,evidenceId:'perf-text',sequence:1,revision:sequence,changeSequence:sequence,payload:{blockId:'perf-text',status:'streaming',text:'已处理第 '+sequence+' 批测试内容。',delta:'已处理第 '+sequence+' 批测试内容。',textLength:30}}};
   for(const listener of perfListeners) listener(event);
 },
 legacySubscribe(listener) { perfListeners.add(listener); return ()=>perfListeners.delete(listener) }
};
`
const workbenchExtension = `
 const [perfLiveEvents, setPerfLiveEvents] = useState([]);
 useEffect(()=>{
   if(!${legacyIngress}) return;
   const buffer=perfCreateBuffer(batch=>setPerfLiveEvents(current=>perfAppend(current,batch)));
   const stop=window.__inputPerfModel.legacySubscribe(event=>{const value=perfFromCore(event,'perf-live');if(value)buffer.push(value)});
   return ()=>{stop();buffer.dispose()};
 },[]);
`
let browser
const results = []
try {
 await mkdir(out,{recursive:true})
 const built=await build({configFile:false,root:join(root,'scripts/fixtures/run-presence'),base:'./',logLevel:'error',
   plugins:[{name:'thread-input-performance',enforce:'pre',transform(code,id){
     if(id.endsWith('/ThreadWorkspace.tsx')) return code.replace('  const taskCapability = useTaskCapability()',initCounters+'window.__inputPerf.workspaceRenders++;\n  const taskCapability = useTaskCapability()').replace('const timelineItem = presenceTimeline[timelineIndex]','window.__inputPerf.historyRows++; const timelineItem = presenceTimeline[timelineIndex]');
     if(id.endsWith('/SafeMarkdown.tsx')) return code.replace('  const rootRef = useRef<HTMLDivElement>(null)',initCounters+'window.__inputPerf.markdownRenders++;\n  const rootRef = useRef<HTMLDivElement>(null)');
     if(id.includes('/react-markdown/')&&id.endsWith('/lib/index.js')) return code.replaceAll('processor.parse(file)','(window.__inputPerf.markdownParses++,processor.parse(file))');
     if(id.endsWith('/run-presence/model.ts')) return code+modelExtension;
     if(id.endsWith('/run-presence/renderer.tsx')) return `import {appendLiveRuntimeEventBatch as perfAppend,createLiveRuntimeEventBuffer as perfCreateBuffer} from '../../../apps/desktop/src/renderer/src/live-runtime-event-buffer';\nimport {liveRuntimeEventFromCore as perfFromCore} from '../../../apps/desktop/src/renderer/src/ui-model';\n`+code.replace('function Workbench() {','function Workbench() {'+workbenchExtension).replace('liveRuntimeEvents={model.controls.liveEvidence ? visibleSnapshot.executionEvidence.map(liveRuntimeEventFromExecutionEvidence) : undefined}','liveRuntimeEvents={perfLiveEvents}');
   }},react()],resolve:{alias:{'@contracts':join(root,'packages/contracts/src/index.ts')}},define:{__SOURCE_COMMIT__:JSON.stringify(sourceCommit)},
   build:{write:false,minify:true,assetsInlineLimit:Number.MAX_SAFE_INTEGER,cssCodeSplit:false,rollupOptions:{output:{inlineDynamicImports:true}}}})
 const bundle=(Array.isArray(built)?built[0]:built).output
 const js=bundle.filter(x=>x.type==='chunk').map(x=>x.code).join('\n')
 const css=bundle.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n')
 const html=join(fixture,'benchmark.html')
 await writeFile(html,`<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>${initCounters}</script><script type="module">${js.replaceAll('</script','<\\/script')}</script></body></html>`)
 let executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args=['--headless=new','--user-data-dir='+join(fixture,'profile')]
 if(desktop){
   executable=electron
   const main=join(fixture,'main.cjs')
   await writeFile(main,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(fixture,'user-data'))});app.setPath('sessionData',${JSON.stringify(join(fixture,'session-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1440,height:920,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});w.loadURL('about:blank')});`)
   args=[main]
 }
 args.push('--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',...(platform()==='linux'?['--no-sandbox']:[]),'about:blank')
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 browser=await launchAcceptanceBrowser({executable,args,env})
 await browser.send('Emulation.setFocusEmulationEnabled',{enabled:true})
 await browser.send('Page.navigate',{url:pathToFileURL(html).href+'?pure=1'})
 await browser.wait('!!window.__inputPerfModel && !!document.querySelector("[contenteditable=true]")')
 const version=await browser.send('Browser.getVersion')
 await browser.evaluate(`
 window.__perfKeys=[];window.__perfEvents=[];window.__perfLongTasks=[];
 new PerformanceObserver(list=>window.__perfLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
 new PerformanceObserver(list=>window.__perfEvents.push(...list.getEntries().filter(e=>e.name==='keydown').map(e=>({start:e.startTime,duration:e.duration,inputDelay:e.processingStart-e.startTime,processing:e.processingEnd-e.processingStart,interactionId:e.interactionId})))).observe({type:'event',durationThreshold:16});
 document.addEventListener('keydown',e=>{if(e.key!=='a')return;const sample={start:e.timeStamp};window.__perfKeys.push(sample);performance.mark('perf-key-'+window.__perfKeys.length);requestAnimationFrame(()=>setTimeout(()=>{sample.afterFrameTaskMs=performance.now()-sample.start},0))},true);
 true`)
 const percentile=(values,p)=>values.length?values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null
 for(const count of counts) for(const load of loads) for(let round=0;round<rounds;round++){
   console.log(JSON.stringify({phase:'sampling',count,load,round:round+1,samples,surface:desktop?'desktop-electron':'web-chrome'}))
   await browser.evaluate(`window.__inputPerfModel.load(${count});true`)
   await browser.wait('!!document.querySelector("[contenteditable=true]")')
   await pause(700)
   await browser.click('document.querySelector("[contenteditable=true]")')
   await browser.send('Input.insertText',{text:'x'})
   await pause(500)
   await browser.evaluate('Object.assign(window.__inputPerf,{workspaceRenders:0,historyRows:0,markdownRenders:0,markdownParses:0,received:[]});window.__perfKeys=[];window.__perfEvents=[];window.__perfLongTasks=[];true')
   let trace
   if(process.env.ROVAI_PERF_TRACE==='1'&&count===1000&&load==='current'&&round===0){
     const entries=[]
     const complete=new Promise(resolve=>{const stop=browser.onProtocolEvent(event=>{if(event.method==='Tracing.dataCollected')entries.push(...event.params.value);if(event.method==='Tracing.tracingComplete'){stop();resolve(entries)}})})
     await browser.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,latencyInfo,disabled-by-default-devtools.screenshot',transferMode:'ReportEvents'})
     trace=complete
   }
   const origin=Date.now()+150,pending=[]
   const schedule=(at,action)=>new Promise(resolve=>setTimeout(()=>{pending.push(Promise.resolve().then(action));resolve()},Math.max(0,at-Date.now())))
   const scheduled=[]
   for(let i=0;i<samples;i++)scheduled.push(schedule(origin+i*keyInterval,()=>browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,text:'a',timestamp:(origin+i*keyInterval)/1000})))
   if(load!=='idle')for(let i=0;i<Math.ceil(samples*keyInterval/eventInterval);i++)scheduled.push(schedule(origin+i*eventInterval,()=>browser.evaluate(`window.__inputPerfModel.emit(${i+1},${load==='other'},${origin+i*eventInterval});true`)))
   await Promise.all(scheduled)
   await Promise.all(pending)
   await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65})
   await pause(800)
   if(trace){await browser.send('Tracing.end');await writeFile(join(out,'calibration.trace.json'),JSON.stringify({traceEvents:await trace}))}
   const raw=await browser.evaluate(`({...window.__inputPerf,keys:window.__perfKeys,eventTiming:window.__perfEvents,longTasks:window.__perfLongTasks,mountedMessages:document.querySelectorAll('.timeline-track [data-message-id]').length,elements:document.getElementsByTagName('*').length,text:document.querySelector('[contenteditable=true]').textContent,activity:document.querySelector('.run-presence-preview')?.textContent})`)
   assert.equal(raw.keys.length,samples,'all scheduled key events must arrive')
   assert.equal(raw.text,'x'+'a'.repeat(samples),'all input characters must survive')
   if(load==='current')assert.match(raw.activity,/已处理第/,'the measured active region must update')
   const timings=raw.keys.map(key=>raw.eventTiming.find(e=>Math.abs(e.start-key.start)<2)?.duration??0)
   const eventStats=Object.fromEntries([['p50',.5],['p95',.95],['p99',.99]].map(([name,p])=>[name,percentile(timings,p)||'<16ms']))
   const proxies=raw.keys.map(k=>k.afterFrameTaskMs).filter(Number.isFinite)
   const result={count,load,round:round+1,samples,durationMs:Date.now()-origin,eventTimingMs:eventStats,eventTimingReported:raw.eventTiming.length,afterFrameTaskApproxMs:{p50:percentile(proxies,.5),p95:percentile(proxies,.95),p99:percentile(proxies,.99)},eventArrivalLagMs:{p50:percentile(raw.received.map(x=>x.lag),.5),p95:percentile(raw.received.map(x=>x.lag),.95)},...raw}
   delete result.text
   results.push(result)
   await writeFile(join(out,'results.json'),JSON.stringify({sourceCommit,legacyIngress,surface:desktop?'desktop-electron':'web-chrome',build:'Vite production minified; production renderer components; fixture proxy of BusinessApp execution ingress',machine:{cpu:cpus()[0].model,platform:platform(),release:release()},browser:version,keyIntervalMs:keyInterval,eventIntervalMs:eventInterval,measurement:'EventTiming keydown to next rendering completion, rounded to 8ms; below 16ms reported as censored. afterFrameTask is a separate approximate proxy, not actual presentation. Timestamped CDP injection includes queued input time. No real OS IME. Small samples do not establish stable p99.',results,errors:browser.errors},null,2))
   console.log(JSON.stringify({count,load,round:round+1,eventTimingMs:eventStats,approx:result.afterFrameTaskApproxMs,workspaceRenders:raw.workspaceRenders,historyRows:raw.historyRows,markdownParses:raw.markdownParses,mountedMessages:raw.mountedMessages,longTasks:raw.longTasks.length}))
 }
 assert.deepEqual(browser.errors,[])
 console.log(JSON.stringify({phase:'complete',out,sourceCommit}))
}finally{await browser?.close();await rm(fixture,{recursive:true,force:true})}
