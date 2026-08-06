import { describe, expect, it } from 'vitest'
import {
  deleteStructuredBackward,
  deleteStructuredForward,
  insertAllMembersMention,
  insertMemberMention,
  insertStructuredText,
  normalizeStructuredMentionContent,
  pasteStructuredPlainText,
  replaceStructuredSelection,
  structuredMentionContentLength,
  type StructuredMentionEditorState
} from './structured-mention-model'

const member = (agentId: string) => ({
  kind: 'member_mention' as const,
  agentId
})

const allMembers = () => ({ kind: 'all_members_mention' as const })

describe('structured mention editing model', () => {
  it('drops empty text and merges only adjacent text without deduplicating tokens', () => {
    const input = [
      { kind: 'text' as const, text: '' },
      { kind: 'text' as const, text: '请' },
      { kind: 'text' as const, text: '先处理' },
      member('agent-a'),
      { kind: 'text' as const, text: '' },
      member('agent-a'),
      { kind: 'text' as const, text: '，然后' },
      { kind: 'text' as const, text: '汇总' },
      allMembers(),
      { kind: 'text' as const, text: '' }
    ]

    expect(normalizeStructuredMentionContent(input)).toEqual([
      { kind: 'text', text: '请先处理' },
      member('agent-a'),
      member('agent-a'),
      { kind: 'text', text: '，然后汇总' },
      allMembers()
    ])
    expect(input[1]).toEqual({ kind: 'text', text: '请' })
  })

  it('inserts plain text at the caret and replaces a selection spanning a token', () => {
    const initial: StructuredMentionEditorState = {
      content: [
        { kind: 'text', text: '请' },
        member('agent-a'),
        { kind: 'text', text: '处理' }
      ],
      selection: { anchor: 1, focus: 1 }
    }

    expect(insertStructuredText(initial, '先')).toEqual({
      content: [
        { kind: 'text', text: '请先' },
        member('agent-a'),
        { kind: 'text', text: '处理' }
      ],
      selection: { anchor: 2, focus: 2 }
    })

    expect(insertStructuredText({
      ...initial,
      selection: { anchor: 3, focus: 1 }
    }, '@手写')).toEqual({
      content: [{ kind: 'text', text: '请@手写理' }],
      selection: { anchor: 4, focus: 4 }
    })
  })

  it('keeps repeated member mentions as distinct occurrences', () => {
    const result = insertMemberMention({
      content: [member('agent-a')],
      selection: { anchor: 1, focus: 1 }
    }, 'agent-a')

    expect(result).toEqual({
      content: [member('agent-a'), member('agent-a')],
      selection: { anchor: 2, focus: 2 }
    })
  })

  it('inserts one all-members token instead of expanding members', () => {
    expect(insertAllMembersMention({
      content: [{ kind: 'text', text: '通知' }],
      selection: { anchor: 2, focus: 2 }
    })).toEqual({
      content: [{ kind: 'text', text: '通知' }, allMembers()],
      selection: { anchor: 3, focus: 3 }
    })
  })

  it('Backspace and Delete remove an adjacent token as one atomic unit', () => {
    const content = [
      { kind: 'text' as const, text: 'A' },
      member('agent-a'),
      allMembers(),
      { kind: 'text' as const, text: 'B' }
    ]

    expect(deleteStructuredBackward({
      content,
      selection: { anchor: 2, focus: 2 }
    })).toEqual({
      content: [{ kind: 'text', text: 'A' }, allMembers(), { kind: 'text', text: 'B' }],
      selection: { anchor: 1, focus: 1 }
    })

    expect(deleteStructuredForward({
      content,
      selection: { anchor: 2, focus: 2 }
    })).toEqual({
      content: [{ kind: 'text', text: 'A' }, member('agent-a'), { kind: 'text', text: 'B' }],
      selection: { anchor: 2, focus: 2 }
    })
  })

  it('Backspace and Delete remove one complete grapheme without splitting emoji', () => {
    const family = '👩‍👩‍👧‍👧'
    const content = [{ kind: 'text' as const, text: `A${family}B` }]
    const afterFamily = 1 + family.length

    expect(deleteStructuredBackward({
      content,
      selection: { anchor: afterFamily, focus: afterFamily }
    })).toEqual({
      content: [{ kind: 'text', text: 'AB' }],
      selection: { anchor: 1, focus: 1 }
    })

    expect(deleteStructuredForward({
      content,
      selection: { anchor: 1, focus: 1 }
    })).toEqual({
      content: [{ kind: 'text', text: 'AB' }],
      selection: { anchor: 1, focus: 1 }
    })
  })

  it('deletes a non-collapsed selection including every intersected token', () => {
    expect(replaceStructuredSelection({
      content: [
        { kind: 'text', text: '前' },
        member('agent-a'),
        { kind: 'text', text: '中' },
        allMembers(),
        { kind: 'text', text: '后' }
      ],
      selection: { anchor: 4, focus: 1 }
    }, [])).toEqual({
      content: [{ kind: 'text', text: '前后' }],
      selection: { anchor: 1, focus: 1 }
    })
  })

  it('pastes @ text as text without upgrading it to structured tokens', () => {
    const result = pasteStructuredPlainText({
      content: [member('agent-a')],
      selection: { anchor: 0, focus: 1 }
    }, '@洛可 和 @所有队员')

    expect(result).toEqual({
      content: [{ kind: 'text', text: '@洛可 和 @所有队员' }],
      selection: { anchor: 11, focus: 11 }
    })
    expect(result.content.every((segment) => segment.kind === 'text')).toBe(true)
  })

  it('clamps selections to the model boundary and leaves edge deletion stable', () => {
    const state: StructuredMentionEditorState = {
      content: [{ kind: 'text', text: '正文' }],
      selection: { anchor: -10, focus: -10 }
    }
    expect(deleteStructuredBackward(state)).toEqual({
      content: [{ kind: 'text', text: '正文' }],
      selection: { anchor: 0, focus: 0 }
    })

    const end = structuredMentionContentLength(state.content)
    expect(deleteStructuredForward({
      ...state,
      selection: { anchor: 99, focus: 99 }
    })).toEqual({
      content: [{ kind: 'text', text: '正文' }],
      selection: { anchor: end, focus: end }
    })
  })
})
