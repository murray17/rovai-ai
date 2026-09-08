import { Activity, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SkillSettings } from '../../../apps/desktop/src/renderer/src/SkillSettings'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/App'
import { maskMcpJson } from '../../../apps/desktop/src/renderer/src/McpJsonEditor'
import { McpSettings } from '../../../apps/desktop/src/renderer/src/McpSettings'
import { agent, server, skillFixture } from './data'
import '../../../apps/desktop/src/renderer/src/styles.css'

const members = Array.from({ length: 12 }, (_, i) => agent(i))
const requests: { method: string; params: any }[] = []
let folderSelections = 0
let folderResult: string | null = '/fixture/skill-folder'
let conflict = false
let revealWait: Promise<void> | null = null
let releaseReveal: (() => void) | undefined
const privateDefinition = JSON.stringify({
  mcpServers: {
    docs: {
      command: 'node',
      env: {
        API_TOKEN: 'fixture-env-credential',
        EMPTY: '',
        PADDED: '  info  '
      }
    }
  }
})
const privateHeader = JSON.stringify({
  mcpServers: {
    Playwright: {
      url: 'https://example.invalid/mcp',
      headers: {
        Authorization: 'Bearer fixture-header-credential',
        'X-Region': '  cn  '
      }
    }
  }
})
let toggleWait: Promise<void> | null = null
let releaseToggle: (() => void) | undefined
const groups = [
  'claude_compatible',
  'codex',
  'copilot',
  'opencode',
  'kiro',
  'qoder',
  'codebuddy',
  'qwen',
  'trae',
  'cursor',
  'kimi',
  'grok',
  'antigravity',
  'pi'
].map((key, i) => ({
  key,
  label: ['Claude 兼容', 'Codex', 'Copilot', 'OpenCode'][i] ?? key,
  members: i < 4 ? members.slice(i, i + 3) : [],
  relativePath: '.fixture/skills',
  adapterKinds: [],
  verification: 'verified'
}))
let skills = ['ui-ux-pro-max', 'design-review', 'local-skill', 'code-review'].map((name, i) => ({
  ...skillFixture(i !== 2),
  id: `skill-${i + 1}`,
  name,
  origin: i === 2 ? ('imported' as const) : ('official' as const),
  groupAssignments: groups.map((group) => ({
    groupKey: group.key,
    revisionId: 'revision-1'
  }))
}))
let config = {
  configDigest: 'digest-1',
  servers: [
    server(),
    server({
      serverId: 'browser',
      name: 'Playwright',
      transport: 'streamable_http',
      definitionJson: maskMcpJson(privateHeader)!,
      enabled: false,
      assignedAgentIds: []
    })
  ]
}
const candidate = {
  name: 'new-folder-skill',
  description: '本地文件夹中的说明与参考文件',
  fileCount: 2,
  totalBytes: 100,
  contentDigest: 'digest',
  importAction: 'create',
  existingSkillId: null,
  existingSkillVersion: null
}
const text =
  '---\nname: ui-ux-pro-max\ndescription: UI design guidance\n---\n\n# 界面设计与实现\n\n从已有界面出发，让每个操作清晰、直接。\n\n## 使用方式\n\n1. 理解当前页面的主要任务。\n2. 保留熟悉的视觉风格和交互。\n3. 检查键盘操作、窄窗口和深色模式。\n\n## 设计原则\n\n- 主要内容优先，低频信息按需展开。\n- 选择整行即可切换投递范围。\n- 配置、导入与预览在当前页面完成。'
Object.assign(window, {
  rovai: {
    onEvent: () => () => {},
    selectSkillImportDirectory: async () => {
      folderSelections++
      return folderResult
    },
    request: async (method: string, params: any = {}) => {
      requests.push({ method, params })
      if (method === 'skills.list') return structuredClone(skills)
      if (method === 'skills.deliveryGroups.list') return groups
      if (method === 'skills.content.read')
        return {
          path: params.path,
          status: 'text',
          content:
            params.path === 'SKILL.md'
              ? text +
                '\n\n' +
                Array.from(
                  { length: 24 },
                  (_, i) => '## 参考段落 ' + (i + 1) + '\n\n内容与操作位于同一工作区。'
                ).join('\n\n')
              : '参考内容。',
          files: [
            { path: 'SKILL.md', bytes: 500 },
            { path: 'references/guide.md', bytes: 20 }
          ]
        }
      if (method === 'skills.import.inspect' || method === 'skills.import.github.inspect')
        return {
          stagingToken: 'stage-1',
          candidates:
            method === 'skills.import.github.inspect'
              ? [
                  { ...candidate, name: 'github-skill-one' },
                  { ...candidate, name: 'github-skill-two' }
                ]
              : [candidate],
          rejectedCandidates: []
        }
      if (method === 'skills.import.commit') {
        const id = 'new-' + params.command.candidateName
        skills = [
          ...skills,
          {
            ...skills[0],
            id,
            name: params.command.candidateName,
            origin: 'imported',
            enabled: true
          }
        ]
        return { status: 'applied', payload: { skillId: id } }
      }
      if (method === 'skills.delete') {
        skills = skills.filter((s) => s.id !== params.command.skillId)
        return { status: 'applied', payload: {} }
      }
      if (method === 'skills.setEnabled') {
        if (toggleWait) {
          await toggleWait
          toggleWait = null
        }
        const item = skills.find((s) => s.id === params.command.skillId)!
        item.enabled = params.command.enabled
        item.version++
        return {
          status: 'applied',
          payload: { enabled: item.enabled, version: item.version }
        }
      }
      if (method === 'skills.setGroupAssignments') {
        const item = skills.find((s) => s.id === params.command.skillId)!
        item.groupAssignments = params.command.groupKeys.map((groupKey: string) => ({
          groupKey,
          revisionId: 'revision-1'
        }))
        item.version++
        return { status: 'applied', payload: {} }
      }
      if (method === 'skills.get')
        return structuredClone(skills.find((s) => s.id === params.skillId))
      if (method === 'mcp.servers.reveal') {
        if (revealWait) {
          await revealWait
          revealWait = null
        }
        if (params.expectedConfigDigest !== config.configDigest)
          return {
            status: 'conflict',
            actualConfigDigest: config.configDigest
          }
        return {
          status: 'ok',
          serverId: params.serverId,
          configDigest: config.configDigest,
          definitionJson: params.serverId === 'browser' ? privateHeader : privateDefinition
        }
      }
      if (method === 'mcp.servers.setMembers') {
        config.servers = config.servers.map((s) =>
          s.serverId === params.serverId
            ? {
                ...s,
                enabled: params.agentIds.length > 0,
                assignedAgentIds: params.agentIds
              }
            : s
        )
      }
      if (method === 'mcp.config.get') return structuredClone(config)
      if (method === 'mcp.import.scan')
        return {
          configDigest: config.configDigest,
          sources: [],
          candidates: [
            ['local-tools', 'codex'],
            ['playwright', 'claude_code'],
            ['docs', 'cursor'],
            ['research-and-documentation-server-with-a-long-name', 'opencode'],
            ['github', 'copilot'],
            ['team-search', 'antigravity']
          ].map(([name, sourceKind], index) => ({
            candidateId: `import-${index + 1}`,
            proposedName: name,
            sourceKind,
            sourcePath: '/fixture/' + sourceKind + '/mcp.json',
            compatibility: 'portable',
            conflict: name === 'docs' ? 'name_conflict' : 'none',
            normalizedDefinitionJson: JSON.stringify({
              mcpServers: { [name]: { command: 'node' } }
            }),
            issues: []
          }))
        }
      if (method === 'mcp.servers.update' && conflict) {
        conflict = false
        config.configDigest = 'external-digest'
        return { status: 'conflict', actualConfigDigest: config.configDigest }
      }
      if (method === 'mcp.servers.update' && params.expectedConfigDigest !== config.configDigest)
        return { status: 'conflict', actualConfigDigest: config.configDigest }
      if (method === 'mcp.servers.update')
        config.servers = config.servers.map((s) =>
          s.serverId === params.serverId
            ? {
                ...s,
                definitionJson: maskMcpJson(params.definitionJson) ?? params.definitionJson
              }
            : s
        )
      if (method === 'mcp.servers.setEnabled')
        config.servers = config.servers.map((s) =>
          s.serverId === params.serverId ? { ...s, enabled: params.enabled } : s
        )
      if (method === 'mcp.assignments.set')
        config.servers = config.servers.map((s) =>
          s.serverId === params.serverId
            ? {
                ...s,
                assignedAgentIds: params.assigned
                  ? [...s.assignedAgentIds, params.agentId]
                  : s.assignedAgentIds.filter((id) => id !== params.agentId)
              }
            : s
        )
      if (method === 'mcp.servers.create' || method === 'mcp.import.commit') {
        const json = params.definitionJson ?? params.selections[0].definitionJson
        config.servers.push(
          server({
            serverId: 'added-' + config.servers.length,
            name: Object.keys(JSON.parse(json).mcpServers)[0],
            definitionJson: json,
            enabled: false,
            assignedAgentIds: []
          })
        )
      }
      if (method === 'mcp.servers.delete')
        config.servers = config.servers.filter((s) => s.serverId !== params.serverId)
      if (method.startsWith('mcp.')) {
        config.configDigest += '-next'
        return { status: 'ok', config: structuredClone(config) }
      }
      throw new Error('Unhandled fixture method: ' + method)
    }
  }
})
function Fixture() {
  const [page, setPage] = useState<'mcp' | 'skills'>('skills')
  return (
    <div className="app-shell">
      <WindowDragStrip page="settings" />
      <aside
        style={{
          gridColumn: 1,
          gridRow: '1 / -1',
          padding: '28px 18px',
          background: 'var(--rail)'
        }}
      >
        <strong>设置</strong>
        <div style={{ display: 'grid', gap: 8, marginTop: 24 }}>
          <button className="quiet-button" id="nav-skills" onClick={() => setPage('skills')}>
            Skills
          </button>
          <button className="quiet-button" id="nav-mcp" onClick={() => setPage('mcp')}>
            MCP
          </button>
        </div>
      </aside>
      <main className="content settings-content" style={{ flex: 1, minWidth: 0 }}>
        <div className="settings-workbench">
          <div className={`settings-panel settings-panel-${page}`}>
            <Activity mode={page === 'skills' ? 'visible' : 'hidden'}>
              <SkillSettings />
            </Activity>
            <Activity mode={page === 'mcp' ? 'visible' : 'hidden'}>
              <McpSettings agents={members} />
            </Activity>
          </div>
        </div>
      </main>
    </div>
  )
}
Object.assign(window, {
  capabilityTest: {
    settle: () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)))
      ),
    requests,
    holdReveal: () => {
      revealWait = new Promise((resolve) => {
        releaseReveal = resolve
      })
    },
    releaseReveal: () => releaseReveal?.(),
    holdToggle: () => {
      toggleWait = new Promise((resolve) => {
        releaseToggle = resolve
      })
    },
    releaseToggle: () => releaseToggle?.(),
    folderSelections: () => folderSelections,
    cancelFolder: () => {
      folderResult = null
    },
    conflict: () => {
      conflict = true
    },
    snapshot: () => {
      const root = Array.from(document.querySelectorAll<HTMLElement>('.capability-workspace')).find(
        (n) => n.getBoundingClientRect().width > 0
      )!
      const rect = (selector: string) => {
        const r = root.querySelector(selector)!.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      return {
        width: root.getBoundingClientRect().width,
        list: rect('.capability-library'),
        detail: rect('.capability-detail'),
        compact: root.dataset.compact,
        text: root.innerText,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        checkboxes: root.querySelectorAll('[type="checkbox"]').length,
        background: getComputedStyle(root).backgroundColor
      }
    }
  }
})
createRoot(document.getElementById('root')!).render(<Fixture />)
