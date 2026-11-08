import { afterEach, expect, it, vi } from 'vitest'
import type { StoredCommandResult, ThreadMessageView } from '@contracts'
import { MessageReeditStore } from '../../desktop/src/renderer/src/message-reedit-store'
import { MessageWithdrawal } from '../../desktop/src/renderer/src/message-withdrawal'
import { ConsoleClient } from './client'
import { createThreadAdapter } from './camp-adapter'

afterEach(() => vi.unstubAllGlobals())

// Owns the actual transport -> Thread adapter -> withdrawal -> copy-store seam.
// ConsoleClient deliberately settles the original Promise through reconciliation.
it.each(['lookup', 'late-lookup', 'core-error-lookup', 'retry', 'direct'] as const)(
  'uses the correct editing deadline when the original Web Promise settles through %s', async mode => {
  let now = 1_000_000, recorded = false, withdrawals = 0
  const requests: unknown[] = []
  let reply: ((response: Response) => void) | undefined
  const values = new Map<string, string>()
  const storage = {
    get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) }
  }
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const applied = { status: 'applied' } as StoredCommandResult
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64),
      clientId: 'b'.repeat(64), editorProof: 'c'.repeat(64), ownerId: 'local_user' })
    const { operation, params } = JSON.parse(String(init?.body))
    if (operation === 'thread.messages.withdraw') {
      withdrawals++; requests.push(params)
      if (mode === 'direct') return new Promise(resolve => { reply = resolve })
      if (mode === 'core-error-lookup') return Response.json({ error: { code: 'post_commit_error', message: 'reply failed after commit' } })
      if (mode === 'retry' && withdrawals > 1) return Response.json({ result: applied })
      throw new TypeError('response lost')
    }
    if (operation === 'commands.reconcile') {
      if (mode === 'core-error-lookup') return new Promise(resolve => { reply = resolve })
      return Response.json({ result: recorded ? { state: 'recorded', result: applied } : { state: 'unknown' } })
    }
    return Response.json({ result: {} })
  })
  const transport = new ConsoleClient('http://localhost:4317', fetcher)
  await transport.login('test')
  const client = createThreadAdapter(transport, async () => null).environment.client
  const store = new MessageReeditStore(client.reeditScope!, storage, () => now)
  const withdrawal = new MessageWithdrawal({ store,
    request: request => client.withdrawMessage!(request),
    accepted: vi.fn(), refresh: async () => undefined, notify: vi.fn(), rejectionMessage: () => 'rejected'
  })
  try {
    const pending = withdrawal.withdraw('thread', { id: 'message', version: 1, withdrawn: false, canWithdraw: true,
      body: 'original', content: [{ kind: 'text', text: 'original' }] } as ThreadMessageView)
    if (mode === 'direct' || mode === 'core-error-lookup') await vi.waitFor(() => expect(reply).toBeDefined())
    else {
      await vi.waitFor(() => expect(transport.connectionState).toBe('offline'))
      await transport.reconcilePending() // Finish the immediate unknown lookup before advancing time.
    }
    now += mode === 'late-lookup' ? 125_000 : 90_000
    if (mode === 'late-lookup') store.sweep()
    if (mode === 'direct') reply!(Response.json({ result: applied }))
    else if (mode === 'core-error-lookup') reply!(Response.json({ result: { state: 'recorded', result: applied } }))
    else if (mode === 'retry') await transport.retryPending()
    else { recorded = true; await transport.reconcilePending() }
    await pending
    expect(withdrawals).toBe(mode === 'retry' ? 2 : 1)
    expect(requests.every(request => JSON.stringify(request) === JSON.stringify(requests[0]))).toBe(true)
    if (mode === 'late-lookup') {
      expect(store.readReady('thread', 'message')).toBeNull()
      expect([...values.keys()].some(key => key.startsWith('rovai.message-reedit.v1:'))).toBe(false)
      return
    }
    expect(store.readReady('thread', 'message')).not.toBeNull()
    const key = [...values.keys()].find(key => key.startsWith('rovai.message-reedit.v1:'))!
    expect(JSON.parse(values.get(key)!).expiresAt).toBe(1_000_000 + (mode === 'direct' ? 210_000 : 120_000))
    now += 30_000
    if (mode === 'direct') {
      expect(store.readReady('thread', 'message')).not.toBeNull()
      now += 90_000
    }
    expect(store.readReady('thread', 'message')).toBeNull()
  } finally { transport.clear() }
})
