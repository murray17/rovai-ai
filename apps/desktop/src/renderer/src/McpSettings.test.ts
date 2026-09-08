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
  filterMcpServers,
  groupMcpImportCandidates
} from './McpSettings'
import { maskMcpJson, materializeMcpDraft } from './McpJsonEditor'
import { capabilityListWidth, CapabilityToggle } from './CapabilityWorkspace'

describe('MCP workspace', () => {
  it('masks credentials while preserving references, empty values and edits to unrelated fields', () => {
    const raw = JSON.stringify({
      mcpServers: {
        docs: {
          command: 'node',
          env: {
            API_TOKEN: 'fixture-token',
            REF_TOKEN: '${EXISTING}',
            EMPTY: '',
            PADDED: '  info  '
          }
        }
      }
    })
    const masked = maskMcpJson(raw)!
    expect(masked.includes('fixture-token')).toBe(false)
    expect(masked).toContain('${EXISTING}')
    expect(masked).toContain('  info  ')
    const renamed = materializeMcpDraft(masked.replace('"docs"', '"new-name"'), raw)
    const values = JSON.parse(renamed).mcpServers['new-name'].env
    expect(values.API_TOKEN === 'fixture-token').toBe(true)
    expect(values.EMPTY).toBe('')
    const headers = maskMcpJson(
      JSON.stringify({
        mcpServers: {
          remote: {
            url: 'https://example.invalid',
            headers: { Authorization: 'Bearer fixture-auth', 'X-Region': 'cn' }
          }
        }
      })
    )!
    expect(headers.includes('fixture-auth')).toBe(false)
    expect(headers).toContain('cn')
    expect(maskMcpJson('{broken')).toBeNull()
  })

  it('offers a loading-safe split workspace with member permissions and inline local import', () => {
    const markup = renderToStaticMarkup(createElement(McpSettings, { agents: [agent()] }))
    expect(markup).toContain('aria-label="MCP 列表"')
    expect(markup).toContain('从本机导入')
    expect(markup).toContain('正在读取 MCP 配置')
    expect(markup).not.toContain('aria-label="MCP 启用状态"')
    expect(markup).toContain('role="separator"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('配置源文件')
  })

  it('selects whole member rows with real avatars without a member search, without checkboxes', () => {
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
    expect(markup).not.toContain('aria-label="搜索队员"')
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
    expect(markup).not.toContain('已启用')
    expect(markup).not.toContain('高权限')
  })

  it('combines text with enabled and disabled filters', () => {
    const docs = server(),
      browser = server({
        serverId: 'browser',
        name: 'Playwright',
        enabled: false
      })
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
    expect(drafts['candidate-1']).toMatchObject({
      selected: false,
      action: null
    })
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
    expect(markup).toContain('覆盖配置')
    expect(markup).not.toContain('type="checkbox"')
  })

  it('groups by name in scan order without merging definitions or changing the commit identity', () => {
    const first = {
      candidateId: 'codex-first', proposedName: 'docs', sourceKind: 'codex',
      sourcePath: '/fixture/codex/config.toml', compatibility: 'portable',
      conflict: 'name_conflict', normalizedDefinitionJson: server().definitionJson, issues: []
    } as unknown as McpImportInspection['candidates'][number]
    const second = { ...first, candidateId: 'claude-second', proposedName: 'DOCS', sourceKind: 'claude_code' as const,
      sourcePath: '/fixture/claude.json', conflict: 'same' as const }
    const third = { ...second, candidateId: 'claude-third', sourcePath: '/fixture/claude/settings.json' }
    const candidates = [first, second, third]
    const groups = groupMcpImportCandidates(candidates)
    expect(groups).toHaveLength(1)
    expect(groups[0].candidate).toBe(first)
    expect(groups[0].origins).toEqual([first, second])
    expect(first).not.toHaveProperty('duplicateOfCandidateId')
    const inspection = { configDigest: 'digest', sources: [], candidates } as McpImportInspection
    const drafts = buildMcpImportDrafts(inspection, [server()], {
      'claude-second': { selected: true, action: 'replace', definitionJson: 'old hidden edit', open: true }
    })
    expect(Object.keys(drafts)).toEqual(['codex-first'])
    expect(drafts['codex-first'].action).toBeNull()
    // Equal public/masked JSON is not proof of equal private credentials: retain Core's conflict.
    expect(groups[0].candidate.conflict).toBe('name_conflict')
    const markup = renderToStaticMarkup(createElement(McpImportPanel, {
      inspection, drafts: { ...drafts, 'codex-first': { ...drafts['codex-first'], selected: true, open: true } },
      busy: false, onChange: () => {}
    }))
    expect(markup.match(/class="capability-import-item"/g)).toHaveLength(1)
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('来自 Codex')
    expect(markup).toContain('覆盖配置')
    expect(markup).not.toContain('部分来源暂未读取')
  })

  it('honors the first candidate status even when a later runtime has the same name', () => {
    for (const conflict of ['same', 'none'] as const) {
      const first = { candidateId: 'first', proposedName: 'docs', sourceName: 'docs', sourceDefinitionJson: '{}', sourceEnabled: true, sourceKind: 'codex', sourcePath: '/fixture/codex',
        compatibility: conflict === 'same' ? 'portable' : 'unsupported', conflict,
        normalizedDefinitionJson: server().definitionJson, issues: [] } as McpImportInspection['candidates'][number]
      const inspection = { configDigest: 'digest', sources: [], candidates: [first,
        { ...first, candidateId: 'second', sourceKind: 'claude_code', compatibility: 'portable', conflict: 'none' }
      ] } as McpImportInspection
      const markup = renderToStaticMarkup(createElement(McpImportPanel, {
        inspection, drafts: buildMcpImportDrafts(inspection, []), busy: false, onChange: () => {}
      }))
      expect(markup).not.toContain('class="capability-import-item"')
      expect(markup).toContain(conflict === 'same' ? '已添加' : '暂不支持')
      expect(markup).toContain('Claude Code')
    }
  })

  it('keeps a usable detail minimum when a stored splitter preference is restored', () => {
    expect(capabilityListWidth(460, 720)).toBe(329)
    expect(capabilityListWidth(Number.NaN, 1000)).toBe(320)
    expect(capabilityListWidth(100, 1000)).toBe(240)
    expect(capabilityListWidth(700, 1200)).toBe(560)
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
            permissions: {
              adapterKind: 'antigravity-app',
              schemaVersion: 1,
              values: {}
            }
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
