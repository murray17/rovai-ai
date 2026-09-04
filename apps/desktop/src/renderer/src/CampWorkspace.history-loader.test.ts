import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CampSnapshot } from '@contracts'
import {
  CampWorkspace,
  campHistoryKeyboardInputMovesEarlier
} from './CampWorkspace'

const createdAt = '2026-09-04T00:00:00Z'

function renderHistoryLoader(hasEarlier = true): string {
  const snapshot: CampSnapshot = {
    schemaVersion: 34,
    throughGlobalSequence: 1,
    camp: {
      id: 'camp-history-loader',
      title: '历史消息',
      activationState: 'active',
      projectBindingKind: 'quick_chat',
      projectPath: '/quick-chat',
      defaultLeadAgentId: 'agent-1',
      membershipGeneration: 1,
      version: 1,
      createdAt,
      updatedAt: createdAt
    },
    members: [],
    membershipReconciliations: [],
    tasks: [],
    messages: [],
    messageDeliveries: [],
    turns: [],
    agentRuns: [],
    executionEvidence: [],
    agentRunFileChanges: [],
    contextManifests: [],
    approvals: [],
    actions: [],
    timeline: []
  }

  return renderToStaticMarkup(createElement(CampWorkspace, {
    snapshot,
    messageHistory: {
      loadedCount: 20,
      totalCount: 28,
      omittedCount: 8,
      complete: !hasEarlier,
      oldestLoadedSequence: 9,
      newestLoadedSequence: 28,
      hasEarlier
    },
    onLoadEarlierMessages: async () => undefined,
    projectName: null,
    agents: [],
    busy: false,
    onSend: async () => undefined,
    onChangeLead: async () => undefined,
    onTasksChanged: async () => undefined,
    onResolveApproval: () => undefined,
    stopping: false,
    onStop: () => undefined,
    worldMapEnabled: false
  }))
}

describe('Camp history loader', () => {
  it('keeps the manual history entry as a native text button with coverage', () => {
    const markup = renderHistoryLoader()
    const loader = markup.match(/<div class="camp-history-loader[^>]*>[\s\S]*?<\/div>/)?.[0]

    expect(loader).toContain('class="camp-history-loader is-idle"')
    expect(loader).toContain('<button class="camp-history-text-button" type="button">')
    expect(loader).toContain('<span aria-hidden="true">↑</span><span>加载更早消息</span>')
    expect(loader).toContain('已显示 20 / 28 条')
    expect(loader).not.toContain('quiet-button compact')
    expect(loader).not.toContain('camp-history-error"')
  })

  it('hides the history entry when there are no earlier messages', () => {
    expect(renderHistoryLoader(false)).not.toContain('camp-history-loader')
  })

  it.each([
    ['ArrowUp', false],
    ['PageUp', false],
    ['Home', false],
    [' ', true]
  ])('recognizes %s as an upward history input', (key, shiftKey) => {
    expect(campHistoryKeyboardInputMovesEarlier(key, shiftKey)).toBe(true)
  })

  it.each([
    ['ArrowDown', false],
    ['PageDown', false],
    ['End', false],
    [' ', false]
  ])('does not treat %s as an upward history input', (key, shiftKey) => {
    expect(campHistoryKeyboardInputMovesEarlier(key, shiftKey)).toBe(false)
  })
})
