import { describe, expect, it } from 'vitest'
import {
  deleteStructuredBackward,
  deleteStructuredForward,
  insertAllMembersMention,
  insertAllMembersMentionWithTrailingSpace,
  insertMemberMention,
  insertMemberMentionWithTrailingSpace,
  insertSkillMentionWithTrailingSpace,
  insertStructuredText,
  normalizeStructuredMentionContent,
  pasteStructuredPlainText,
  replaceStructuredSelection,
  selectedStructuredMentionContent,
  skillQueryAtCaret,
  structuredMentionContentLength,
  type StructuredMentionContent,
  type StructuredMentionEditorState
} from './structured-mention-model'

const member = (agentId: string) => ({
  kind: 'member_mention' as const,
  agentId
})

const allMembers = () => ({ kind: 'all_members_mention' as const })
const skill = (skillId: string, nameAtSend: string) => ({
  kind: 'skill_mention' as const,
  skillId,
  nameAtSend
})

describe('Skill queries at the caret', () => {
  it.each(['', '请使用 ', '请使用\t', '请使用\u3000', '请使用：\n', '👩‍💻 ',
    ...[...'，。！？；：、'].map((boundary) => `请使用${boundary}`)
  ])('opens after the safe boundary in %j without depending on the rest of the body', (prefix) => {
    for (const query of ['', 'worktree']) {
      const caret = prefix.length + 1 + query.length
      expect(skillQueryAtCaret([
        { kind: 'text', text: `${prefix}/${query} 再继续` }
      ], { anchor: caret, focus: caret })).toEqual({ start: prefix.length, end: caret, query })
    }
  })

  it.each([
    '', '普通正文', 'https://github.com', 'src/components/chat', 'foo/bar', '请使用/worktree',
    '/work tree', '/work/', '/work@', '/work ', '/work\t', '/work\n', '/work\r', '/work\r\n',
    '/work\u2028', '/work\u3000'
  ])('does not treat %j as an active Skill query', (text) => {
    expect(skillQueryAtCaret([{ kind: 'text', text }], {
      anchor: text.length,
      focus: text.length
    })).toBeNull()
  })

  it('requires a collapsed caret within the current content', () => {
    const content: StructuredMentionContent = [{ kind: 'text', text: '/work' }]
    for (const selection of [
      { anchor: 0, focus: 5 }, { anchor: 5, focus: 0 },
      ...[-1, 0, 1.5, 6, Number.NaN, Number.POSITIVE_INFINITY]
        .map((caret) => ({ anchor: caret, focus: caret }))
    ]) {
      expect(skillQueryAtCaret(content, selection)).toBeNull()
    }
  })

  it.each([member('agent-a'), allMembers(), skill('skill-existing', 'review-pr')])(
    'never starts against or crosses a $kind token',
    (token) => {
      expect(skillQueryAtCaret([token, { kind: 'text', text: '/work' }], {
        anchor: 6, focus: 6
      })).toBeNull()
      expect(skillQueryAtCaret([
        { kind: 'text', text: '/wo' }, token, { kind: 'text', text: 'rk' }
      ], { anchor: 6, focus: 6 })).toBeNull()
      expect(skillQueryAtCaret([token, { kind: 'text', text: ' /work' }], {
        anchor: 7, focus: 7
      })).toEqual({ start: 2, end: 7, query: 'work' })
    }
  )

  it('derives a query from the latest replacement, paste and deletion results', () => {
    const replaced = insertStructuredText({
      content: [{ kind: 'text', text: '请 旧文本 再继续' }],
      selection: { anchor: 5, focus: 2 }
    }, '/')
    expect(replaced.content).toEqual([{ kind: 'text', text: '请 / 再继续' }])
    expect(skillQueryAtCaret(replaced.content, replaced.selection)).toEqual({ start: 2, end: 3, query: '' })

    const pasted = pasteStructuredPlainText(replaced, 'work')
    expect(pasted.content).toEqual([{ kind: 'text', text: '请 /work 再继续' }])
    expect(skillQueryAtCaret(pasted.content, pasted.selection)).toEqual({ start: 2, end: 7, query: 'work' })

    const deleted = deleteStructuredBackward(pasted)
    expect(skillQueryAtCaret(deleted.content, deleted.selection)).toEqual({ start: 2, end: 6, query: 'wor' })

    const removedSlash = deleteStructuredForward({ ...deleted, selection: { anchor: 2, focus: 2 } })
    expect(skillQueryAtCaret(removedSlash.content, removedSlash.selection)).toBeNull()
  })

  it.each([' 再继续', '再继续', '\n再继续', '\u3000再继续'])(
    'replaces only the query and preserves surrounding tokens and suffix %j',
    (suffix) => {
      const prefix = '请先检查模块，然后 '
      const caret = 1 + prefix.length + '/wor'.length
      const content: StructuredMentionContent = [
        member('agent-a'),
        { kind: 'text', text: `${prefix}/wor${suffix}` },
        allMembers(),
        skill('skill-existing', 'review-pr')
      ]
      const query = skillQueryAtCaret(content, { anchor: caret, focus: caret })!
      expect(query).toEqual({ start: 1 + prefix.length, end: caret, query: 'wor' })
      expect(insertSkillMentionWithTrailingSpace({
        content,
        selection: { anchor: query.start, focus: query.end }
      }, 'skill-worktree', 'worktree')).toEqual({
        content: [
          member('agent-a'),
          { kind: 'text', text: prefix },
          skill('skill-worktree', 'worktree'),
          { kind: 'text', text: suffix === '再继续' ? ` ${suffix}` : suffix },
          allMembers(),
          skill('skill-existing', 'review-pr')
        ],
        selection: { anchor: prefix.length + 3, focus: prefix.length + 3 }
      })
    }
  )
})

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

  it('adds a writable space after a selected candidate without duplicating existing whitespace', () => {
    expect(insertMemberMentionWithTrailingSpace({
      content: [{ kind: 'text', text: '请@洛' }],
      selection: { anchor: 1, focus: 3 }
    }, 'agent-a')).toEqual({
      content: [
        { kind: 'text', text: '请' },
        member('agent-a'),
        { kind: 'text', text: ' ' }
      ],
      selection: { anchor: 3, focus: 3 }
    })

    expect(insertMemberMentionWithTrailingSpace({
      content: [{ kind: 'text', text: '请@洛 继续' }],
      selection: { anchor: 1, focus: 3 }
    }, 'agent-a')).toEqual({
      content: [
        { kind: 'text', text: '请' },
        member('agent-a'),
        { kind: 'text', text: ' 继续' }
      ],
      selection: { anchor: 3, focus: 3 }
    })

    expect(insertAllMembersMentionWithTrailingSpace({
      content: [{ kind: 'text', text: '通知@所有\n下一行' }],
      selection: { anchor: 2, focus: 5 }
    })).toEqual({
      content: [
        { kind: 'text', text: '通知' },
        allMembers(),
        { kind: 'text', text: '\n下一行' }
      ],
      selection: { anchor: 4, focus: 4 }
    })
  })

  it('keeps Skill identity atomic while preserving ordinary trailing whitespace', () => {
    expect(insertSkillMentionWithTrailingSpace({
      content: [{ kind: 'text', text: '/rev next' }],
      selection: { anchor: 0, focus: 4 }
    }, 'skill-review', 'review-pr')).toEqual({
      content: [skill('skill-review', 'review-pr'), { kind: 'text', text: ' next' }],
      selection: { anchor: 2, focus: 2 }
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

  it('returns the visible structured selection without splitting atomic tokens', () => {
    expect(selectedStructuredMentionContent({
      content: [
        { kind: 'text', text: '前文' },
        member('agent-a'),
        { kind: 'text', text: '中段' },
        skill('skill-review', 'review-pr'),
        allMembers(),
        { kind: 'text', text: '后文' }
      ],
      selection: { anchor: 7, focus: 1 }
    })).toEqual([
      { kind: 'text', text: '文' },
      member('agent-a'),
      { kind: 'text', text: '中段' },
      skill('skill-review', 'review-pr'),
      allMembers()
    ])
  })

  it('pastes @ and slash text without upgrading either to structured tokens', () => {
    const result = pasteStructuredPlainText({
      content: [member('agent-a')],
      selection: { anchor: 0, focus: 1 }
    }, '@洛可 和 @所有队员 /review-pr')

    expect(result).toEqual({
      content: [{ kind: 'text', text: '@洛可 和 @所有队员 /review-pr' }],
      selection: { anchor: 22, focus: 22 }
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
