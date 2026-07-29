import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, McpServerView } from '@contracts'
import {
  McpSettings,
  importCompatibilityLabel,
  mcpTransportLabel,
  parseArgumentLines,
  serverMemberSummary
} from './McpSettings'

describe('MCP settings', () => {
  it('renders a local empty-safe management surface before Core responds', () => {
    const markup = renderToStaticMarkup(createElement(McpSettings, { agents: [agent()] }))

    expect(markup).toContain('<h2>MCP</h2>')
    expect(markup).toContain('从本机 Agent 导入')
    expect(markup).toContain('添加 MCP')
    expect(markup).toContain('正在读取 MCP Library')
    expect(markup).toContain('Rovai-ai 不修改其他 Agent 的配置')
    expect(markup).not.toContain('Context7')
  })

  it('formats runtime and assignment facts without relying on status color', () => {
    const server: McpServerView = {
      transport: 'stdio',
      name: 'docs',
      enabled: true,
      agentProfileIds: ['agent-muwa'],
      command: 'node',
      args: ['server.mjs'],
      cwd: null,
      env: {},
      missingValues: [],
      issues: []
    }

    expect(mcpTransportLabel('stdio')).toBe('Stdio')
    expect(mcpTransportLabel('streamable_http')).toBe('Streamable HTTP')
    expect(serverMemberSummary(server, [agent()])).toBe('适用成员：沐瓦')
    expect(serverMemberSummary({ ...server, agentProfileIds: [] }, [agent()])).toBe('尚未分配成员')
  })

  it('keeps argument parsing and import labels deterministic', () => {
    expect(parseArgumentLines(' -y \n\n @example/server \r\n')).toEqual(['-y', '@example/server'])
    expect(importCompatibilityLabel('portable', 'none')).toBe('可导入')
    expect(importCompatibilityLabel('needs_input', 'none')).toContain('补充')
    expect(importCompatibilityLabel('portable', 'name_conflict')).toBe('名称冲突')
    expect(importCompatibilityLabel('unsupported', 'none')).toBe('当前不支持')
  })
})

function agent(): AgentProfile {
  return {
    id: 'agent-muwa',
    handle: 'muwa',
    displayName: '沐瓦',
    avatarRef: null,
    personaLabel: null,
    accent: null,
    roleTitle: '开发者',
    roleDescription: '',
    instructions: '',
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
