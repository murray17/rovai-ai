import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CampChannelSource, NavigationCampItem, NavigationSnapshot } from '@contracts'
import { CampNavigation } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { QuickChatWorkspace } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { formatCampTitle } from '../../../apps/desktop/src/renderer/src/camp-title'
import '../../../apps/desktop/src/renderer/src/styles.css'

const sources: Array<CampChannelSource | undefined> = [
  undefined,
  { provider: 'feishu', conversationKind: 'p2p' },
  { provider: 'dingtalk', conversationKind: 'p2p' },
  { provider: 'feishu', conversationKind: 'group' },
  { provider: 'feishu', conversationKind: 'topic' },
  { provider: 'dingtalk', conversationKind: 'group' }
]
const initial: NavigationCampItem[] = sources.map((channelSource, index) => ({
  id: `fixture-camp-${index}`, title: index === 4
    ? '排查数据库迁移问题并验证一个足够长的中文会话名称仍然保持侧栏布局稳定'
    : ['修复登录态恢复问题', '完善账号自动续期', '完善机器人发布流程', '优化执行结果卡片', '', '修复消息重复消费'][index],
  channelSource, activationState: 'active', projectBindingKind: index < 3 ? 'quick_chat' : 'directory',
  projectPath: index < 3 ? '/fixture/quick-chat' : '/fixture/project', defaultLead: null, marker: 'none',
  lastActivityAt: '2026-08-31T00:00:00Z', lastActivityGlobalSequence: 1, latestCompletionGlobalSequence: 0, version: 1
}))
const saved: Array<{ id: string; title: string }> = []
Object.assign(window, { rovai: { platform: 'darwin' } })
function Fixture(): React.JSX.Element {
  const [camps, setCamps] = useState(initial)
  const [active, setActive] = useState('fixture-camp-4')
  const quick = camps.filter(camp => camp.projectBindingKind === 'quick_chat')
  const navigation: NavigationSnapshot = {
    schemaVersion: 3, throughGlobalSequence: 1,
    quickChat: { totalCount: quick.length, recentCamps: quick },
    projects: [{ projectKey: 'directory:/fixture/project', projectPath: '/fixture/project', name: '隔离验收项目',
      lastActivityAt: '2026-08-31T00:00:00Z', lastActivityGlobalSequence: 1, totalCount: 3,
      recentCamps: camps.filter(camp => camp.projectBindingKind === 'directory') }]
  }
  return <div className="app-shell app-shell-camp">
    <CampNavigation view="camp" state="ready" navigation={navigation} activeCampId={active} pendingMemoryCount={0}
      onNewConversation={() => {}} onMembers={() => {}} onMemory={() => {}} onSettings={() => {}}
      onOpenProject={() => {}} onCamp={camp => setActive(camp.id)} onRemoveProject={async () => {}}
      onRename={async (camp, title) => {
        saved.push({ id: camp.id, title })
        setCamps(current => current.map(item => item.id === camp.id ? { ...item, title, version: item.version + 1 } : item))
      }} onDelete={async () => {}} onError={error => { throw error }} />
    <AppHeader campTitle={formatCampTitle(camps.find(camp => camp.id === active)!)} contextLabel="隔离验收项目"
      camp={null} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <QuickChatWorkspace agents={[]} recentCamps={quick} onOpenCamp={camp => setActive(camp.id)} onNewConversation={() => {}} />
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
Object.assign(window, { namingTest: {
  settle: async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  },
  state: () => ({
    labels: [...document.querySelectorAll('.camp-nav-open')].map(node => node.getAttribute('aria-label')),
    title: document.querySelector('.context-breadcrumb h1')?.textContent,
    rename: document.querySelector<HTMLInputElement>('#rename-camp-title')?.value,
    saved,
    long: (() => {
      const node = document.querySelector('[data-sidebar-menu-target="camp:fixture-camp-4"]')?.closest('.camp-nav-row')?.querySelector<HTMLElement>('.truncate')
      return node ? { clipped: node.scrollWidth > node.clientWidth, ellipsis: getComputedStyle(node).textOverflow } : null
    })(),
    overflow: document.documentElement.scrollWidth > innerWidth,
    errors: document.querySelector('[role="alert"]')?.textContent ?? ''
  })
} })
