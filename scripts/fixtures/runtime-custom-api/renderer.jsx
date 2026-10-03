import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ThreadClientProvider } from '@renderer/camp-client'
import { RuntimeStartupSettings } from '@renderer/RuntimeStartupSettings'
import { editableSnapshot, configurationFromSnapshot, snapshotValue, withSnapshotValue } from '@renderer/runtime-connection-editor'
import '@renderer/styles.css'
import '@renderer/member-editor.css'

const clone = value => structuredClone(value)
const settings = kind => ({runtimeKind:kind,revision:0,nativeRevision:'native-0',connectionReadError:null,reconnectRequired:false,nativeWritten:false,
  credential:{status:'available',source:'environment_reference',sourceLabel:'RELAY_KEY',version:'key-1',sourceWritable:false,canReplace:true,canClear:true,restriction:null,remedy:null},
  connectionObservation:{initialMode:'custom_api',loginStatus:'signed_in',conflict:null},
  configuration:{programPath:null,environment:[],customApi:kind==='codex-cli'?{kind,mode:'custom_api',baseUrl:'https://relay.example/prefix',models:[{rowId:'one',id:'model-a',displayName:'开发模型'},{rowId:'two',id:'model-b',displayName:''}],defaultModel:'model-a',defaultRowId:'one'}:{kind,mode:'custom_api',baseUrl:'https://relay.example/prefix',models:{model:'claude-main',reasoningModel:'think',haikuModel:'small',sonnetModel:'medium',opusModel:'large'}}}})
const state={startup:Object.fromEntries(['claude-code-cli','codex-cli'].map(kind=>[kind,settings(kind)])),failure:null}
const requests=[]
const client={platform:'darwin',selectRuntimeExecutable:async()=>null,request:async(method,params={})=>{
  requests.push({method,params:clone(params)})
  if(state.failure===method){state.failure=null;throw Error('隔离测试：读取或保存失败，草稿保留。')}
  const saved=state.startup[params.runtimeKind]
  if(method==='runtime.startup.get')return clone(saved)
  if(method==='runtime.startup.save'){
    let current=editableSnapshot(saved.configuration);current.credentialVersion=saved.credential.version
    const conflicts=params.edits.filter(edit=>JSON.stringify(snapshotValue(current,edit.path))!==JSON.stringify(edit.before)&&JSON.stringify(snapshotValue(current,edit.path))!==JSON.stringify(edit.after)).map(edit=>({...edit,current:snapshotValue(current,edit.path)}))
    if(conflicts.length)return {status:'conflict',latest:clone(saved),conflicts}
    for(const edit of params.edits)current=withSnapshotValue(current,edit.path,edit.after)
    saved.configuration=configurationFromSnapshot(saved.configuration,current)
    if(params.apiKey.action!=='keep'){saved.credential.version+='-next';saved.credential.status=params.apiKey.action==='clear'?'missing':'available'}
    saved.revision++;saved.reconnectRequired=true;saved.nativeWritten=params.edits.some(edit=>!['environment','programPath','mode'].includes(edit.path[0]))
    return clone(saved)
  }
  if(method==='runtime.startup.inspect')return{status:'recognized',executablePath:'/fixture/runtime',reportedVersion:'fixture'}
  throw Error('Unexpected request: '+method)
}}
let navigate
function App(){const[kind,setKind]=useState(null);navigate=(kind=null)=>setKind(kind);return <ThreadClientProvider client={client}><main className="content settings-content" style={{height:'100vh'}}><section className="settings-workbench"><div className="settings-panel">{kind?<RuntimeStartupSettings key={kind} runtimeKind={kind} health={null} onBack={()=>setKind(null)} onReload={async()=>{}}/>:<div>{Object.entries({'claude-code-cli':'Claude Code','codex-cli':'Codex'}).map(([kind,label])=><button key={kind} onClick={()=>setKind(kind)}>{label}</button>)}</div>}</div></section></main></ThreadClientProvider>}
window.settingsTest={state,requests,navigate:(...args)=>navigate(...args),settle:()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,25))))}
document.documentElement.dataset.theme='day'
createRoot(document.getElementById('root')).render(<App/> )
