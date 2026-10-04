import { describe, expect, it } from 'vitest'
import type { NavigationThreadItem } from '@contracts'
import { navigationThreadHasUnread, navigationThreadReadState } from './navigation-unread'

const thread: NavigationThreadItem = {
  id: 'rvcamp_01h47kvsy5fk1shh6w1g60eec0', title: 'Concurrent replies', activationState: 'active',
  projectBindingKind: 'quick_chat', projectPath: '', defaultLead: null, marker: 'loading',
  latestCompletionGlobalSequence: 20, lastSeenGlobalSequence: 10,
  lastActivityAt: '', lastActivityGlobalSequence: 0, version: 1
}

describe('navigation read intent', () => {
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
})
