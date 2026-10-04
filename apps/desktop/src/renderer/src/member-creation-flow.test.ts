import { describe, expect, it } from 'vitest'
import type { NavigationSnapshot, ThreadCreationPreflight } from '@contracts'
import { emptyLocalThreadComposerDraft } from './camp-composer-local-store'
import { hasMemberCreationInput, memberCreationHelper, navigationWithMemberCreationDrafts, type MemberCreationDraft } from './member-creation-flow'
import { moveRosterMember } from './use-member-reorder'

describe('AI member creation entry', () => {
  const member = (agentId: string, memberOrder: number, runtimeReadiness: 'ready' | 'light_ready' | 'runtime_not_configured' = 'ready') =>
    ({ agentId, displayName: agentId, memberOrder, runtimeReadiness, runtimeConfigured: runtimeReadiness !== 'runtime_not_configured' })
  it('uses successful helper, then available default lead, then stable roster order, or manual creation', () => {
    const preflight: ThreadCreationPreflight = { admissible: true, blockers: [], initialLeadAgentId: 'c', lastMemberCreationHelperAgentId: 'a',
      presentMembers: [member('c', 3), member('b', 1, 'light_ready'), member('a', 2)] }
    expect(memberCreationHelper(preflight, 'c')).toBe('a')
    preflight.presentMembers[2].runtimeConfigured = false
    expect(memberCreationHelper(preflight, 'c')).toBe('c')
    expect(memberCreationHelper(preflight, 'removed-lead')).toBe('b')
    preflight.presentMembers = [member('unconfigured', 0, 'runtime_not_configured')]
    expect(memberCreationHelper(preflight, 'unconfigured')).toBeNull()
    preflight.presentMembers = []
    expect(memberCreationHelper(preflight, null)).toBeNull()
  })
  it('shows meaningful local drafts without changing Core navigation and removes the duplicate on activation', () => {
    const navigation: NavigationSnapshot = { schemaVersion: 3, throughGlobalSequence: 1, projects: [], quickChat: { totalCount: 0, recentThreads: [] } }
    const entry: MemberCreationDraft = { draft: emptyLocalThreadComposerDraft('draft-a'), navigation: {
      id: 'draft-a', title: '', activationState: 'pending', projectBindingKind: 'quick_chat', projectPath: '', defaultLead: null,
      marker: 'none', lastActivityAt: '', lastActivityGlobalSequence: 0, latestCompletionGlobalSequence: 0, version: 1
    } }
    const drafts = new Map([['draft-a', entry]])
    expect(navigationWithMemberCreationDrafts(navigation, drafts)).toBe(navigation)
    entry.draft = { ...entry.draft!, body: 'Create a researcher\nwith a quiet personality' }
    expect(hasMemberCreationInput(entry.draft)).toBe(true)
    expect(navigationWithMemberCreationDrafts(navigation, drafts)?.quickChat.recentThreads[0].title).toBe('Create a researcher')
    expect(navigation.quickChat.totalCount).toBe(0)
    navigation.quickChat = { totalCount: 1, recentThreads: [{ ...entry.navigation, activationState: 'active' }] }
    expect(navigationWithMemberCreationDrafts(navigation, drafts)).toBe(navigation)
    expect(navigationWithMemberCreationDrafts({ ...navigation, quickChat: { totalCount: 0, recentThreads: [] } }, new Map())?.quickChat.totalCount).toBe(0)
  })
  it('moves the selected roster row without losing hidden members', () => {
    expect(moveRosterMember(['a', 'hidden', 'b', 'away'], 'a', 'b')).toEqual(['hidden', 'b', 'a', 'away'])
    expect(moveRosterMember(['a', 'b'], 'gone', 'a')).toEqual(['a', 'b'])
  })
})
