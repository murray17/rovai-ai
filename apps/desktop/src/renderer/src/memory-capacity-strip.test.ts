import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, MemoryCapacity, MemoryLibraryView } from '@contracts'
import { CapacityStrip, memoryCapacityLabel } from './MemoryLibrary'

describe('Memory capacity presentation', () => {
  it('labels every companion capacity and does not silently truncate after six items', () => {
    const agents = Array.from({ length: 7 }, (_, index) => agent(`agent-${index + 1}`, `队员 ${index + 1}`))
    const library: MemoryLibraryView = {
      memories: [],
      capacities: agents.map((profile) => capacity('companion', `companion:${profile.agentId}`, 1, 32, 1, 8))
    }

    const markup = renderToStaticMarkup(createElement(CapacityStrip, {
      library,
      scope: 'companion',
      agents
    }))

    expect(markup.match(/class="memory-capacity-item"/g)).toHaveLength(7)
    expect(markup).toContain('队员 1')
    expect(markup).toContain('队员 7')
    expect(markup).toContain('1/32')
    expect(markup).toContain('1/8')
  })

  it('distinguishes pair capacity from the capacity applicable to one member', () => {
    const agents = [agent('agent-a', '阿青'), agent('agent-b', '小满')]

    expect(memoryCapacityLabel(
      capacity('relationship', 'relationship:agent-a:agent-b', 1, 12, 1, 4),
      agents
    )).toBe('阿青 × 小满')
    expect(memoryCapacityLabel(
      capacity('relationship', 'relationship-applicable:agent-a', 1, 48, 1, 16),
      agents
    )).toBe('适用于 阿青')
  })
})

function agent(agentId: string, displayName: string): AgentProfile {
  return { agentId, displayName } as AgentProfile
}

function capacity(
  scope: MemoryCapacity['scope'],
  scopeKey: string,
  activeCount: number,
  maxCount: number,
  agentOriginCount: number,
  agentOriginMaxCount: number
): MemoryCapacity {
  return {
    scope,
    scopeKey,
    activeCount,
    maxCount,
    activeBodyBytes: 0,
    maxBodyBytes: null,
    agentOriginCount,
    agentOriginMaxCount
  }
}
