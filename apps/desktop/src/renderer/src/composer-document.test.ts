import { describe, expect, it } from 'vitest'
import {
  composerDocumentFromLegacyContent,
  composerDocumentStatus,
  composerDocumentToPlainText,
  composerDocumentToStructuredContent,
  normalizeComposerDocument,
  parseComposerClipboardDocument,
  recoverComposerClipboardDocument,
  validateComposerDocument
} from './composer-document'

const members = [{ agentId: 'agent-a', displayName: '洛可', mentionable: true }]
const skills = [{
  id: 'skill-review',
  name: 'review-pr',
  description: '检查改动',
  origin: 'official' as const
}]

describe('ComposerDocument V2', () => {
  it('normalizes empty and adjacent text while preserving Atom identity', () => {
    expect(normalizeComposerDocument({
      version: 2,
      segments: [
        { kind: 'text', text: '请 ' },
        { kind: 'text', text: '' },
        { kind: 'text', text: '让 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'text', text: ' 检查' }
      ]
    })).toEqual({
      version: 2,
      segments: [
        { kind: 'text', text: '请 让 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'text', text: ' 检查' }
      ]
    })
  })

  it('converts the legacy authoring shape one way and projects messages at send time', () => {
    const document = composerDocumentFromLegacyContent([
      { kind: 'text', text: '请 ' },
      { kind: 'member_mention', agentId: 'agent-a' },
      { kind: 'all_members_mention' },
      { kind: 'skill_mention', skillId: 'skill-review', nameAtSend: 'review-pr' }
    ])

    expect(document).toEqual({
      version: 2,
      segments: [
        { kind: 'text', text: '请 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'atom', atom: { type: 'all_members' } },
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'skill-review', nameAtSend: 'review-pr' }
        }
      ]
    })
    expect(composerDocumentToStructuredContent(document)).toEqual([
      { kind: 'text', text: '请 ' },
      { kind: 'member_mention', agentId: 'agent-a' },
      { kind: 'all_members_mention' },
      { kind: 'skill_mention', skillId: 'skill-review', nameAtSend: 'review-pr' }
    ])
  })

  it('derives plain text from current Member names and stable Skill names', () => {
    expect(composerDocumentToPlainText({
      version: 2,
      segments: [
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a', labelFallback: '旧名字' } },
        { kind: 'text', text: ' 使用 ' },
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'skill-review', nameAtSend: 'review-pr' }
        },
        { kind: 'text', text: '\n下一项' }
      ]
    }, members)).toBe('@洛可 使用 /review-pr\n下一项')
  })

  it('validates the V2 envelope, Atom identities and Skill snapshot names', () => {
    expect(validateComposerDocument({ version: 2, segments: [] })).toBe(true)
    expect(validateComposerDocument({ version: 1, segments: [] })).toBe(false)
    expect(validateComposerDocument({
      version: 2,
      segments: [{ kind: 'atom', atom: { type: 'member', agentId: ' agent-a' } }]
    })).toBe(false)
    expect(validateComposerDocument({
      version: 2,
      segments: [{
        kind: 'atom',
        atom: { type: 'skill', skillId: 'skill-review', nameAtSend: '**review**' }
      }]
    })).toBe(false)
    expect(validateComposerDocument({ version: 2, segments: [], selection: {} })).toBe(false)
    expect(validateComposerDocument({
      version: 2,
      segments: [{
        kind: 'atom',
        atom: { type: 'member', agentId: 'agent-a', presentationState: 'available' }
      }]
    })).toBe(false)
    expect(validateComposerDocument({
      version: 2,
      segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent\u0000a' } }]
    })).toBe(false)
    expect(validateComposerDocument({
      version: 2,
      segments: [{ kind: 'atom', atom: { type: 'member', agentId: '界'.repeat(86) } }]
    })).toBe(false)
    expect(validateComposerDocument({
      version: 2,
      segments: [{
        kind: 'atom',
        atom: { type: 'member', agentId: 'agent-a', labelFallback: '𠮷'.repeat(121) }
      }]
    })).toBe(false)
  })

  it('fails closed instead of dropping Core-owned legacy message segments', () => {
    expect(() => composerDocumentFromLegacyContent([
      { kind: 'current_user_mention', userId: 'local_user' }
    ])).toThrow('cannot migrate')
  })

  it('restores only resolvable structured clipboard identities and degrades the rest visibly', () => {
    const encoded = JSON.stringify({
      version: 2,
      segments: [
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'text', text: ' /literal ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-missing', labelFallback: '离队成员' } },
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'skill-missing', nameAtSend: 'old-skill' }
        }
      ]
    })
    const parsed = parseComposerClipboardDocument(encoded)

    expect(parsed).not.toBeNull()
    expect(recoverComposerClipboardDocument(parsed!, members, skills)).toEqual({
      version: 2,
      segments: [
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'text', text: ' /literal @离队成员/old-skill' }
      ]
    })
    expect(parseComposerClipboardDocument('[{"kind":"member_mention","agentId":"agent-a"}]'))
      .toBeNull()
  })

  it('reports only small local status and treats whitespace as empty', () => {
    expect(composerDocumentStatus({
      version: 2,
      segments: [
        { kind: 'text', text: ' \n' },
        { kind: 'atom', atom: { type: 'all_members' } },
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'missing', nameAtSend: 'missing-skill' }
        }
      ]
    }, members, skills)).toEqual({
      hasContent: true,
      hasExplicitRecipient: true,
      hasUnavailableAtom: true
    })
  })
})
