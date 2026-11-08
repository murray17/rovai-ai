// Production components, synthetic API data. No Core, Runtime or user data access.
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import '../../../apps/web/src/styles.css'
import '../../../apps/web/src/mobile.css'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { initialMembers, clone, navigation } from '../member-editor/data'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { TeamWorkspace } from '../../../apps/desktop/src/renderer/src/TeamWorkspace'
import { ThreadNavigation } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { NewConversationDialog } from '../../../apps/desktop/src/renderer/src/NewConversationDialog'
import { GeneralSettings } from '../../../apps/desktop/src/renderer/src/GeneralSettings'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { initializeInterfaceLanguage, uiAttribute } from '../../../apps/desktop/src/renderer/src/interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import { THEME_MODES } from '../../../apps/desktop/src/shared/appearance'

const query = new URLSearchParams(location.search)
initializeInterfaceLanguage({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguagePreference: query.get('lang') === 'en' ? 'en' : 'zh-CN', interfaceLanguage: query.get('lang') === 'en' ? 'en' : 'zh-CN' })
const themeId = Object.hasOwn(THEME_MODES, query.get('theme')) ? query.get('theme') : 'day'
document.documentElement.dataset.theme = THEME_MODES[themeId]
document.documentElement.dataset.themeId = themeId
document.documentElement.dataset.rovaiPlatform = 'darwin'
const original = initialMembers()
const agents = [...original, ...Array.from({length: 8}, (_, index) => ({...clone(original[index % original.length]), agentId: `extra-${index}`, displayName: ['小满','阿栖','北斗','星野','松果','小禾','麦芽','晚枫'][index], teamRole: ['交互设计','前端开发','架构设计','代码审查','自动化测试','文案设计','性能优化','发布验证'][index], avatarRef: null, memberOrder: index + 4}))]
const makeTeam = (count, id, name) => ({ id, name, memberAgentIds: agents.slice(0, count).map(a => a.agentId), defaultLeadAgentId: agents[0].agentId, guidance: '回答保持简洁，先说明结论。\n交付前验证关键路径。', version: 1 })
let library = query.has('empty') ? [] : [makeTeam(4, 'team-4', '日常开发'), makeTeam(6, 'team-6', '产品与设计'), makeTeam(12, 'team-12', '完整交付团队')]
let preferences = { ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguagePreference: query.get('lang') === 'en' ? 'en' : 'zh-CN', interfaceLanguage: query.get('lang') === 'en' ? 'en' : 'zh-CN', newConversationDefaults: { memberAgentIds: agents.slice(0,4).map(a=>a.agentId), defaultLeadAgentId: agents[0].agentId } }
const events = new Set()
const receipts = new Map()
const audit = []
const client = { platform: 'darwin', channels: null, onEvent: listener => { events.add(listener); return () => events.delete(listener) },
  memberAvatars: { read: async () => null },
  request: async (method, params) => {
    if (method === 'preferences.tasks.get') return {enabled:false,headsUpAfterSequence:0,observedThroughChangeSequence:0}
    if (method === 'teams.list') return clone(library)
    if (['teams.save','teams.delete'].includes(method)) {
      if (receipts.has(params.commandId)) return clone(receipts.get(params.commandId))
      const input = params.command
      const old = library.find(team => team.id === input.teamId)
      if (input.teamId && (!old || old.version !== input.expectedVersion)) return {status:'rejected',code:'team.conflict',payload:{}}
      let result
      if (method === 'teams.save') {
        const team = { id: input.teamId ?? crypto.randomUUID(), name: input.name.trim(), guidance: input.guidance.trim(), memberAgentIds: input.memberAgentIds, defaultLeadAgentId: input.defaultLeadAgentId, version: (old?.version ?? 0)+1 }
        library = old ? library.map(t=>t.id===old.id?team:t) : [...library,team]
        result={status:'applied',code:'team.saved',payload:{team}}
      } else {
        library=library.filter(t=>t.id!==input.teamId)
        if(preferences.newConversationTeamId===input.teamId) preferences={...preferences,newConversationTeamId:null,oneClickNewConversationEnabled:false}
        result={status:'applied',code:'team.deleted',payload:{teamId:input.teamId}}
      }
      receipts.set(params.commandId,result);audit.push({method,params,result});events.forEach(listener=>listener({method:'teams.changed',params:{}}));return clone(result)
    }
    if (method === 'workspaces.inspect') return {name:'Project',projectPath:params.path,gitObservation:{state:'not_git'}}
    throw new Error(`Unexpected fixture request: ${method}`)
  }
}
window.__teamFixture = {audit,library:()=>clone(library),preferences:()=>clone(preferences),changeTeam:()=>{library=library.map((t,i)=>i? t:{...t,name:'Changed remotely',version:t.version+1});events.forEach(listener=>listener({method:'teams.changed',params:{}}))}}
function Workbench() {
  const mobile=useMobileViewport(true), guard=useRef(null)
  const [teams,setTeams]=useState(library),[view,setView]=useState('teams'),[dialog,setDialog]=useState(false),[initialTeam,setInitialTeam]=useState(null),[prefs,setPrefs]=useState(preferences)
  const refresh=useCallback(async()=>{const next=await client.request('teams.list');setTeams(next);return next},[])
  const register=useCallback(next=>{guard.current=next},[])
  const navigate=async next=>{if(view==='teams'&&guard.current&&!await guard.current())return;setView(next)}
  const showDialog=team=>{setInitialTeam(team??null);setDialog(true)}
  const api=useMemo(()=>{
    const commit=patch=>{preferences={...preferences,...patch};setPrefs(preferences);return Promise.resolve(clone(preferences))}
    return {get:async()=>clone(preferences),setNewConversationTeam:newConversationTeamId=>commit({newConversationTeamId}),setNewConversationDefaults:newConversationDefaults=>commit({newConversationDefaults,newConversationTeamId:null,newConversationDefaultsRequireConfirmation:false}),setOneClickNewConversationEnabled:oneClickNewConversationEnabled=>commit({oneClickNewConversationEnabled}),getInterfaceLanguage:async()=>clone(preferences),onInterfaceLanguageChanged:()=>()=>{},setInterfaceLanguagePreference:interfaceLanguagePreference=>commit({interfaceLanguagePreference,interfaceLanguage:interfaceLanguagePreference==='system'?'en':interfaceLanguagePreference,languageRevision:preferences.languageRevision+1}),setStartupLocationMode:startupLocationMode=>commit({startupLocationMode}),setExecutionConsolePlacement:executionConsolePlacement=>commit({executionConsolePlacement}),setExecutionConsoleAutoOpen:executionConsoleAutoOpen=>commit({executionConsoleAutoOpen}),setWorldMapEnabled:worldMapEnabled=>commit({worldMapEnabled})}
  },[])
  return <MobileLayoutProvider value={mobile}><NavigationShell browser platform="darwin" settings={view==='settings'} data-mobile-view={mobile?'members':undefined}>
    {!mobile&&<ThreadNavigation view={view} state="ready" navigation={navigation} activeThreadId={null} onNewConversation={()=>showDialog()} onTeams={()=>navigate('teams')} onMembers={()=>navigate('teams')} onMemory={()=>navigate('settings')} onSettings={()=>navigate('settings')} onSettingsBack={()=>navigate('teams')} settingsSection="general" onSettingsSectionChange={()=>{}} onOpenProject={()=>{}} onThread={()=>{}} onRename={()=>{}} onDelete={()=>{}} pendingMemoryCount={3}/>}
    <main className={view==='teams'?'content members-content':'content settings-content'}>{mobile&&<div className="mobile-page-header"><button onClick={()=>navigate(view==='teams'?'settings':'teams')}>{view==='teams'?uiAttribute('设置'):uiAttribute('团队')}</button><button onClick={()=>showDialog()}>{uiAttribute('新对话')}</button></div>}
      {view==='teams'?<TeamWorkspace teams={teams} agents={agents} loading={false} loadError={null} defaultTeamId={prefs.newConversationTeamId} customDefaults={prefs.newConversationDefaults} refresh={refresh} onNewConversation={showDialog} onLeaveGuardChange={register}/>:<div className="settings-workbench"><div className="settings-panel settings-panel-general"><GeneralSettings api={api} agents={agents} teams={teams} initialPreferences={prefs} onPreferencesChange={setPrefs}/></div></div>}
    </main><NewConversationDialog open={dialog} teams={teams} initialTeam={initialTeam} initialWorkspace={null} initialSelection={prefs.newConversationDefaults} agents={agents} projects={[]} preflight={{admissible:true,presentMembers:agents.map(a=>({agentId:a.agentId,displayName:a.displayName,memberOrder:a.memberOrder,runtimeConfigured:true,runtimeReadiness:'ready'})),initialLeadAgentId:agents[0].agentId,blockers:[]}} busy={false} projectAccessReady onOpenChange={setDialog} onChooseWorkspaceDirectory={async()=>null} onWorkspaceSelected={async()=>{}} onCreate={async draft=>{audit.push({method:'threads.create',draft});setDialog(false)}}/>
  </NavigationShell></MobileLayoutProvider>
}
createRoot(document.getElementById('root')).render(<ThreadClientProvider client={client}><Workbench/></ThreadClientProvider>)
