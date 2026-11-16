import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BusinessApp } from '../../../apps/desktop/src/renderer/src/BusinessApp'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { createReviewModel } from '../host-web-parity/model'
import { initial, agents, installations, message, navigation, now, availability } from '../host-web-parity/data'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import { EMPTY_SNAPSHOT } from '../../../apps/desktop/src/shared/navigation-preferences-model'
import { AppToast, type AppToastValue } from '../../../apps/desktop/src/renderer/src/AppToast'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import { applyAppearanceSnapshot } from '../../../apps/desktop/src/renderer/src/theme'
import { changeInterfaceLanguage, uiAttribute } from '../../../apps/desktop/src/renderer/src/interface-language'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

// Deterministic transport for the real BusinessApp, menus, Composer and export.
// Core SQL/atomicity has a separate production database owner; no Runtime starts.
const model = createReviewModel('web', 'camp')
const calls: Array<{ method: string; params: any }> = []
const events = new Set<(event: any) => void>()
const saved = JSON.parse(localStorage.getItem('fork-fixture') ?? 'null')
const threads = new Map<string, any>(saved?.threads ?? [])
const receipts = new Map<string, any>(saved?.receipts ?? [])
let sequence = saved?.sequence ?? 10
const appearance = { ...DEFAULT_APPEARANCE, preference: 'day', resolvedTheme: 'day' } as const
applyAppearanceSnapshot(document.documentElement, appearance)
const prefs = { ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguagePreference: 'zh-CN', interfaceLanguage: 'zh-CN', newConversationDefaults: null }
const navPrefs = { ...EMPTY_SNAPSHOT, legacyProjectsSynced: true }
const applied = (payload = {}) => ({ commandId:'fixture',commandType:'camp.fork',status:'applied',code:'camp.forked',payload,resultEntity:null,recordedAt:now })
function seed(id: string, title: string) {
  const value = structuredClone(initial)
  Object.assign(value.thread,{id,title,activationState:'active',projectBindingKind:'quick_chat',projectPath:'/fixture'})
  Object.assign(value,{messages:[message(1,'用户先前消息','user'),message(2,'离队队员的已发布回复','agent'),message(3,'队员最后的已发布回复','agent')],
    agentRuns:[],messageDeliveries:[],executionEvidence:[],approvals:[],tasks:[],turns:[]})
  value.messages[1].authorId=agents[1].agentId
  value.messages[2].authorId=agents[1].agentId
  for(const item of value.messages.slice(1)) Object.assign(item,{threadTurnId:'fixture-turn',sourceAgentRunId:'fixture-run'})
  value.messages[1].quotes=[
    {version:1,quoteId:'inside-quote',source:{scope:'camp',campId:id,messageId:value.messages[0].id},authorAtCapture:{type:'agent',agentId:'quote-only-author',displayName:'引用作者快照'},text:'保留在副本中的选文',format:'plain_text',capturedAt:now},
    {version:1,quoteId:'outside-quote',source:{scope:'camp',campId:id,messageId:value.messages[2].id},authorAtCapture:{type:'agent',agentId:'quote-only-author',displayName:'引用作者快照'},text:'范围外仍保留的选文',format:'plain_text',capturedAt:now}
  ]
  value.members[1].membershipStatus='left'
  threads.set(id,value)
}
if (!threads.size) { seed('source','源会话 A');seed('other','另一个会话 B') }
const checkpoint = () => localStorage.setItem('fork-fixture',JSON.stringify({threads:[...threads],receipts:[...receipts],sequence}))
const nav = () => ({schemaVersion:3,throughGlobalSequence:sequence,projects:[],quickChat:{totalCount:threads.size,recentThreads:[...threads.values()].map(value=>navigation(value).quickChat.recentThreads[0])}})
const projection = (value: any) => {
  const coverage=(count:number)=>({totalCount:count,loadedCount:count,omittedCount:0,complete:true})
  return {...structuredClone(value),schemaVersion:9,throughGlobalSequence:sequence,coverage:{tasks:coverage(0),messages:{...coverage(value.messages.length),hasEarlier:false,oldestLoadedSequence:1,newestLoadedSequence:value.messages.length},messageDeliveries:coverage(0),turns:coverage(0),agentRuns:coverage(0),approvals:coverage(0)}}
}
let releaseFork: (()=>void) | undefined
let holdFork = false, loseResponse = false, failOpen = false, dropTarget = false, rejectFork = false
let releaseAttachment:(()=>void)|undefined, attachmentPending=false
const client = {...model.client,composerAttachments:{...model.client.composerAttachments,
  prepare:async(_thread:string,_revision:number,file:File)=>{attachmentPending=true;await new Promise<void>(resolve=>{releaseAttachment=resolve});attachmentPending=false;return {id:crypto.randomUUID(),sourcePath:'/fixture/'+file.name,displayName:file.name,kind:'file',fileCount:1,mediaType:'text/plain',byteSize:file.size,previewKind:'none',availability:'unknown'}},
},reeditScope:'fork-acceptance:host:owner',onInvalidated:undefined,
  onEvent:(fn:any)=>{events.add(fn);return()=>events.delete(fn)},
  request:async(method:string,params:any={})=>{
    calls.push({method,params:structuredClone(params)})
    const command=params.command??params,value=threads.get(command.threadId)
    if(method==='threads.fork') {
      if(rejectFork) {rejectFork=false;return {...applied(),status:'rejected',code:'camp.fork_anchor_unavailable'}}
      if(holdFork) await new Promise<void>(resolve=>{releaseFork=resolve})
      if(receipts.has(params.commandId)) return receipts.get(params.commandId)
      const source=threads.get(params.sourceThreadId),target=structuredClone(source),id=`copy-${++sequence}`
      target.thread.id=id;target.thread.title=source.thread.title+' 副本'
      const anchor=params.sourceMessageId?source.messages.find((m:any)=>m.id===params.sourceMessageId)?.sequence:Infinity
      const copied=target.messages.filter((m:any)=>m.sequence<=anchor)
      const ids=new Map<string,string>(copied.map((m:any)=>[m.id,crypto.randomUUID()]))
      // Controlled API projections for the production UI consumer. The Rust
      // transaction owner separately verifies normalization and copy boundaries.
      target.messages=copied.map((m:any)=>({...m,id:ids.get(m.id),presentation:m.authorType==='agent'?{}:null,
        sourceAgentRunId:null,threadTurnId:null,runtimeModel:null,
        quotes:(m.quotes??[]).map((q:any)=>({...q,source:q.source?.scope==='camp'&&q.source.campId===params.sourceThreadId&&ids.has(q.source.messageId)
          ?{...q.source,campId:id,messageId:ids.get(q.source.messageId)}:undefined}))}))
      threads.set(id,target);const result=applied({threadId:id});receipts.set(params.commandId,result);checkpoint()
      events.forEach(fn=>fn({method:'navigation.invalidated',params:{scope:'group',threadId:id,groupKeys:['quick-chat']}}))
      if(dropTarget) {dropTarget=false;threads.delete(id);checkpoint()}
      if(loseResponse) {loseResponse=false;throw new Error('Lost response')}
      return result
    }
    if(method==='commands.reconcile')return receipts.has(params.params.commandId)?{state:'recorded',result:receipts.get(params.params.commandId)}:{state:'unknown'}
    if(method==='members.list')return agents
    if(method==='runtime.installations.list')return installations
    if(method==='health.check')return {runtimeAvailability:availability,hostPlatform:'darwin',runtimePlatformAdmission:[]}
    if(['memory.hearthReviewItems.list','missions.list','missions.cleanup.list','teams.list'].includes(method))return []
    if(method==='navigation.snapshot')return nav()
    if(method==='navigation.threads')return {throughGlobalSequence:sequence,groupKeys:['quick-chat'],threads:nav().quickChat.recentThreads.filter((t:any)=>params.threadIds.includes(t.id))}
    if(method==='navigation.findThread')return value?navigation(value).quickChat.recentThreads[0]:null
    if(method==='threads.exists')return !!value
    if(method==='threads.open'||method==='threads.enter') {if(failOpen&&command.threadId.startsWith('copy-'))throw new Error('Open failed');return projection(value)}
    if(method==='navigation.threadViewed')return {threadId:command.threadId,lastSeenGlobalSequence:command.throughGlobalSequence,changed:false,navigation:{throughGlobalSequence:sequence,groupKeys:[],threads:[]}}
    if(method==='thread.messages.anchors')return {schemaVersion:1,threadId:command.threadId,throughGlobalSequence:sequence,totalCount:value.messages.filter((m:any)=>m.authorType==='user').length,items:value.messages.filter((m:any)=>m.authorType==='user').map((m:any)=>({messageId:m.id,sequence:m.sequence,title:m.body,messageVersion:m.version}))}
    if(method==='thread.pendingInputs.get')return {threadId:command.threadId,executionActive:false,items:[],editSession:null,submissionOutcomes:[]}
    if(method==='events.subscribe')return {schemaVersion:9,events:[],nextGlobalSequence:sequence,throughGlobalSequence:sequence,resetRequired:false}
    if(method==='notifications.inbox')return {schemaVersion:8,items:[],unreadCount:0,throughChangeSequence:0,nextCursor:null}
    if(method==='notifications.preference.get')return {version:1,updatedAt:now,headsUpEnabled:false}
    if(method==='notifications.changesSince')return {schemaVersion:8,changes:[],nextChangeSequence:0,throughChangeSequence:0,retainedFloorChangeSequence:0,resetRequired:false,hasMore:false}
    if(method==='notifications.acknowledgeVisibleSources')return applied()
    return model.client.request(method as any,params)
  }
}
const preferences:any={appearance:{get:async()=>appearance,onChanged:()=>()=>{}},
  generalPreferences:new Proxy({},{get:(_,key)=>async(...args:any[])=>{if(key==='setInterfaceLanguagePreference')Object.assign(prefs,{interfaceLanguagePreference:args[0],interfaceLanguage:args[0],languageRevision:((prefs as any).languageRevision??0)+1});return prefs}}),
  navigationPreferences:new Proxy({},{get:(_,key)=>key==='onChanged'?()=>()=>{}:async()=>navPrefs})}
const environment:any={client,files:{...model.fileApi,bindThread:async()=>{}},preferences,
  navigationHistory:{initial:{entries:[{kind:'camp',threadId:'source'}],index:0},write:(state:any)=>state,go:async()=>false,listen:()=>()=>{}}}
const nativeSet=Storage.prototype.setItem
let failDraft=false
Storage.prototype.setItem=function(key:string,value:string){if(failDraft&&key.startsWith('rovai.camp-composer-draft'))throw new Error('Draft storage failed');return nativeSet.call(this,key,value)}
const loadingEvents: Array<{ visible: boolean; time: number }> = []
let previousLoading = false
new MutationObserver(() => {
  const visible = !!document.querySelector('.app-toast-spinner')
  if (visible !== previousLoading) { previousLoading = visible; loadingEvents.push({ visible, time: performance.now() }) }
}).observe(document.body, { childList: true, subtree: true })
// Independent real AppToast instances exercise portal ownership and StrictMode cleanup.
const probeNode = document.createElement('div')
document.body.append(probeNode)
const probeRoot = createRoot(probeNode)
let probeToasts: Array<AppToastValue & { id: string }> = []
const probeActions: string[] = []
const renderToasts = () => probeRoot.render(<StrictMode>{probeToasts.map(toast => <AppToast key={toast.id}
  toast={toast} onClose={() => { probeActions.push(`close:${toast.id}`); probeToasts = probeToasts.filter(item => item.id !== toast.id); renderToasts() }} />)}</StrictMode>)
const showToasts = (message?: string) => {
  probeActions.length = 0
  probeToasts = [
    { id: 'neutral', message: message ?? uiAttribute('响应模式未保存，请重试。'), tone: 'neutral', action: { label: uiAttribute('重试'), icon: 'retry', onSelect: () => probeActions.push('retry-neutral') } },
    { id: 'danger', message: uiAttribute('删除未完成，请重试。'), tone: 'danger', keepOnAction: true,
      action: { label: uiAttribute('重试'), icon: 'retry', onSelect: () => probeActions.push('retry') } }
  ]
  renderToasts()
}
;(window as any).forkQA={calls,threads,receipts,checkpoint,errors:[],loadingEvents,trackLoading:()=>{loadingEvents.length=0;previousLoading=!!document.querySelector('.app-toast-spinner')},reject:()=>{rejectFork=true},showToasts,probeActions,clearToasts:()=>{probeToasts=[];renderToasts()},hold:(value=true)=>{holdFork=value},release:()=>{holdFork=false;releaseFork?.()},lose:()=>{loseResponse=true},failOpen:(value=true)=>{failOpen=value},failDraft:(value=true)=>{failDraft=value},dropTarget:()=>{dropTarget=true},
  addAttachment:()=>{const input=document.querySelector('.camp-workspace form.composer:not(.single-chat-composer) .composer-file-input') as HTMLInputElement;const data=new DataTransfer();data.items.add(new File(['pending'],'pending.txt',{type:'text/plain'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))},attachmentPending:()=>attachmentPending,releaseAttachment:()=>releaseAttachment?.(),
  language:(value:any)=>changeInterfaceLanguage(preferences.generalPreferences,value),
  theme:(theme:any)=>applyAppearanceSnapshot(document.documentElement,{...appearance,preference:theme,resolvedTheme:['night','ember'].includes(theme)?'night':'day'})}
window.addEventListener('error',event=>(window as any).forkQA.errors.push(String(event.error?.stack??event.message)))
window.addEventListener('unhandledrejection',event=>(window as any).forkQA.errors.push(String(event.reason)))
createRoot(document.getElementById('root')!).render(<ThreadClientProvider client={client as any}><CurrentUserProfileContext.Provider value={{profile:{displayName:'维护者',avatarDataUrl:null},update:async()=>{}} as any}><BusinessApp environment={environment}/></CurrentUserProfileContext.Provider></ThreadClientProvider>)
