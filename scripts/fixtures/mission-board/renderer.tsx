import {runMissionAcceptance,runMissionCheckoutViewAcceptance,runMissionDeleteTraceAcceptance,runMissionLargeDiffAcceptance} from './acceptance'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {BusinessApp} from '../../../apps/desktop/src/renderer/src/BusinessApp'
import {CampClientProvider} from '../../../apps/desktop/src/renderer/src/camp-client'
import {CurrentUserProfileContext} from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import {createReviewModel} from '../../../scripts/fixtures/host-web-parity/model'
import {initial, initialDraft, agents, installations, navigation, now} from '../../../scripts/fixtures/host-web-parity/data'
import {DEFAULT_GENERAL_PREFERENCES} from '../../../apps/desktop/src/shared/general-preferences-model'
import {DEFAULT_APPEARANCE} from '../../../apps/desktop/src/shared/appearance'
import {applyAppearanceSnapshot} from '../../../apps/desktop/src/renderer/src/theme'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'
import type {MissionRecord, CampOpenProjection, NotificationEpisodeChange, NotificationEpisodeView, NotificationActionView} from '@contracts'

// UI-only acceptance: production BusinessApp/components, deterministic memory adapter.
const query=new URLSearchParams(location.search), theme=query.get('theme')==='night'?'night':'day'
const appearance={...DEFAULT_APPEARANCE,preference:theme,resolvedTheme:theme} as const
applyAppearanceSnapshot(document.documentElement,appearance)
const model=createReviewModel('web','camp')
const profiles=[...agents, ...Array.from({length:18},(_,i)=>({...agents[i%agents.length],agentId:`extra-${i}`,displayName:`扩展队员 ${String(i+1).padStart(2,'0')}`}))]
const missionSourceAttachments=[
 {id:'mission-source-directory',displayName:'需求资料',kind:'directory' as const,fileCount:null,mediaType:'inode/directory',byteSize:null,previewKind:'none' as const,availability:'unknown' as const},
 {id:'mission-source-pdf',displayName:'requirements.pdf',kind:'file' as const,fileCount:1,mediaType:'application/pdf',byteSize:4096,previewKind:'none' as const,availability:'unknown' as const},
 {id:'mission-source-md',displayName:'acceptance-notes.md',kind:'file' as const,fileCount:1,mediaType:'text/markdown',byteSize:1024,previewKind:'none' as const,availability:'unknown' as const},
 {id:'mission-source-json',displayName:'fixture.json',kind:'file' as const,fileCount:1,mediaType:'application/json',byteSize:768,previewKind:'none' as const,availability:'unknown' as const},
 {id:'mission-source-txt',displayName:'handoff.txt',kind:'file' as const,fileCount:1,mediaType:'text/plain',byteSize:512,previewKind:'none' as const,availability:'unknown' as const}
]
const items:MissionRecord[]=[
 ['需要核对窄窗口的目录布局','needs_you',['交互','体验优化']],['补齐使命工作区恢复路径','in_progress',['Core']],['更新首次使用引导文案','not_started',['文案']],['使命累计变更回归测试','completed',['测试']]
].map(([title,status,tags],i)=>({missionId:`mission-${i}`,number:18-i,campId:`rvcamp_01h47kvsy5fk1shh6w1g60eec${i}`,title:title as string,description:'让使命从保存、开始、恢复到交付都有清晰的状态。复用现有会话组件，并验证工作目录、草稿和文件预览。\n这段描述用于验证完整描述展开后的布局。',status:status as any,tags:tags as string[],attachments:i===0?structuredClone(missionSourceAttachments):[],projectPath:'/workspace/rovai-ai',projectBindingKind:'directory',detailsVersion:1,sourceMessageId:null,createdAt:now,updatedAt:new Date(Date.now()-86400000).toISOString(),memberAgentIds:profiles.slice(0,i===0?8:4).map(a=>a.agentId),defaultLeadAgentId:profiles[0].agentId,runningAgentIds:status==='in_progress'?profiles.slice(0,4).map(a=>a.agentId):[],startAvailable:status!=='in_progress',hasUnread:i===0,workspaceEverCreated:i!==2,workspaceResourcesPresent:i!==2,cleanupAvailable:i!==1&&i!==2}))
if(query.has('pointerCatalog')) items[1].tags.push(...Array.from({length:16},(_,i)=>`扩展标签 ${String(i+1).padStart(2,'0')}`))
const events=new Set<(e:any)=>void>(),calls:any[]=[]
let failNextMissionRefresh=false, missionRefreshPending=false, failNextMissionStart=false, failNextMissionChanges=false, delayNextMissionChanges=false, missionChangesSequence=0, missionChangesInFlight=0, missionChangesMaxInFlight=0, checkoutBranch='rovai/mission/018-validation'
const orphanCleanups:any[]=[]
const missionChangedFiles=[
 {id:'file-a',path:'src/mission.ts',oldPath:null,kind:'modified',additions:2,deletions:1,binary:false,oldMode:'100644',newMode:'100644'},
 {id:'file-b',path:'src/runtime/worker.ts',oldPath:'src/runtime/runner.ts',kind:'renamed',additions:1,deletions:1,binary:false,oldMode:'100644',newMode:'100644'},
 {id:'file-c',path:'src/styles/mission.css',oldPath:null,kind:'modified',additions:8,deletions:2,binary:false,oldMode:'100644',newMode:'100644'},
 {id:'file-d',path:'src/types.ts',oldPath:null,kind:'modified',additions:3,deletions:0,binary:false,oldMode:'100644',newMode:'100644'},
 {id:'file-e',path:'src/ui/activity.tsx',oldPath:null,kind:'added',additions:24,deletions:0,binary:false,oldMode:null,newMode:'100644'},
 {id:'file-f',path:'src/runtime/cache.ts',oldPath:null,kind:'modified',additions:5,deletions:4,binary:false,oldMode:'100644',newMode:'100644'},
 {id:'file-g',path:'src/runtime/status.ts',oldPath:null,kind:'deleted',additions:0,deletions:12,binary:false,oldMode:'100644',newMode:null},
 ...(query.has('largeDiff')?Array.from({length:1193},(_,index)=>({id:`large-${index}`,path:`zzzz/file-${String(index).padStart(4,'0')}.ts`,oldPath:null,kind:'modified',additions:1,deletions:1,binary:false,oldMode:'100644',newMode:'100644'})):[])
]
// Hidden Electron acceptance windows still model an attentive foreground user.
Object.defineProperty(document, 'hasFocus', { value: () => true })
Object.defineProperty(document, 'visibilityState', { value: 'visible' })
const notificationJournal: NotificationEpisodeChange[] = []
let notificationSequence = 0
const snapshots=new Map(),drafts=new Map()
function snapshot(m:MissionRecord):CampOpenProjection {
 if(snapshots.has(m.campId)) return snapshots.get(m.campId)
 const s=JSON.parse(JSON.stringify(initial).replaceAll(initial.camp.id,m.campId))
 s.camp={...s.camp,id:m.campId,missionId:m.missionId,title:m.title,activationState:'active',projectPath:m.projectPath}
 s.schemaVersion=8
 const collection=(n:number)=>({totalCount:n,loadedCount:n,omittedCount:0,complete:true})
 s.coverage={tasks:collection(s.tasks.length),messages:{...collection(s.messages.length),hasEarlier:false,oldestLoadedSequence:s.messages[0]?.sequence??null,newestLoadedSequence:s.messages.at(-1)?.sequence??null},messageDeliveries:collection(s.messageDeliveries.length),turns:collection(s.turns.length),agentRuns:collection(s.agentRuns.length),approvals:collection(s.approvals.length)}
 snapshots.set(m.campId,s);return s
}
const projects=[{projectKey:'directory:/workspace/rovai-ai',projectPath:'/workspace/rovai-ai',name:'rovai-ai',lastActivityAt:now,lastActivityGlobalSequence:0,totalCount:0,recentCamps:[]},...Array.from({length:14},(_,i)=>({projectKey:`directory:/workspace/sample-${i+1}`,projectPath:`/workspace/sample-${i+1}`,name:`示例项目 ${String(i+1).padStart(2,'0')}`,lastActivityAt:now,lastActivityGlobalSequence:0,totalCount:0,recentCamps:[]}))]
// Empty project groups are pruned by the real navigation owner. Seed an ordinary Camp in each picker project.
const populatedProjects=projects.map((project,index)=>({...project,totalCount:1,recentCamps:[{...navigation(initial).projects[0].recentCamps[0],id:`fixture-project-camp-${index}`,title:`${project.name} 的普通对话`,projectPath:project.projectPath}]}))
const nav={schemaVersion:3,throughGlobalSequence:10,quickChat:{totalCount:0,recentCamps:[]},projects:populatedProjects}
const prefs={...DEFAULT_GENERAL_PREFERENCES,newConversationDefaults:{memberAgentIds:profiles.map(a=>a.agentId),defaultLeadAgentId:profiles[0].agentId}}
const navigationPrefs={schemaVersion:4,pins:[],removedProjects:[],projectOrder:projects.map(p=>p.projectKey),projectNames:{}}
const changed=()=>events.forEach(fn=>fn({method:'missions.invalidated',params:{}}))
const seedScrollableLanes=(count=10)=>{
 if(items.some(item=>item.missionId.startsWith('scroll-')))return
 const states=['needs_you','not_started','in_progress','completed'] as const
 states.forEach((status,statusIndex)=>Array.from({length:count},(_,index)=>{
  const seed=structuredClone(items[0])
  items.push({...seed,missionId:`scroll-${status}-${index}`,campId:`rvcamp_scroll_${status}_${index}`,number:300+statusIndex*count+index,title:`${status} 滚动样本 ${String(index+1).padStart(2,'0')}`,description:'用于验证状态列独立滚动与拖拽边缘自动滚动。',status,tags:[],attachments:[],createdAt:now,updatedAt:now,memberAgentIds:profiles.slice(0,2).map(agent=>agent.agentId),defaultLeadAgentId:profiles[0].agentId,runningAgentIds:[],startAvailable:true,hasUnread:false,workspaceEverCreated:false,workspaceResourcesPresent:false,cleanupAvailable:false,workspaceCleanup:undefined})
 }))
 changed()
}
const clearScrollableLanes=()=>{for(let index=items.length-1;index>=0;--index)if(items[index].missionId.startsWith('scroll-'))items.splice(index,1);changed()}
const applied=(payload:any={})=>({status:'applied',code:'ok',payload})
const accepted=(payload:any={})=>({status:'accepted',code:'camp.delete_accepted',payload})
const workspaceFor=(m:MissionRecord,state?:'cleanup_pending'|'cleanup_failed'|'cleaned')=>{
 const n=String(m.number).padStart(3,'0'),cleanup=m.workspaceCleanup
 return {id:`workspace-${m.missionId}`,missionId:m.missionId,campId:m.campId,executionHostId:'host',sourceDirectory:'/workspace/rovai-ai',repositoryRoot:'/workspace/rovai-ai',gitCommonDir:'/workspace/rovai-ai/.git',workingDirectory:'/workspace/rovai-ai-mission-'+n,worktreePath:'/workspace/rovai-ai-mission-'+n,baseBranch:'main',managedBranch:'rovai/mission/'+n,baseSha:'a'.repeat(40),state:state??(cleanup?.state==='cleaning'?'cleanup_pending':cleanup?.state==='failed'?'cleanup_failed':cleanup?.state==='cleaned'||!m.workspaceResourcesPresent?'cleaned':'ready'),cleanupWorktreeRemoved:cleanup?.worktreeRemoved??!m.workspaceResourcesPresent,cleanupBranchRemoved:cleanup?.branchRemoved??!m.workspaceResourcesPresent,diagnostic:cleanup?.diagnostic??null}
}
function admitMissionNotification(missionId: string, kind: 'open_camp_message' | 'open_camp' = 'open_camp_message'): string {
 const mission = items.find(item => item.missionId === missionId)!
 const s = snapshot(mission) as any, n = ++notificationSequence
 const messageId = `mission-notification-message-${n}`
 const source = { ...structuredClone(s.messages[1]), id: messageId, sequence: Math.max(...s.messages.map((message:any) => message.sequence)) + 1,
  body: `使命通知来源 ${n}`, content: [{ kind: 'text', text: `使命通知来源 ${n}` }], attachments: [] }
 s.messages.push(source); s.throughGlobalSequence += 1
 s.coverage.messages = { ...s.coverage.messages, totalCount: s.messages.length, loadedCount: s.messages.length, newestLoadedSequence: source.sequence }
 const semantic = kind === 'open_camp_message' ? 'user_mention' : 'turn_incomplete'
 const action: NotificationActionView = { actionId: `mission-action-${n}`, kind, available: true,
  campId: mission.campId, campTurnId: null, agentRunId: null,
  messageId: kind === 'open_camp_message' ? messageId : null, approvalId: null, acknowledgementId: `mission-occurrence-${n}`,
  observedEpisodeVersion: n, singleChat: null }
 const episode: NotificationEpisodeView = { id: `mission-episode-${n}`, kind: 'collaboration', episodeVersion: n,
  attentionRevision: n, changeSequence: n, camp: { id: mission.campId, title: mission.title }, campTurnId: null, agentRunId: null,
  primarySemantic: semantic, unread: true, resolved: false, satisfied: false, pendingApprovalCount: 0, mentionCount: 1,
  unacknowledgedMentionCount: 1, mention: null, reasons: [], primaryAction: action, secondaryActions: [], createdAt: now, updatedAt: now }
 notificationJournal.push({ changeSequence: n, episodeId: episode.id, episodeVersion: n, attentionRevision: n, operation: 'upsert',
  changeCause: 'occurrence_admitted', headsUpSignal: { semantic, admittedAttentionRevision: n, action, mention: null },
  headsUpInvalidation: null, changedAt: now, episode })
 events.forEach(fn => fn({ method: 'notification_episode.changed', params: {} }))
 return messageId
}
const client={...model.client,onInvalidated:undefined,onEvent:(fn:any)=>{events.add(fn);return()=>events.delete(fn)},missionAttachments:{
 update:async(_commandId:string,patch:any,keepAttachmentIds:string[],attachments:any[])=>{
  calls.push({method:'missions.updateWithAttachments',p:{patch,keepAttachmentIds,attachments}})
  const m=items.find(item=>item.missionId===patch.missionId)!
  if(patch.expectedDetailsVersion!==m.detailsVersion)return {...applied({missionId:m.missionId}),status:'rejected',code:'mission.details_version_conflict'}
  const next=[...(m.attachments??[]).filter(attachment=>keepAttachmentIds.includes(attachment.id)),...attachments.map(({id,file,kindHint})=>({id,displayName:file.name,kind:kindHint,mediaType:kindHint==='directory'?'inode/directory':file.type||null,byteSize:kindHint==='directory'?null:file.size,fileCount:kindHint==='directory'?null:1,previewKind:kindHint==='file'&&file.type.startsWith('image/')?'image':'none',availability:'unknown'}))]
  const detailsChanged=patch.title!==undefined&&patch.title!==m.title||patch.description!==undefined&&patch.description!==m.description||JSON.stringify(next)!==JSON.stringify(m.attachments??[])
  Object.assign(m,patch,{attachments:next,detailsVersion:m.detailsVersion+(detailsChanged?1:0),updatedAt:new Date().toISOString()});delete (m as any).expectedDetailsVersion;changed();return applied({missionId:m.missionId,changed:detailsChanged||patch.tags!==undefined})
 },
 create:async(_commandId:string,command:any,attachments:any[])=>{
  calls.push({method:'missions.createWithAttachments',p:{command,attachments}})
  const m={...items[0],...command,attachments:attachments.map(({id,file,kindHint})=>({id,displayName:file.name,kind:kindHint,mediaType:kindHint==='directory'?'inode/directory':file.type||null,byteSize:kindHint==='directory'?null:file.size,fileCount:kindHint==='directory'?null:1,previewKind:kindHint==='file'&&file.type.startsWith('image/')?'image':'none',availability:'unknown'})),number:Math.max(0,...items.map(item=>item.number))+1,missionId:'created-'+items.length,campId:'rvcamp_01h47kvsy5fk1shh6w1g60eed'+items.length,status:'not_started',sourceMessageId:null,detailsVersion:1,hasUnread:false,runningAgentIds:[],startAvailable:true,workspaceEverCreated:false,workspaceResourcesPresent:false,cleanupAvailable:false,createdAt:now,updatedAt:now}
  items.unshift(m);changed();return applied({campId:m.campId,missionId:m.missionId})
 }
},request:async(method:string,p:any={})=>{
 calls.push({method,p});const c=p.command??p,m=items.find(m=>m.missionId===c.missionId||m.campId===c.campId)
 if(method==='missions.list'){
  if(failNextMissionRefresh){failNextMissionRefresh=false;missionRefreshPending=true;await new Promise(resolve=>setTimeout(resolve,150));missionRefreshPending=false;throw new Error('fixture mission refresh failed')}
  return structuredClone(items)
 }
 if(method==='missions.cleanup.list')return structuredClone(orphanCleanups)
 if(method==='members.list')return profiles
 if(method==='runtime.installations.list')return installations
 if(method==='memory.hearthReviewItems.list')return []
 if(method==='navigation.snapshot')return nav
 if(method==='navigation.camps')return {throughGlobalSequence:nav.throughGlobalSequence,groupKeys:[],camps:[]}
 if(method==='navigation.findCamp')return items.find(m=>m.campId===p.campId)?{...snapshot(items.find(m=>m.campId===p.campId)!).camp}:null
 if(method==='camps.exists')return !!m
 if(method==='camps.open'||method==='camps.enter'){
  if(typeof p.traceId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.traceId))throw new Error('missing field `traceId`')
  return structuredClone(snapshot(m!))
 }
 if(method==='camp.messages.around')return {schemaVersion:1,campId:c.campId,anchorMessageId:c.messageId,sourceAvailable:true,messages:structuredClone(snapshot(m!).messages)}
 if(method==='navigation.campViewed'){if(m)m.hasUnread=false;return {campId:c.campId,lastSeenGlobalSequence:c.throughGlobalSequence,changed:true,navigation:{throughGlobalSequence:c.throughGlobalSequence,groupKeys:[],camps:[]}}}
 if(method==='camp.composerDraft.get'){if(!drafts.has(c.campId))drafts.set(c.campId,{...structuredClone(initialDraft),campId:c.campId,body:'',content:{schemaVersion:1,segments:[]},attachments:[]});return structuredClone(drafts.get(c.campId))}
 if(method==='camp.composerDraft.save'){const d=drafts.get(c.campId);Object.assign(d,{content:c.content,body:c.content.segments.map((s:any)=>s.text??'').join(''),revision:d.revision+1});return structuredClone(d)}
 if(method==='camp.pendingInputs.get')return {campId:c.campId,executionActive:false,items:[],editSession:null,submissionOutcomes:[]}
 if(method==='notifications.inbox')return {schemaVersion:8,items:[],unreadCount:0,throughChangeSequence:notificationSequence,nextCursor:null}
 if(method==='notifications.preference.get')return {version:1,updatedAt:now,headsUpEnabled:true,approvalHeadsUpEnabled:true,userMentionHeadsUpEnabled:true,turnCompletedHeadsUpEnabled:true,turnIncompleteHeadsUpEnabled:true}
 if(method==='notifications.changesSince')return {schemaVersion:8,requestedAfterChangeSequence:c.afterChangeSequence,nextChangeSequence:notificationSequence,throughChangeSequence:notificationSequence,retainedFloorChangeSequence:0,hasMore:false,resetRequired:false,changes:notificationJournal.filter(change=>change.changeSequence>c.afterChangeSequence)}
 if(method==='notifications.acknowledgeVisibleSources'||method==='notifications.acknowledge')return applied()
 if(method==='events.subscribe')return {schemaVersion:1,events:[],throughGlobalSequence:10}
 if(method==='workspaces.inspect')return {name:'rovai-ai',projectPath:p.path,gitObservation:{state:'git_valid',branch:'main',head:'a'.repeat(40),repositoryRoot:p.path,objectFormat:'sha1',dirty:false,reason:null}}
 if(method==='missions.update'){
  if((c.title!==undefined||c.description!==undefined)&&c.expectedDetailsVersion!==m!.detailsVersion)return {...applied({missionId:m!.missionId}),status:'rejected',code:'mission.details_version_conflict'}
  const detailsChanged=(c.title!==undefined&&c.title!==m!.title)||(c.description!==undefined&&c.description!==m!.description)
  Object.assign(m!,c,{detailsVersion:m!.detailsVersion+(detailsChanged?1:0),updatedAt:new Date().toISOString()});delete (m! as any).expectedDetailsVersion;changed();return applied({missionId:m!.missionId,changed:detailsChanged||c.tags!==undefined})
 }
 if(method==='missions.status'){m!.status=c.status;changed();return applied({missionId:m!.missionId,changed:true})}
 if(method==='missions.workspace.cleanup'){
  if(m!.workspaceCleanup?.state==='cleaning')return {...applied({missionId:m!.missionId}),status:'rejected',code:'mission.workspace_cleanup_pending'}
  const previous=m!.workspaceCleanup
  m!.workspaceCleanup={state:'cleaning',worktreeRemoved:previous?.worktreeRemoved??false,branchRemoved:previous?.branchRemoved??false,diagnostic:null};m!.cleanupAvailable=false;changed();return applied({missionId:m!.missionId,scheduled:true})
 }
 if(method==='missions.cleanup.retry'){
  const row=orphanCleanups.find(row=>row.id===p.workspaceId)
  if(row?.state==='cleanup_failed'){row.state='cleanup_pending';row.diagnostic=null;changed();return {pending:true,scheduled:true}}
  return {pending:!!row,scheduled:false}
 }
 if(method==='missions.start'){
  await new Promise(resolve=>setTimeout(resolve,80))
  if(failNextMissionStart){failNextMissionStart=false;return {...applied({missionId:m!.missionId}),status:'rejected',code:'mission.lead_unavailable'}}
  const s=snapshot(m!),sequence=Math.max(0,...s.messages.map((message:any)=>message.sequence))+1
  const trigger={...structuredClone(s.messages[0]),id:`${m!.missionId}-mission-start`,sequence,authorType:'user',authorId:'local_user',sourceAgentRunId:null,body:'开始使命',content:{schemaVersion:1,segments:[{kind:'text',text:'开始使命'}]},attachments:[],missionStart:{missionId:m!.missionId,title:m!.title,description:m!.description},createdAt:new Date().toISOString()}
  s.messages.push(trigger)
  s.coverage.messages={...s.coverage.messages,totalCount:s.messages.length,loadedCount:s.messages.length,newestLoadedSequence:sequence}
  m!.startAvailable=false;m!.updatedAt=new Date().toISOString()
  changed();return applied({missionId:m!.missionId,campId:m!.campId})
 }
 if(method==='missions.activity')return [{id:1,kind:'created',actorType:'user',actorId:'user',changes:{},createdAt:now}]
 if(method==='missions.delivery' && query.has('nonGit'))return {campId:m!.campId,workingDirectory:'/workspace/plain',git:false,workspace:null,pullRequests:[],files:[]}
 if(method==='missions.delivery'){const n=String(m!.number).padStart(3,'0');return {campId:m!.campId,workingDirectory:'/workspace/rovai-ai-mission-'+n,git:true,workspace:workspaceFor(m!),pullRequests:[{id:'legacy-pr',url:'https://github.com/rovai-ai/rovai/pull/18',title:'历史关联',createdAt:now}],files:[{attachmentId:'review-attachment',displayName:'interaction-review.md',kind:'file',fileCount:1,mediaType:'text/markdown',byteSize:1024,previewKind:'none',messageId:snapshot(m!).messages[1].id,agentId:profiles[0].agentId,createdAt:now}]}}
 if(method==='missions.changes'){
  const viewId=`mission-view-${++missionChangesSequence}`, branch=checkoutBranch, delayed=delayNextMissionChanges
  delayNextMissionChanges=false
  missionChangesInFlight+=1;missionChangesMaxInFlight=Math.max(missionChangesMaxInFlight,missionChangesInFlight)
  try {
   if(delayed)await new Promise(resolve=>setTimeout(resolve,260))
   if(failNextMissionChanges){failNextMissionChanges=false;throw new Error('fixture mission changes failed')}
   return {checkoutState:{kind:'branch',branch,head:'b'.repeat(40)},viewId,files:structuredClone(missionChangedFiles),diffError:null}
  } finally { missionChangesInFlight-=1 }
 }
 if(method==='missions.fileDiff'){
  const file=missionChangedFiles.find(file=>file.id===p.fileId)!
  if(file.id==='file-b')await new Promise(resolve=>setTimeout(resolve,90))
  return {file:structuredClone(file),hunks:[{oldStart:1,newStart:1,lines:[{kind:'deletion',text:`old-${file.id}`,oldLine:1,newLine:null},{kind:'addition',text:`new-${file.id}`,oldLine:null,newLine:1}]}],patch:''}
 }
 if(method==='missions.diffSession.release')return {released:true}
 if(method==='missions.create'){const m={...items[0],...c,number:Math.max(0,...items.map(item=>item.number))+1,missionId:'created-'+items.length,campId:'rvcamp_01h47kvsy5fk1shh6w1g60eed'+items.length,status:'not_started',hasUnread:false,workspaceEverCreated:false,workspaceResourcesPresent:false,cleanupAvailable:false};items.unshift(m);changed();return applied({campId:m.campId,missionId:m.missionId})}
 if(method==='camps.changeDefaultLead'){m!.defaultLeadAgentId=c.successorAgentId;snapshot(m!).camp.defaultLeadAgentId=c.successorAgentId;changed();return applied()}
 if(method==='camps.delete'){
  if(c.workspaceDisposition==='cleanup'&&m!.workspaceResourcesPresent)orphanCleanups.push(workspaceFor(m!,'cleanup_pending'))
  items.splice(items.indexOf(m!),1);changed();return accepted({campId:m!.campId,operationId:p.commandId,workspaceCleanupScheduled:c.workspaceDisposition==='cleanup'})
 }
 return model.client.request(method as any,p)
}}
const preferences:any={appearance:{get:async()=>appearance,onChanged:()=>()=>{}},generalPreferences:new Proxy({}, {get:(_,key)=>async(...args:any[])=>{if(key==='setNewConversationDefaults')prefs.newConversationDefaults=args[0];return prefs}}),navigationPreferences:new Proxy({}, {get:()=>async()=>navigationPrefs})}
const navigationHistory={initial:{entries:[{kind:'missions' as const}],index:0},write:(state:any)=>state,go:async()=>false,listen:()=>()=>{}}
const environment:any={client,files:{...model.fileApi,open:async(req:any)=>{calls.push({method:"fixture.file.open",p:req});return model.fileApi.open({...req,...(req.campId?{campId:initial.camp.id}:{})} as any)}},preferences,navigationHistory,selectWorkspaceDirectory:async()=>({name:'rovai-ai',projectPath:'/workspace/rovai-ai'})}
;(window as any).missionQA={items,calls,errors:[],run:runMissionAcceptance,runCheckoutView:runMissionCheckoutViewAcceptance,runDeleteTrace:runMissionDeleteTraceAcceptance,runLargeDiff:runMissionLargeDiffAcceptance,admitMissionNotification,
 seedScrollableLanes,clearScrollableLanes,
 failNextMissionRefresh:()=>{failNextMissionRefresh=true},missionRefreshPending:()=>missionRefreshPending,
 failNextMissionStart:()=>{failNextMissionStart=true},
 claimMissionRun:(missionId:string)=>{const m=items.find(item=>item.missionId===missionId)!;m.runningAgentIds=[m.defaultLeadAgentId!];m.startAvailable=false;changed()},
 delayNextMissionChanges:()=>{delayNextMissionChanges=true},failNextMissionChanges:()=>{failNextMissionChanges=true},missionChangesInFlight:()=>missionChangesInFlight,missionChangesMaxInFlight:()=>missionChangesMaxInFlight,setCheckoutBranch:(branch:string)=>{checkoutBranch=branch},
 failMissionCleanup:(missionId:string,partial=false)=>{const m=items.find(item=>item.missionId===missionId)!;m.workspaceCleanup={state:'failed',worktreeRemoved:partial,branchRemoved:false,diagnostic:partial?'mission.branch_changed: expected branch identity changed':'mission.git_failed: worktree could not be removed'};m.workspaceResourcesPresent=true;m.cleanupAvailable=false;changed()},
 completeMissionCleanup:(missionId:string)=>{const m=items.find(item=>item.missionId===missionId)!;m.workspaceCleanup={state:'cleaned',worktreeRemoved:true,branchRemoved:true,diagnostic:null};m.workspaceResourcesPresent=false;m.cleanupAvailable=false;changed()},
 failOrphanCleanup:(partial=false)=>{const row=orphanCleanups[0];if(row){row.state='cleanup_failed';row.cleanupWorktreeRemoved=partial;row.cleanupBranchRemoved=false;row.diagnostic=partial?'mission.branch_changed: expected branch identity changed':'mission.git_failed';changed()}},
 completeOrphanCleanup:()=>{orphanCleanups.splice(0);changed()},orphanCleanups,
 sourceMessageId:(missionId:string)=>snapshot(items.find(item=>item.missionId===missionId)!).messages[1].id,
 invalidateMissionDetails:()=>changed(),
 terminalMissionRun:(campId:string)=>events.forEach(fn=>fn({method:'agent_run.terminal',params:{campId}})),
 refreshCamp:(campId:string)=>events.forEach(fn=>fn({method:'camp.pendingInputs.changed',params:{campId,reason:'published'}}))}
window.addEventListener('error',e=>(window as any).missionQA.errors.push(String(e.error?.stack??e.message)))
window.addEventListener('unhandledrejection',e=>(window as any).missionQA.errors.push(String(e.reason)))
createRoot(document.getElementById('root')!).render(<CampClientProvider client={client as any}><CurrentUserProfileContext.Provider value={{profile:{displayName:'维护者',avatarDataUrl:null},update:async()=>{}} as any}><BusinessApp environment={environment}/></CurrentUserProfileContext.Provider></CampClientProvider>)
