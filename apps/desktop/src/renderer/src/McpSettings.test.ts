import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, McpServerView } from '@contracts'
import {
  McpAssignmentWorkbench,
  McpServerLibrary,
  McpSettings,
  bulkAssignmentTargets,
  filterMcpServers,
  importCompatibilityLabel,
  mcpSourceLabel,
  mcpTransportLabel
} from './McpSettings'

describe('MCP settings', () => {
  it('renders a local empty-safe management surface before Core responds', () => {
    const markup = renderToStaticMarkup(createElement(McpSettings, { agents: [agent()] }))

    expect(markup).toContain('class="settings-page-heading"')
    expect(markup).toContain('<h1>MCP 配置</h1>')
    expect(markup).not.toContain('project-hero')
    expect(markup).toContain('从本机 Agent 导入')
    expect(markup).toContain('添加 MCP')
    expect(markup).toContain('正在读取 MCP 配置')
    expect(markup).toContain('队员分配工作台')
    expect(markup).not.toContain('Context7')
    expect(markup).not.toContain('配置和分配从后续新执行开始生效')
  })

  it('renders a searchable assignment workbench with real member avatars and a bounded roster', () => {
    const members = Array.from({ length: 12 }, (_, index) => agent(index))
    const markup = renderToStaticMarkup(createElement(McpAssignmentWorkbench, {
      members,
      servers: [server({ riskLevel: 'high' })],
      busy: null,
      disabled: false,
      onAssignment: () => undefined,
      onBulkAssignment: () => undefined
    }))

    expect(markup).toContain('class="mcp-assignment-workbench"')
    expect(markup).toContain('class="mcp-member-roster"')
    expect(markup.match(/role="option"/g)).toHaveLength(12)
    expect(markup).toContain('class="member-avatar')
    expect(markup).toContain('placeholder="搜索 MCP 名称、连接或来源"')
    expect(markup).toMatch(/mcp-assignment-chooser-heading[\s\S]*mcp-search-field/)
    expect(markup).toContain('只看已分配')
    expect(markup).toContain('选择筛选结果')
    expect(markup).not.toContain('mcp-member-picker')
    expect(markup).not.toContain('mcp-assignment-scope')
    expect(markup).not.toContain('mcp-assignment-option-state')
    expect(markup).not.toContain('高权限')
  })

  it('renders the MCP Library as Skill-family open rows with deterministic marks', () => {
    const docs = server({ assignedAgentIds: ['agent_0', 'agent_1'], riskLevel: 'high' })
    const markup = renderToStaticMarkup(createElement(McpServerLibrary, {
      members: [agent(0), agent(1)],
      servers: [docs],
      busy: null,
      onToggleEnabled: () => undefined,
      onEdit: () => undefined,
      onDelete: () => undefined
    }))

    expect(markup).toContain('class="mcp-server-list"')
    expect(markup).toContain('class="mcp-server-row')
    expect(markup).toContain('--mcp-identity:')
    expect(markup).toContain('用户添加')
    expect(markup).toContain('2 位队员')
    expect(markup.match(/class="member-avatar"/g)).toHaveLength(2)
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('mcp-server-card')
    expect(markup).not.toContain('mcp-risk-badge')
    expect(markup).not.toContain('高权限')
  })

  it('filters large MCP sets by text and assignment state', () => {
    const docs = server()
    const browser = server({
      serverId: 'browser',
      name: 'Playwright',
      endpoint: 'http://127.0.0.1:3333/mcp',
      transport: 'streamable_http',
      assignedAgentIds: []
    })

    expect(filterMcpServers([docs, browser], 'play', 'all', 'agent_0')).toEqual([browser])
    expect(filterMcpServers([docs, browser], '', 'assigned', 'agent_0')).toEqual([docs])
    expect(filterMcpServers([docs, browser], '', 'unassigned', 'agent_0')).toEqual([browser])
    expect(filterMcpServers([docs, browser], '用户添加', 'all')).toEqual([docs, browser])
  })

  it('treats every visible MCP uniformly during bulk selection', () => {
    const standard = server()
    const highRisk = server({ serverId: 'browser', name: 'browser', riskLevel: 'high' })

    expect(bulkAssignmentTargets([standard, highRisk], 'agent_0', true)).toEqual([])
    expect(bulkAssignmentTargets([standard, highRisk], 'agent_1', true)).toEqual([standard, highRisk])
    expect(bulkAssignmentTargets([standard, highRisk], 'agent_0', false)).toEqual([standard, highRisk])
  })

  it('formats transport, source, and import facts deterministically', () => {
    expect(mcpTransportLabel('stdio')).toBe('Stdio')
    expect(mcpTransportLabel('streamable_http')).toBe('Streamable HTTP')
    expect(mcpSourceLabel('builtin')).toBe('Rovai 内置')
    expect(mcpSourceLabel('user')).toBe('用户添加')
    expect(mcpSourceLabel('import')).toBe('本机导入')
    expect(importCompatibilityLabel('portable', 'none')).toBe('可导入')
    expect(importCompatibilityLabel('needs_input', 'none')).toContain('补充')
    expect(importCompatibilityLabel('portable', 'name_conflict')).toBe('名称冲突')
    expect(importCompatibilityLabel('unsupported', 'none')).toBe('不支持自动导入')
  })
})

function agent(index = 0): AgentProfile {
  return {
    agentId: `agent_${index}`,
    displayName: index === 0 ? '沐瓦' : `队员 ${index + 1}`,
    avatarRef: null,
    accent: null,
    teamRole: index === 0 ? '开发者' : '协作者',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: index === 0
      ? {
          adapterKind: 'antigravity-app',
          model: { mode: 'runtime_default' },
          permissions: { adapterKind: 'antigravity-app', schemaVersion: 1, values: {} }
        }
      : null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: index,
    version: 1,
    createdAt: '2026-07-24T00:00:00Z',
    updatedAt: '2026-07-24T00:00:00Z',
    removedAt: null
  }
}

function server(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    serverId: '0241f33e-6ea5-4468-9f55-b048ffbbfdbf',
    transport: 'stdio',
    name: 'docs',
    endpoint: 'node server.mjs',
    enabled: true,
    assignedAgentIds: ['agent_0'],
    source: 'user',
    presetId: null,
    riskLevel: 'standard',
    riskAcknowledged: false,
    definitionJson: '{"mcpServers":{"docs":{"command":"node"}}}',
    ...overrides
  }
}
