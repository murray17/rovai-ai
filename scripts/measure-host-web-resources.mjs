import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchHost, within } from './lib/host-test-client.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'
// Manual, deterministic resource workload. Timings are observations, never a gate.
// --legacy-json measures the pre-binary-response Host using the same input.
const root=resolve(import.meta.dirname, '..')
const legacy=process.argv.includes('--legacy-json')
const fixture=await realpath(await mkdtemp(join(tmpdir(),'rovai-resource-perf-')))
const data=join(fixture,'core'), workspace=join(fixture,'workspace')
await mkdir(workspace)
console.log(JSON.stringify({channel:'automatic_acceptance',dataDir:data,skillLibraryRoot:join(data,'skills'),mcpConfigPath:join(data,'mcp.json'),runtime:false}))
const host=launchHost(process.env.ROVAI_HOST_BIN ?? join(root,'target/debug',process.platform==='win32'?'rovai-host.exe':'rovai-host'),[...coreDataDirectoryArguments(data),'--skill-library-root',join(data,'skills'),'--mcp-config-path',join(data,'mcp.json')],{cwd:root})
try {
 await within(host.ready)
 const members=await host.request('members.list')
 const validated=await host.request('workspaces.validate',{path:workspace})
 const camp=await host.request('camps.create',{commandId:crypto.randomUUID(),name:'Resource measurement',workspace:validated,memberAgentIds:[members[0].agentId],defaultLeadAgentId:members[0].agentId,collaborationMode:'peer'})
 const service=await host.request('host.web.start',{listen:'127.0.0.1:0',uiDirectory:process.env.ROVAI_WEB_UI ?? join(root,'out/web')})
 const auth=await fetch(service.origin+'/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocolVersion:3,administratorToken:service.administratorToken})}).then(r=>r.json())
 const call=async (action,request,binary=false)=>{
   const r=await fetch(service.origin+'/api/v1/files'+(binary?'/bytes':''),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify({action,request})})
   assert.equal(r.status,200);return r
 }
 const bytes=Buffer.alloc(20*1024*1024,97);for(let i=4095;i<bytes.length;i+=4096)bytes[i]=10
 await writeFile(join(workspace,'large.txt'),bytes)
 const start=performance.now()
 const opened=await (await call('open',{kind:'camp_workspace',threadId:camp.payload.threadId,rawReference:'large.txt'})).json()
 assert.equal(opened.ok,true,JSON.stringify(opened))
 const file=opened.value.file,request={handleId:file.handleId,expectedGeneration:file.contentGeneration}
 const openMs=performance.now()-start
 const begin=performance.now(); let offset=0,pages=0
 do {
   const result=await(await call('readPage',{...request,offset})).json(); assert.equal(result.ok,true)
   assert.equal(result.value.startLine,Math.floor(offset/4096)+1)
   assert.equal(result.value.text,bytes.subarray(offset,result.value.endOffset).toString())
   offset=result.value.endOffset;pages++
 }while(offset<bytes.length)
 const pageMs=performance.now()-begin
 const download=await call('download',request,!legacy)
 const payload=Buffer.from(await download.arrayBuffer())
 if(!legacy)assert.deepEqual(payload,bytes)
 else assert.deepEqual(Buffer.from(JSON.parse(payload).value.base64,'base64'),bytes)
 const result={build:!legacy?'after':'before',bytes:bytes.length,pages,openMs,pageMs,downloadPayloadBytes:payload.length}
 console.log(JSON.stringify(result))
 if(!legacy)assert.equal(payload.length,bytes.length,'binary downloads must have no Base64 expansion')
}finally{await host.close();await removeEphemeralRuntimeCampFilesRoot(data);await rm(fixture,{recursive:true,force:true})}
