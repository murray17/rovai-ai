import { describe, expect, it, vi } from 'vitest'
import type { NavigationPreferencesSnapshot, NavigationThreadItem } from '@contracts'
import { chatHasUnread, chatRailHasUnread, navigationThreadHasUnread, navigationThreadReadState, saveNavigationThreadReadState } from './navigation-unread'

const thread: NavigationThreadItem = {
  id: 'rvcamp_01h47kvsy5fk1shh6w1g60eec0', title: 'Concurrent replies', activationState: 'active',
  projectBindingKind: 'quick_chat', projectPath: '', defaultLead: null, marker: 'loading',
  latestCompletionGlobalSequence: 20, lastSeenGlobalSequence: 10,
  lastActivityAt: '', lastActivityGlobalSequence: 0, version: 1
}

describe('navigation read intent', () => {
  it('takes the rail dot from the complete reply index even with a read first page', () => {
    const first = {chatId: 'a', lastReplySequence: 0}
    const offPage = {chatId: 'b', lastReplySequence: 3}
    const index = [first, offPage]
    expect(chatHasUnread(first)).toBe(false)
    expect(chatRailHasUnread(index, {})).toBe(true)
    const states = {b:{manualUnread:false,readThroughReplySequence:3}}
    expect(chatRailHasUnread(index, states)).toBe(false)
    expect(chatRailHasUnread(index, {...states, a: {manualUnread:true,readThroughReplySequence:0}})).toBe(true)
    expect(chatRailHasUnread([first], {b:{manualUnread:true,readThroughReplySequence:0}})).toBe(false)
  })
  it('shows an unread reply while another member is running and retains it after running ends', () => {
    expect(navigationThreadHasUnread(thread)).toBe(true)
    expect(navigationThreadHasUnread({ ...thread, marker: 'none' })).toBe(true)
    expect(navigationThreadHasUnread({ ...thread, lastSeenGlobalSequence: 20 })).toBe(false)
  })

  it('keeps manual unread despite the active Thread being acknowledged in Core', () => {
    const read = { ...thread, lastSeenGlobalSequence: 20 }
    const reminder = navigationThreadReadState(read, true)
    expect(navigationThreadHasUnread(read, reminder)).toBe(true)
    expect(read.lastSeenGlobalSequence).toBe(20)
    expect(navigationThreadHasUnread(read, { ...reminder, manualUnread: false })).toBe(false)
  })

  it('marks only the known reply read, leaving running and later replies independent', () => {
    const read = navigationThreadReadState(thread, false)
    expect(navigationThreadHasUnread(thread, read)).toBe(false)
    expect(thread.marker).toBe('loading')
    expect(navigationThreadHasUnread({ ...thread, latestCompletionGlobalSequence: 21 }, read)).toBe(true)
    expect(navigationThreadReadState(thread, true, read).readThroughGlobalSequence).toBe(20)
    expect(navigationThreadReadState(thread, false, { ...read, readThroughGlobalSequence: 30 }).readThroughGlobalSequence).toBe(30)
  })

  it('preserves older marker-only fixtures without inventing unread state', () => {
    expect(navigationThreadHasUnread({ ...thread, lastSeenGlobalSequence: undefined })).toBe(false)
    expect(navigationThreadHasUnread({ ...thread, lastSeenGlobalSequence: undefined, marker: 'unread_completed' })).toBe(true)
  })

  it('reads back an uncertain local write before allowing the Core acknowledgement step', async () => {
    const desired = navigationThreadReadState(thread, false)
    const snapshot: NavigationPreferencesSnapshot = {
      schemaVersion: 8, chatReadStates: {}, pinnedProjectOrder: [], registeredProjects: [], legacyProjectsSynced: true, pins: [],
      removedProjects: [], projectOrder: null, projectNames: {},
      threadReadStates: { [thread.id]: { ...desired, readThroughGlobalSequence: 30 } }
    }
    const owner = { setThreadReadState: vi.fn().mockRejectedValue(new Error('lost receipt')),
      get: vi.fn().mockResolvedValue(snapshot) }
    expect(await saveNavigationThreadReadState(owner, thread.id, desired)).toEqual({ snapshot, confirmed: true })
    expect(owner.setThreadReadState).toHaveBeenCalledExactlyOnceWith(thread.id, desired)
    expect(owner.get).toHaveBeenCalledTimes(1)

    // A later manual reminder cannot be cleared by retrying the old local step.
    snapshot.threadReadStates[thread.id].manualUnread = true
    owner.setThreadReadState.mockClear()
    expect(await saveNavigationThreadReadState(owner, thread.id, desired)).toEqual({ snapshot, confirmed: false })
    expect(snapshot.threadReadStates[thread.id].manualUnread).toBe(true)
    expect(owner.setThreadReadState).toHaveBeenCalledTimes(1)

    // Neither an older watermark nor a degraded/default snapshot proves success.
    snapshot.threadReadStates[thread.id] = { ...desired, readThroughGlobalSequence: 10 }
    expect((await saveNavigationThreadReadState(owner, thread.id, desired)).confirmed).toBe(false)
    snapshot.threadReadStates[thread.id] = desired
    snapshot.readError = 'preferences unavailable'
    expect((await saveNavigationThreadReadState(owner, thread.id, desired)).confirmed).toBe(false)
    owner.get.mockRejectedValue(new Error('read unavailable'))
    expect(await saveNavigationThreadReadState(owner, thread.id, desired)).toEqual({ snapshot: null, confirmed: false })

    // A reliable write receipt does not introduce an extra owner read.
    owner.get.mockClear()
    owner.setThreadReadState.mockResolvedValue(snapshot)
    expect((await saveNavigationThreadReadState(owner, thread.id, desired)).confirmed).toBe(true)
    expect(owner.get).not.toHaveBeenCalled()
  })
})
