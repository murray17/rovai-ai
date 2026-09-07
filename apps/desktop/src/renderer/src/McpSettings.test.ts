import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, McpServerView, McpImportInspection } from '@contracts'
import {
  McpSettings,
  McpListItem,
  McpMemberChoices,
  McpImportPanel,
  buildMcpImportDrafts,
  filterMcpServers
} from './McpSettings'
import { capabilityListWidth, CapabilityToggle } from './CapabilityWorkspace'

describe('MCP workspace', () => {
  it('offers a loading-safe split workspace with state filters and inline local import', () => {
    const markup = renderToStaticMarkup(createElement(McpSettings, { agents: [agent()] }))
    expect(markup).toContain('aria-label="MCP 列表"')
    expect(markup).toContain('从本机导入')
    expect(markup).toContain('正在读取 MCP 配置')
    expect(markup).toContain('aria-label="MCP 启用状态"')
    expect(markup).toContain('role="separator"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('配置源文件')
  })

  it('selects whole member rows with real avatars and text-search, without checkboxes', () => {
    const markup = renderToStaticMarkup(
      createElement(McpMemberChoices, {
        members: Array.from({ length: 12 }, (_, index) => agent(index)),
        server: server(),
        disabled: false,
        onAssignment: () => {}
      })
    )
    expect(markup.match(/class="member-avatar"/g)).toHaveLength(12)
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(11)
    expect(markup).toContain('aria-label="搜索队员"')
    expect(markup).not.toContain('type="checkbox"')
  })

  it('keeps state and connection summary in a compact selectable row', () => {
    const markup = renderToStaticMarkup(
      createElement(McpListItem, {
        server: server(),
        selected: true,
        dirty: true,
        onSelect: () => {}
      })
    )
    expect(markup).toContain('--mcp-identity:')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('未保存 · Stdio · 1 位队员')
    expect(markup).toContain('已启用')
    expect(markup).not.toContain('高权限')
  })

  it('combines text with enabled and disabled filters', () => {
    const docs = server(),
      browser = server({ serverId: 'browser', name: 'Playwright', enabled: false })
    expect(filterMcpServers([docs, browser], 'play', 'disabled')).toEqual([browser])
    expect(filterMcpServers([docs, browser], 'play', 'enabled')).toEqual([])
    expect(filterMcpServers([docs, browser], '', 'enabled')).toEqual([docs])
  })

  it('does not pre-authorize replacing a same-name import and retains explicit edits during a rescan', () => {
    const inspection = {
      configDigest: 'digest',
      sources: [],
      candidates: [
        {
          candidateId: 'candidate-1',
          proposedName: 'docs',
          sourceKind: 'codex',
          compatibility: 'portable',
          conflict: 'name_conflict',
          normalizedDefinitionJson: server().definitionJson,
          issues: []
        }
      ]
    } as unknown as McpImportInspection
    const drafts = buildMcpImportDrafts(inspection, [server()])
    expect(drafts['candidate-1']).toMatchObject({ selected: false, action: null })
    drafts['candidate-1'] = {
      ...drafts['candidate-1'],
      selected: true,
      action: 'create',
      definitionJson: 'edited',
      open: true
    }
    expect(buildMcpImportDrafts(inspection, [server()], drafts)['candidate-1']).toEqual(
      drafts['candidate-1']
    )
    const markup = renderToStaticMarkup(
      createElement(McpImportPanel, {
        inspection,
        drafts,
        busy: false,
        onChange: () => {},
        onScan: () => {},
        onCommit: () => {}
      })
    )
    expect(markup).toContain('另存为')
    expect(markup).toContain('替换现有')
    expect(markup).not.toContain('type="checkbox"')
  })

  it('keeps a usable detail minimum when a stored splitter preference is restored', () => {
    expect(capabilityListWidth(460, 720)).toBe(359)
    expect(capabilityListWidth(Number.NaN, 1000)).toBe(280)
    expect(capabilityListWidth(100, 1000)).toBe(240)
    expect(capabilityListWidth(700, 1200)).toBe(460)
    const markup = renderToStaticMarkup(
      createElement(CapabilityToggle, {
        name: 'docs',
        enabled: false,
        disabled: true,
        onToggle: () => {}
      })
    )
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('aria-label="启用 docs"')
    expect(markup).toContain('disabled=""')
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
    runtimeConfiguration:
      index === 0
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
    riskLevel: 'standard',
    riskAcknowledged: false,
    definitionJson: '{"mcpServers":{"docs":{"command":"node"}}}',
    ...overrides
  }
}
