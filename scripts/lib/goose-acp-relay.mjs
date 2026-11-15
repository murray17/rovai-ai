// Acceptance-only relay, prepended with owned fixture paths by the Core smoke.
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {appendFileSync,readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {basename} from 'node:path'

const childEnvironment={...process.env}
const missingDefault=readFileSync(relayControl,'utf8')==='provider'
if(missingDefault)delete childEnvironment.GOOSE_PROVIDER
const child=spawn(officialExecutable,process.argv.slice(2),{env:childEnvironment,stdio:['pipe','pipe','inherit']})
let lock,timer
const delayed=new Map()
const heldDeletes=new Set()
const record=entry=>appendFileSync(relayEvents,JSON.stringify({...entry,at:Date.now(),pid:process.pid,nativePid:child.pid})+'\n')
function release(){
 if(!lock)return
 lock.exec('ROLLBACK');lock.close();lock=null
 record({phase:'lock_released'})
}
createInterface({input:process.stdin}).on('line',line=>{
 let frame;try{frame=JSON.parse(line)}catch{}
 const mode=readFileSync(relayControl,'utf8')
 if(frame?.method==='session/new')record({phase:'session_new',provider:frame.params?._meta?.provider,probe:basename(frame.params?.cwd??'').startsWith('rovai-acp-probe-'),badDefault:missingDefault})
 if(frame?.method==='session/delete'&&mode==='delete_error'){
  record({phase:'probe_delete_refused',sessionId:frame.params.sessionId})
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:frame.id,error:{code:-32603,message:'Controlled probe Session deletion refusal'}})+'\n')
  return
 }
 if(frame?.method==='session/delete'&&mode==='delete_hang')heldDeletes.add(frame.id)
 if(frame?.method==='_goose/unstable/session/extensions/remove'&&readFileSync(relayControl,'utf8')==='delay'){
  if(lock)throw Error('The controlled late-removal case expects exactly one stale extension')
  lock=new DatabaseSync(nativeDatabase)
  lock.exec('PRAGMA busy_timeout=1000');lock.exec('BEGIN IMMEDIATE')
  delayed.set(frame.id,frame.params.extensionKey)
  record({phase:'remove_forwarded',id:frame.id,key:frame.params.extensionKey})
  timer=setTimeout(release,1500)
 }
 child.stdin.write(line+'\n')
})
process.stdin.on('end',()=>child.stdin.end())
createInterface({input:child.stdout}).on('line',line=>{
 let frame;try{frame=JSON.parse(line)}catch{}
 if(frame&&!frame.method&&heldDeletes.delete(frame.id)){
  record({phase:'probe_delete_response_withheld',succeeded:!frame.error})
  return
 }
 if(frame&&!frame.method&&delayed.has(frame.id)){
  record({phase:'remove_result',id:frame.id,key:delayed.get(frame.id),succeeded:!frame.error})
  delayed.delete(frame.id)
 }
 process.stdout.write(line+'\n')
})
await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);release();process.exitCode=code??1;process.stdin.destroy();record({phase:'native_closed',code,signal});resolve()})})
