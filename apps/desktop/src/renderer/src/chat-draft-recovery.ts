import type { ThreadClient } from './camp-client'
import type { RovaiApi, RovaiRequestFailure } from '@contracts'
import { recoverChatEdit, recoverChatSend, type ReturnedChatInput } from './chat-draft'

type ChatCommand = {
  commandId: string
  command: object
}
type Pending = { operation: 'chats.send' | 'chats.pendingInputs.edit'; params: ChatCommand }
type Receipt = { state: 'unknown' | 'recorded'; error?: unknown; result?: unknown }
const prefix = (chatId: string) => 'rovai.chat-command:' + chatId + ':'

function keysForChat(chatId: string): string[] {
  const keys: string[] = []
  const chatPrefix = prefix(chatId)
  if (typeof localStorage === 'undefined') return keys
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(chatPrefix)) keys.push(key)
  }
  return keys
}

function entries(chatId: string): [string, Pending][] {
  const pending: [string, Pending][] = []
  for (const key of keysForChat(chatId)) {
    const value = localStorage.getItem(key)
    if (value) pending.push([key, JSON.parse(value) as Pending])
  }
  return pending
}

// Store the original request before IPC. A restart only looks up its receipt.
export const chatDraftRecovery = {
  remember(chatId: string, operation: Pending['operation'], params: ChatCommand) {
    const body = JSON.stringify(params.command)
    const existing = entries(chatId).find(([, item]) =>
      item.operation === operation && JSON.stringify(item.params.command) === body)
    if (existing) return { id: existing[1].params.commandId, reused: true }
    localStorage.setItem(prefix(chatId) + params.commandId, JSON.stringify({ operation, params }))
    return { id: params.commandId, reused: false }
  },
  finish(chatId: string, commandId: string): void {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(prefix(chatId) + commandId)
  },
  has(chatId: string): boolean { return keysForChat(chatId).length > 0 },
  clear(chatId: string): void {
    for (const key of keysForChat(chatId)) localStorage.removeItem(key)
  },
  async restore(chatId: string, request: RovaiApi['request']) {
    let changed = false
    let deferred = false
    for (const [key, { operation, params }] of entries(chatId)) {
      const receipt = await request<Receipt>('commands.reconcile', { operation, params })
      if (receipt.state !== 'recorded') continue
      if (!localStorage.getItem(key)) continue
      if (receipt.result && !receipt.error) {
        if (operation === 'chats.send') {
          recoverChatSend(params.command as ReturnedChatInput & { chatId: string }, receipt.result as { chatId: string })
        } else if (!recoverChatEdit(chatId, receipt.result as ReturnedChatInput, (params.command as { inputId: string }).inputId)) {
          deferred = true
          continue
        }
      }
      changed = true
      localStorage.removeItem(key)
    }
    return { changed, deferred }
  }
}

// A Core rejection is definitive. For generic Core errors, check the receipt before dropping the request.
// Transport loss and failed receipt reads leave the original command available for an explicit retry.
export async function requestChatDraftCommand<T>(client: Pick<ThreadClient, 'request' | 'chatDraftRecovery'>,
  operation: Pending['operation'], params: ChatCommand & { command: { chatId?: string } }) {
  const chatId = params.command.chatId
  if (!chatId || !client.chatDraftRecovery) return client.request<T>(operation, params)
  const recovery = client.chatDraftRecovery
  const original = recovery.remember(chatId, operation, params)
  params.commandId = original.id
  try {
    return await client.request<T>(operation, params)
  } catch (error) {
    const failure = error as Partial<RovaiRequestFailure> | null
    const rejected = failure?.kind === 'domain_rejection' || failure?.code === 'full_core_unavailable'
    if (rejected && !original.reused) {
      recovery.finish(chatId, original.id)
    } else if (rejected || failure?.code === 'CORE_REQUEST_FAILED') {
      const receipt = await client.request<Receipt>('commands.reconcile', { operation, params }).catch(() => null)
      if (receipt?.state === 'recorded' && !receipt.error) return receipt.result as T
      if (receipt) recovery.finish(chatId, original.id)
    }
    throw error
  }
}

export function applyReturnedChatInput(params: ChatCommand & { command: { chatId: string; inputId: string } }, input: ReturnedChatInput): boolean {
  const { chatId, inputId } = params.command
  if (recoverChatEdit(chatId, input, inputId)) {
    chatDraftRecovery.finish(chatId, params.commandId)
    return true
  }
  // The other window filled the draft. The queue receipt owns the returned input until it fits.
  chatDraftRecovery.remember(chatId, 'chats.pendingInputs.edit', params)
  return false
}
