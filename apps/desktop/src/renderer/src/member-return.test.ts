import { describe, expect, it } from 'vitest'
import { memberReturnTargetForSource } from './member-return'

describe('member return target', () => {
  const projectCamp = {
    campId: 'camp-project',
    contextLabel: 'rovai-ai',
    title: '桌面端发布准备'
  }
  const quickChatCamp = {
    campId: 'camp-quick-chat',
    contextLabel: '快速对话',
    title: '交互方案讨论'
  }

  it('keeps directory and Quick Chat Camps as exact conversation targets', () => {
    expect(memberReturnTargetForSource('camp', projectCamp)).toEqual({
      kind: 'conversation',
      ...projectCamp
    })
    expect(memberReturnTargetForSource('camp', quickChatCamp)).toEqual({
      kind: 'conversation',
      ...quickChatCamp
    })
  })

  it.each(['compose', 'memory', 'settings', 'members'] as const)(
    'returns to App when Members opens from %s',
    (sourceView) => {
      expect(memberReturnTargetForSource(sourceView, projectCamp)).toEqual({ kind: 'app' })
    }
  )

  it('fails closed to App when a Camp source has no stable conversation target', () => {
    expect(memberReturnTargetForSource('camp', null)).toEqual({ kind: 'app' })
  })

  it('keeps the stable Camp ID while its display title is still loading', () => {
    expect(memberReturnTargetForSource('camp', {
      campId: 'camp-loading',
      contextLabel: '快速对话',
      title: ''
    })).toEqual({
      kind: 'conversation',
      campId: 'camp-loading',
      contextLabel: '快速对话',
      title: '正在打开对话'
    })
  })
})
