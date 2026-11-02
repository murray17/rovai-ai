import { Activity, useState } from 'react'
import type { NativeSkillDiagnostic } from '../../../packages/contracts/src/index'
import { createRoot } from 'react-dom/client'
import { NativeSkillsSettings, ToolboxSettings } from '../../../apps/desktop/src/renderer/src/RebuiltSkillsSettings'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/App'
import { maskMcpJson } from '../../../apps/desktop/src/renderer/src/McpJsonEditor'
import { McpSettings } from '../../../apps/desktop/src/renderer/src/McpSettings'
import { agent, server } from './data'
import '../../../apps/desktop/src/renderer/src/styles.css'

const members = Array.from({ length: 12 }, (_, i) => agent(i))
const requests: { method: string; params: any }[] = []
let conflict = false
let configReadFailure = false
let remountMcp: () => void = () => {}
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
let failToolboxSave = false
let deleteWait: Promise<void> | null = null
let releaseDelete: (() => void) | undefined
let failDelete = false
let contentHold: { path: string; wait: Promise<void>; release: () => void } | null = null
let contentFailure: string | null = null
let nativeDiagnostics: NativeSkillDiagnostic[] = []
let nativeContent: string | null = null
let nativeListHold: { wait: Promise<void>; release: () => void } | null = null
let releaseNativeList: (() => void) | undefined
let copiedDiagnostic = ''
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { copiedDiagnostic = value } } })

const longPreviewPath = 'references/project-specific-workflows/acceptance-and-review/long-file-name-long-file-name-long-file-name-checklist.md'
const previewPaths = [
  'SKILL.md', 'LICENSE', 'agents/openai.yaml', 'assets/icon.png', 'references/guide.md',
  'references/large.md', 'notes/guide.md', longPreviewPath,
  ...Array.from({ length: 4 }, (_, index) => `references/check-${index + 1}.md`)
]
const nativeSkills = ['ui-ux-pro-max', 'design-review'].map((name, index) => ({
  id: `native-${index + 1}`, name, description: '本机原生 Skill',
  entryPath: `/fixture/native/${name}/SKILL.md`, canonicalPath: `/fixture/native/${name}/SKILL.md`,
  sourceScope: 'user' as const, adapterKind: 'codex-cli' as const
}))
let toolbox = [{ name: 'member-studio', description: '创建队员', memberIds: ['agent_0'], version: '1', sourceError: null }]
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
const text =
  '---\nname: ui-ux-pro-max\ndescription: UI design guidance\n---\n\n# 界面设计与实现\n\n从已有界面出发，让每个操作清晰、直接。\n\n## 使用方式\n\n1. 理解当前页面的主要任务。\n2. 保留熟悉的视觉风格和交互。\n3. 检查键盘操作、窄窗口和深色模式。\n\n## 设计原则\n\n- 主要内容优先，低频信息按需展开。\n- 原生 Skills 保持只读。\n- 工具箱按队员配置。'
Object.assign(window, {
  rovai: {
    onEvent: () => () => {},
    request: async (method: string, params: any = {}) => {
      requests.push({ method, params })
      if (method === 'mcp.servers.delete') {
        if (deleteWait) {
          await deleteWait
          deleteWait = null
        }
        if (failDelete) {
          failDelete = false
          throw new Error('删除失败，请重试。')
        }
      }
      if (method === 'nativeSkills.list') {
        const result = { skills: structuredClone(nativeSkills), diagnostics: structuredClone(nativeDiagnostics) }
        const hold = nativeListHold
        nativeListHold = null
        if (hold) await hold.wait
        return result
      }
      if (method === 'nativeSkills.read') {
        const paths = params.skillId === 'native-2' ? ['SKILL.md'] : previewPaths
        const status = params.path === 'assets/icon.png' ? 'binary'
          : params.path === 'references/large.md' ? 'too_large' : 'text'
        const result = {
          path: params.path,
          status,
          content: status !== 'text' ? null : nativeContent ?? (params.skillId === 'native-2' ? '# 单文件 Skill\n\n独立的说明内容。' :
            params.path === 'SKILL.md'
              ? text +
                '\n\n' +
                Array.from(
                  { length: 24 },
                  (_, i) => '## 参考段落 ' + (i + 1) + '\n\n内容与操作位于同一工作区。'
                ).join('\n\n')
              : params.path === 'agents/openai.yaml' ? 'interface:\n  display_name: "Fixture Skill"\n' : '参考内容。'),
          files: paths.map(path => ({ path, bytes: 500 }))
        }
        if (contentHold?.path === params.path) await contentHold.wait
        if (contentFailure === params.path) {
          contentFailure = null
          throw new Error('暂时无法读取该文件，请重试。')
        }
        return result
      }
      if (method === 'toolbox.list') return structuredClone(toolbox)
      if (method === 'toolbox.read') return { content: '# 创建队员\n\n先确认身份卡，再创建队员。' }
      if (method === 'toolbox.setMembers') {
        if (failToolboxSave) { failToolboxSave = false; throw new Error('暂时无法保存队员配置。') }
        const skill = toolbox.find(item => item.name === params.command.skillName)!
        if (skill.version !== params.command.expectedVersion) return { status: 'rejected', code: 'toolbox.members.conflict', payload: {} }
        skill.memberIds = params.command.memberIds
        skill.version = String(Number(skill.version) + 1)
        return { status: 'applied', payload: { version: skill.version } }
      }
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
      if (method === 'mcp.config.get') {
        if (configReadFailure) throw new Error('暂时无法读取 MCP 配置。')
        return structuredClone(config)
      }
      if (method === 'mcp.import.scan')
        return {
          configDigest: config.configDigest,
          sources: [{ sourceKind: 'cursor', sourcePath: '/fixture/unreadable.json', status: 'invalid', candidateCount: 0, issue: null }],
          candidates: [
            ...[
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
            })),
            {
              candidateId: 'local-tools-second', proposedName: 'local-tools', sourceKind: 'claude_code',
              sourcePath: '/fixture/claude/mcp.json', compatibility: 'portable', conflict: 'none',
              normalizedDefinitionJson: JSON.stringify({ mcpServers: { 'local-tools': { command: 'different-node' } } }), issues: []
            },
            {
              candidateId: 'blocked-codex', proposedName: 'botmux', sourceKind: 'codex',
              sourcePath: '/fixture/codex/config.toml', compatibility: 'unsupported', conflict: 'none',
              normalizedDefinitionJson: null,
              issues: [{ code: 'mcp.import_unknown_field', kind: 'blocker', blocking: true, field: 'env_vars', message: 'Unrecognized field env_vars blocks automatic import' }]
            },
            {
              candidateId: 'blocked-claude', proposedName: 'botmux', sourceKind: 'claude_code',
              sourcePath: '/fixture/claude.json', compatibility: 'unsupported', conflict: 'none',
              normalizedDefinitionJson: null,
              issues: ['REQUIRED', 'SOCKET'].map(suffix => ({ code: 'mcp.import_reference_unsupported', kind: 'blocker', blocking: true,
                field: 'env.BOTMUX_MCP_GATEWAY_' + suffix,
                message: '待配置：此字段使用了无法无损迁移的来源引用语法。' }))
            }
          ]
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
      if (method === 'mcp.servers.delete' && params.expectedConfigDigest !== config.configDigest)
        return { status: 'conflict', actualConfigDigest: config.configDigest }
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
  const [page, setPage] = useState<'mcp' | 'skills' | 'toolbox'>('skills')
  const [mcpEpoch, setMcpEpoch] = useState(0)
  remountMcp = () => setMcpEpoch(value => value + 1)
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
          <button className="quiet-button" id="nav-toolbox" onClick={() => setPage('toolbox')}>工具箱</button>
          <button className="quiet-button" id="nav-mcp" onClick={() => setPage('mcp')}>
            MCP
          </button>
        </div>
      </aside>
      <main className="content settings-content" style={{ flex: 1, minWidth: 0 }}>
        <div className="settings-workbench">
          <div className={`settings-panel settings-panel-${page}`}>
            <Activity mode={page === 'skills' ? 'visible' : 'hidden'}>
              <NativeSkillsSettings />
            </Activity>
            <Activity mode={page === 'toolbox' ? 'visible' : 'hidden'}><ToolboxSettings agents={members} /></Activity>
            <Activity mode={page === 'mcp' ? 'visible' : 'hidden'}>
              <McpSettings key={mcpEpoch} agents={members} />
            </Activity>
          </div>
        </div>
      </main>
    </div>
  )
}
Object.assign(window, {
  capabilityTest: {
    setNativeDiagnostics: (value: NativeSkillDiagnostic[]) => { nativeDiagnostics = value },
    setNativeContent: (value: string | null) => { nativeContent = value },
    copiedDiagnostic: () => copiedDiagnostic,
    holdNativeList: () => {
      let release = () => {}
      const wait = new Promise<void>((resolve) => { release = resolve })
      nativeListHold = { wait, release }
      releaseNativeList = release
    },
    releaseNativeList: () => { releaseNativeList?.() },
    settle: () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)))
      ),
    requests,
    resetMcp: (fail = false) => { config.servers = []; configReadFailure = fail; remountMcp() },
    restoreConfigRead: () => { configReadFailure = false },
    longPreviewPath,
    holdContent: (path: string) => {
      let release!: () => void
      const wait = new Promise<void>(resolve => { release = resolve })
      contentHold = { path, wait, release }
    },
    releaseContent: () => {
      contentHold?.release()
      contentHold = null
    },
    failContent: (path: string) => { contentFailure = path },
    holdReveal: () => {
      revealWait = new Promise((resolve) => {
        releaseReveal = resolve
      })
    },
    releaseReveal: () => releaseReveal?.(),
    failToolboxSave: () => { failToolboxSave = true },
    holdDelete: (fail = false) => {
      failDelete = fail
      deleteWait = new Promise(resolve => { releaseDelete = resolve })
    },
    releaseDelete: () => releaseDelete?.(),
    changeMcpWhileDeleting: () => {
      config.servers = config.servers.map(s => s.name === 'new-connection' ? { ...s, name: 'updated-connection' } : s)
      config.configDigest += '-external'
      window.dispatchEvent(new Event('focus'))
    },
    conflict: () => {
      conflict = true
    },
    snapshot: () => {
      const root = Array.from(document.querySelectorAll<HTMLElement>('.capability-workspace,.rebuilt-skills-columns')).find(
        (n) => n.getBoundingClientRect().width > 0
      )!
      const rect = (selector: string) => {
        const r = root.querySelector(selector)?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 }
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      return {
        width: root.getBoundingClientRect().width,
        list: rect('.capability-library,.rebuilt-skills-list'),
        detail: rect('.capability-detail,.rebuilt-skills-detail'),
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
