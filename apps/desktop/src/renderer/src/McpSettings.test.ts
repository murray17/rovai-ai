import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, McpServerView } from '@contracts'
import {
  McpSettings,
  importCompatibilityLabel,
  mcpTransportLabel
} from './McpSettings'

describe('MCP settings', () => {
  it('renders a local empty-safe management surface before Core responds', () => {
    const markup = renderToStaticMarkup(createElement(McpSettings, { agents: [agent()] }))

    expect(markup).toContain('<h2>MCP 配置</h2>')
    expect(markup).toContain('从本机 Agent 导入')
    expect(markup).toContain('添加 MCP')
    expect(markup).toContain('正在读取 MCP 配置')
    expect(markup).toContain('为队员配置 MCP')
    expect(markup).not.toContain('Context7')
  })

  it('formats runtime and assignment facts without relying on status color', () => {
    const server: McpServerView = {
      serverId: '0241f33e-6ea5-4468-9f55-b048ffbbfdbf',
      transport: 'stdio',
      name: 'docs',
      endpoint: 'node server.mjs',
      enabled: true,
      assignedAgentProfileIds: ['agent_2'],
      source: 'user',
      presetId: null,
      riskLevel: 'standard',
      riskAcknowledged: false,
      definitionJson: '{"mcpServers":{"docs":{"command":"node"}}}'
    }

    expect(mcpTransportLabel('stdio')).toBe('Stdio')
    expect(mcpTransportLabel('streamable_http')).toBe('Streamable HTTP')
    expect(server.assignedAgentProfileIds).toEqual(['agent_2'])
  })

  it('keeps import labels deterministic', () => {
    expect(importCompatibilityLabel('portable', 'none')).toBe('可导入')
    expect(importCompatibilityLabel('needs_input', 'none')).toContain('补充')
    expect(importCompatibilityLabel('portable', 'name_conflict')).toBe('名称冲突')
    expect(importCompatibilityLabel('unsupported', 'none')).toBe('不支持自动导入')
  })
})

function agent(): AgentProfile {
  return {
    id: 'agent_2',
    handle: 'muwa',
    displayName: '沐瓦',
    avatarRef: null,
    accent: null,
    teamRole: '开发者',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeSelection: null,
    runtimePreference: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: 0,
    version: 1,
    createdAt: '2026-07-24T00:00:00Z',
    updatedAt: '2026-07-24T00:00:00Z',
    removedAt: null
  }
}
