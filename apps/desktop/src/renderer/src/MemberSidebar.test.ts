import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  AdapterKind,
  AgentProfile,
  ProductRuntimeAvailability
} from '@contracts'
import {
  MemberSidebar,
  compactRuntimeState,
  filterMembers
} from './MemberSidebar'

describe('v0.29 member sidebar', () => {
  it('filters only by member name and team role', () => {
    const agents = [
      profile('agent_2', '沐瓦', '开发者', 'present'),
      profile('agent_1', '洛可', '研究员', 'away')
    ]
    expect(filterMembers(agents, '开发')).toEqual([agents[0]])
    expect(filterMembers(agents, '洛可')).toEqual([agents[1]])
    expect(filterMembers(agents, 'secret-match')).toEqual([])
  })

  it('maps Runtime user statuses to three compact projections', () => {
    expect(compactRuntimeState('available')).toBe('available')
    expect(compactRuntimeState('unconfigured')).toBe('neutral')
    expect(compactRuntimeState('authentication_required')).toBe('action')
    expect(compactRuntimeState('checking')).toBe('neutral')
    expect(compactRuntimeState('unknown')).toBe('neutral')
  })

  it('shows an accessible Runtime shortcut and enables local filtering at member 21', () => {
    const agents = Array.from({ length: 21 }, (_, index) => (
      index === 0
        ? {
            ...profile('agent-ready', '沐瓦', '开发者', 'present'),
            runtimeConfiguration: {
              adapterKind: 'codex-cli' as const,
              model: { mode: 'runtime_default' as const },
              permissions: { adapterKind: 'codex-cli' as const, schemaVersion: 1, values: {} }
            },
            runtimeReadiness: { status: 'ready' as const, blockers: [] }
          }
        : profile(`agent-${index}`, `队员 ${index}`, index % 2 ? '研究员' : '设计师', 'present')
    ))
    const markup = renderToStaticMarkup(createElement(MemberSidebar, {
      agents,
      runtimeAvailability: [availability('codex-cli', 'ready')],
      runtimeDiscoveryPending: false,
      selectedAgentId: 'agent-ready',
      onSelect: () => undefined,
      onCreate: () => undefined,
      onReload: async () => undefined
    }))

    expect(markup).toContain('id="member-sidebar-filter"')
    expect(markup).not.toContain('member-context-return')
    expect(markup).toContain('placeholder="名称或团队角色"')
    expect(markup).toContain('沐瓦，Codex CLI，可用；打开运行配置')
    expect(markup).toContain('runtime-available')
    expect(markup).toContain('>✓</span>')
    expect(markup).toContain('aria-label="折叠队员名册"')
    expect(markup).not.toContain('secret-match')
  })

  it.each([0, 1, 13, 20, 21, 100])('renders %i active members without virtualization', (count) => {
    const agents = Array.from({ length: count }, (_, index) => (
      profile(`agent-${index}`, `队员 ${index}`, '测试角色', index % 3 === 0 ? 'away' : 'present')
    ))
    const markup = renderToStaticMarkup(createElement(MemberSidebar, {
      agents,
      runtimeAvailability: [],
      runtimeDiscoveryPending: false,
      selectedAgentId: agents[0]?.agentId ?? null,
      onSelect: () => undefined,
      onCreate: () => undefined,
      onReload: async () => undefined
    }))
    expect(markup.match(/class="member-sidebar-row/g)?.length ?? 0).toBe(count)
    expect(markup.includes('id="member-sidebar-filter"')).toBe(count > 20)
    expect(markup).not.toContain('member-context-return')
    expect(markup).not.toContain('virtualized')
    if (count === 0) expect(markup).toContain('还没有队员')
  })
})

function profile(
  id: string,
  displayName: string,
  teamRole: string,
  presence: AgentProfile['presence']
): AgentProfile {
  return {
    agentId: id,
    displayName,
    avatarRef: null,
    accent: '#39777a',
    teamRole,
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence,
    runtimeConfiguration: null,
    runtimeReadiness: {
      status: 'runtime_not_configured',
      blockers: [{ code: 'runtime_not_configured', detail: null }]
    },
    memberOrder: 0,
    version: 1,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    removedAt: null
  }
}

function availability(
  runtimeKind: AdapterKind,
  status: ProductRuntimeAvailability['status']
): ProductRuntimeAvailability {
  return {
    runtimeKind,
    status,
    checking: false,
    discovery: {
      runtimeKind,
      discoveryStatus: 'found',
      executablePath: '/opt/homebrew/bin/runtime',
      source: 'inherited_path',
      reportedVersion: 'runtime 1.0.0',
      executableFingerprint: 'sha256:test',
      searchGeneration: 1,
      observedAt: '2026-08-01T00:00:00Z',
      diagnosticCode: null
    },
    installationId: `installation-${runtimeKind}`,
    reportedVersion: 'runtime 1.0.0',
    diagnosticCode: null
  }
}
