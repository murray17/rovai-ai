import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CampPendingInputsView } from '@contracts'
import { describe, expect, it } from 'vitest'
import { PendingInputRows } from './PendingCampInputs'

describe('PendingInputRows', () => {
  it('exposes return-to-composer and delete without an editing mode', () => {
    const queue: CampPendingInputsView = { campId: 'camp-1', executionActive: true, editSession: null,
      items: [{ id: 'input-1', campId: 'camp-1', enqueueSequence: 1, revision: 1, state: 'queued',
        content: { version: 2, segments: [{ kind: 'text', text: 'queued message' }] }, body: 'queued message',
        replyIntent: null, recipientSelectionRequired: false, lastAttemptErrorCode: null, attachments: [], quotes: [] }] }
    const render = (disabled = false) => renderToStaticMarkup(createElement(PendingInputRows, {
      queue, disabled, onEdit: () => undefined, onDelete: () => undefined
    }))
    expect(render()).toContain('移回输入框编辑（覆盖当前内容）')
    expect(render()).toContain('删除待发送消息')
    expect(render()).not.toMatch(/is-editing|正在编辑|aria-pressed|>保存<|>取消</)
    expect(render(true)).toContain('disabled=""')
    queue.items = []
    expect(render()).toBe('')
  })
})
