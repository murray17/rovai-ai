import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

test('Thread fork uses production menus, leave guards and foreground recovery', {timeout:180_000},async t=>{
  if(!admitElectronIntegrationTest(t))return
  const root=resolve(import.meta.dirname,'../..'),source=join(root,'scripts/fixtures/thread-fork')
  const fixture=await mkdtemp(join(tmpdir(),'rovai-thread-fork-')),userData=join(fixture,'user-data'),output=join(fixture,'evidence')
  await mkdir(join(userData,'managed-skill-library'),{recursive:true})
  let child,closed,passed=false
  try{
    await build({configFile:false,root:source,base:'./',logLevel:'error',plugins:[react()],resolve:{alias:{'@contracts':join(root,'packages/contracts/src/index.ts')}},build:{outDir:join(fixture,'renderer'),minify:false}})
    const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
    console.log(`Automatic acceptance userData: ${userData}; Skill Library: ${join(userData,'managed-skill-library')} (unused); no Core/Runtime`)
    child=spawn(electron,[join(source,'main.cjs'),join(fixture,'renderer/index.html'),userData,output,...(process.platform==='linux'?['--no-sandbox']:[])],{env,stdio:['ignore','pipe','pipe']})
    closed=once(child,'close');let log='';child.stdout.on('data',chunk=>{log+=chunk});child.stderr.on('data',chunk=>{log+=chunk})
    const timer=setTimeout(()=>child.kill('SIGKILL'),150_000)
    let code;try{[code]=await closed}finally{clearTimeout(timer)}
    assert.equal(code,0,log);console.log(log.split('\n').filter(line=>line.startsWith('{')).join('\n'));passed=true
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed}
    if(!passed||process.env.ROVAI_KEEP_FORK_FIXTURE==='1')console.log(`Thread fork fixture: ${fixture}`)
    else await rm(fixture,{recursive:true,force:true})
  }
})
