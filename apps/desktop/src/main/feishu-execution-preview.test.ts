import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CardActionEvent, LarkChannel } from '@larksuiteoapi/node-sdk'
import { describe, expect, it, vi } from 'vitest'
import { executionConsoleCard, executionConsolePageCount } from '../shared/execution-presentation/feishu-card'
import { feishuExecutionPreviewFixture } from './feishu-execution-preview-fixture'
import {
  createFeishuExecutionPreviewHost,
  FeishuExecutionPreviewService,
  parseFeishuPreviewRequest,
  readFeishuPreviewOwner,
  type FeishuPreviewOwner
} from './feishu-execution-preview'

const requestId = '9e4669d9-3d1f-41cd-aa68-bb9717e9e58c'
const agentId = 'agent_8'
const appId = 'cli_preview'
const owner: FeishuPreviewOwner = {
  accountId: 'account_preview', displayName: '惠', openId: 'ou_owner',
  openIdDigest: `sha256:${createHash('sha256').update('feishu-open\0ou_owner').digest('hex')}`
}

type Element = { tag: string; content?: string; expanded?: boolean; elements?: Element[];
  element_id?: string; columns?: Element[]; behaviors?: Array<{ value: Record<string, unknown> }> }
const elements = (card: Record<string, unknown>): Element[] => (card.body as { elements: Element[] }).elements
const outerPanel = (card: Record<string, unknown>): Element => elements(card).find(item => item.element_id === 'execution_process')!
const flatten = (items: Element[]): Element[] => items.flatMap(item => [item, ...flatten(item.elements ?? []), ...flatten(item.columns ?? [])])

function harness(counts = [100, 200]) {
  const sent: Record<string, unknown>[] = []
  const create = vi.fn(async (args: { data: { content: string } }) => {
    sent.push(JSON.parse(args.data.content))
    return { code: 0, data: { message_id: `om_preview_${sent.length}` } }
  })
  const get = vi.fn(async (args: { path: { message_id: string } }) => ({
    code: 0, data: { items: [{ message_id: args.path.message_id, sender: { id: appId }, msg_type: 'interactive' }] }
  }))
  const updateCard = vi.fn(async (_messageId: string, _card: object) => undefined)
  const channel = { rawClient: { im: { v1: { message: { create, get } } } }, updateCard } as unknown as Pick<LarkChannel, 'rawClient' | 'updateCard'>
  const readOwner = vi.fn(() => ({ ...owner }))
  const report = vi.fn()
  let now = 1000
  const service = new FeishuExecutionPreviewService({ requestId, agentId, commandCounts: counts }, {
    readOwner, report, now: () => now
  })
  const action = (pageIndex = 1, count = counts[0]): CardActionEvent => ({
    messageId: `om_preview_${counts.indexOf(count) + 1}`, chatId: 'oc_preview',
    operator: { openId: owner.openId }, raw: { operator: { open_id: owner.openId }, app_id: appId },
    action: { tag: 'button', value: { action: 'execution_console_page',
      agentRunId: `feishu-preview:${requestId}:${agentId}:${count}`, snapshotSequence: 1, pageIndex } }
  })
  return { service, channel, sent, create, get, updateCard, readOwner, report, action,
    advanceClock: (milliseconds: number) => { now += milliseconds } }
}

describe('opt-in Feishu execution-card previews', () => {
  it('does nothing without an explicit bounded local request', () => {
    expect(parseFeishuPreviewRequest(['Rovai AI'])).toBeNull()
    expect(createFeishuExecutionPreviewHost([], '/does-not-exist')).toBeUndefined()
    expect(parseFeishuPreviewRequest([`--feishu-execution-preview=${requestId}/agent_8/100,200`]))
      .toEqual({ requestId, agentId, commandCounts: [100, 200] })
    for (const value of ['0', '201', '100,100', '100,200,31', 'NaN', '1.5', '-1']) {
      expect(() => parseFeishuPreviewRequest([`--feishu-execution-preview=${requestId}/agent_8/${value}`])).toThrow()
    }
    expect(() => parseFeishuPreviewRequest([`--feishu-execution-preview=${requestId}/../100`])).toThrow()
  })

  it.each([[31, 3], [100, 7], [200, 14]])('renders all %i commands over %i bounded mixed-timeline pages', (count, expectedPages) => {
    const snapshot = feishuExecutionPreviewFixture('fixture', '惠', count)
    expect(executionConsolePageCount(snapshot)).toBe(expectedPages)
    let total = 0
    for (let pageIndex = 0; pageIndex < expectedPages; pageIndex += 1) {
      const card = executionConsoleCard(snapshot, { pageIndex, outerExpanded: true })
      const items = elements(card)
      const timeline = outerPanel(card).elements!
      const panels = timeline.filter(item => item.tag === 'collapsible_panel')
      expect(outerPanel(card).expanded).toBe(true)
      expect(panels).toHaveLength(Math.min(15, count - pageIndex * 15))
      expect(flatten(items).length).toBeLessThanOrEqual(50)
      expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThanOrEqual(24000)
      expect(JSON.stringify(card)).not.toMatch(/preview-only-|这段测试正文必须隐藏/u)
      expect(timeline).toContainEqual({ tag: 'markdown', content: `第 ${pageIndex + 1} / ${expectedPages} 页`, text_align: 'center' })
      expect(items.findIndex(item => item.tag === 'markdown')).toBeLessThan(items.findIndex(item => item.tag === 'collapsible_panel'))
      for (const panel of panels) {
        expect(panel.expanded).toBe(false)
        expect(panel.elements).toHaveLength(1)
        const frame = panel.elements![0].content!
        expect(frame.startsWith('```text\n')).toBe(true)
        expect(frame.endsWith('\n```')).toBe(true)
        expect(frame.slice(8, -4).split('\n').length).toBeLessThanOrEqual(20)
      }
      total += panels.length
    }
    expect(total).toBe(count)
  })

  it('sends two labelled cards only to the bound Owner and does not resend on channel reconnection', async () => {
    const h = harness()
    await h.service.connected('other-agent', appId, h.channel)
    expect(h.readOwner).not.toHaveBeenCalled()
    await h.service.connected(agentId, appId, h.channel)
    expect(h.create).toHaveBeenCalledTimes(2)
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      params: { receive_id_type: 'open_id' }, data: expect.objectContaining({ receive_id: owner.openId, uuid: expect.any(String) })
    }))
    expect(JSON.stringify(h.sent)).toContain('没有实际执行')
    expect(h.sent.every(card => outerPanel(card).expanded === false)).toBe(true)
    await h.service.connected(agentId, appId, h.channel)
    expect(h.create).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(h.report.mock.calls)).not.toContain(owner.openId)
    expect(JSON.stringify(h.report.mock.calls)).not.toContain('om_preview_')
  })

  it('updates exactly once per valid click, including repeated pages and each last page', async () => {
    const h = harness()
    await h.service.connected(agentId, appId, h.channel)
    for (const [index, [count, page]] of [[100, 1], [100, 6], [200, 13], [200, 13], [200, 0]].entries()) {
      const response = await h.service.handleCardAction(appId, h.action(page, count), h.channel)
      expect(response).toEqual({})
      expect(h.updateCard).toHaveBeenCalledTimes(index + 1)
      const patched = h.updateCard.mock.calls.at(-1)![1] as Record<string, unknown>
      expect(outerPanel(patched).expanded).toBe(true)
      expect(outerPanel(patched).elements).toContainEqual({ tag: 'markdown', content: `第 ${page + 1} / ${count === 100 ? 7 : 14} 页`, text_align: 'center' })
      expect(response).not.toHaveProperty('card')
    }
    expect(h.create).toHaveBeenCalledTimes(2)
  })

  it('does not intercept real execution cards or project-picker callbacks', async () => {
    const h = harness()
    await h.service.connected(agentId, appId, h.channel)
    for (const value of [{ action: 'execution_console_page', agentRunId: 'real-run' }, { rovaiAction: 'bind_project' }]) {
      const event = h.action()
      event.action.value = value
      expect(await h.service.handleCardAction(appId, event, h.channel)).toBeNull()
    }
    expect(h.updateCard).not.toHaveBeenCalled()
  })

  it('fails closed on wrong Owner, app, message, snapshot, range and payload-spoofed identity', async () => {
    const h = harness()
    await h.service.connected(agentId, appId, h.channel)
    const mutations: Array<(event: CardActionEvent) => void> = [
      event => { event.operator.openId = 'ou_other' },
      event => { event.messageId = 'om_other' },
      event => { event.raw = { operator: { open_id: 'ou_other' } } },
      event => { event.raw = { app_id: 'cli_other' } },
      event => { (event.action.value as Record<string, unknown>).snapshotSequence = 2 },
      event => { (event.action.value as Record<string, unknown>).pageIndex = -1 },
      event => { (event.action.value as Record<string, unknown>).pageIndex = 7 },
      event => { (event.action.value as Record<string, unknown>).pageIndex = 1.5 },
      event => {
        event.operator.openId = 'ou_other'
        ;(event.action.value as Record<string, unknown>).operatorOpenId = owner.openId
      }
    ]
    for (const mutate of mutations) {
      const event = h.action()
      mutate(event)
      expect((await h.service.handleCardAction(appId, event, h.channel))?.toast?.type).toBe('warning')
    }
    expect((await h.service.handleCardAction('cli_other', h.action(), h.channel))?.toast?.type).toBe('warning')
    expect(h.updateCard).not.toHaveBeenCalled()
  })

  it('rejects expired or changed publication/Owner bindings and redacts failed API diagnostics', async () => {
    const h = harness()
    await h.service.connected(agentId, appId, h.channel)
    h.readOwner.mockReturnValueOnce({ ...owner, accountId: 'different-account' })
    expect((await h.service.handleCardAction(appId, h.action(), h.channel))?.toast?.type).toBe('warning')
    h.updateCard.mockRejectedValueOnce(new Error('Authorization: Bearer should-not-be-logged'))
    expect((await h.service.handleCardAction(appId, h.action(), h.channel))?.toast?.type).toBe('error')
    expect(JSON.stringify(h.report.mock.calls)).not.toContain('should-not-be-logged')
    h.advanceClock(6 * 60 * 60_000)
    expect((await h.service.handleCardAction(appId, h.action(), h.channel))?.toast?.type).toBe('warning')
    expect(h.updateCard).toHaveBeenCalledTimes(1)
  })

  it('answers a stalled preview patch within the callback deadline without retrying or claiming success', async () => {
    const h = harness([31])
    await h.service.connected(agentId, appId, h.channel)
    let release!: () => void
    const patch = new Promise<undefined>(resolve => { release = () => resolve(undefined) })
    h.updateCard.mockReturnValueOnce(patch)
    vi.useFakeTimers()
    try {
      let response: unknown
      const pending = h.service.handleCardAction(appId, h.action(), h.channel).then(value => { response = value })
      await vi.advanceTimersByTimeAsync(2500)
      expect(response).toEqual({ toast: { type: 'error', content: '翻页响应超时，请稍后重试' } })
      release()
      await pending
      await vi.advanceTimersByTimeAsync(0)
      expect(h.updateCard).toHaveBeenCalledTimes(1)
      expect(h.report).not.toHaveBeenCalledWith(expect.objectContaining({ stage: 'page_updated' }))
    } finally {
      release()
      vi.useRealTimers()
    }
  })

  it('reads only the exact published Bot and frozen app-scoped Owner from a read-only store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovai-preview-owner-'))
    const path = join(root, 'fixture.sqlite')
    const db = new DatabaseSync(path)
    try {
      db.exec(`
        CREATE TABLE feishu_member_bot(agent_id TEXT, app_id TEXT, account_id TEXT, bot_display_name TEXT, status TEXT);
        CREATE TABLE feishu_account(id TEXT, brand TEXT);
        CREATE TABLE feishu_owner_identity(account_id TEXT, canonical_owner_principal_id TEXT);
        CREATE TABLE feishu_owner_app_identity(account_id TEXT, app_id TEXT, open_id_digest TEXT);
        CREATE TABLE external_principal_app_identity(principal_id TEXT, provider TEXT, app_id TEXT, identity_kind TEXT, external_id TEXT);
      `)
      db.prepare('INSERT INTO feishu_member_bot VALUES (?, ?, ?, ?, ?)').run(agentId, appId, owner.accountId, owner.displayName, 'published')
      db.prepare('INSERT INTO feishu_account VALUES (?, ?)').run(owner.accountId, 'feishu')
      db.prepare('INSERT INTO feishu_owner_identity VALUES (?, ?)').run(owner.accountId, 'owner-principal')
      db.prepare('INSERT INTO feishu_owner_app_identity VALUES (?, ?, ?)').run(owner.accountId, appId, owner.openIdDigest)
      db.prepare('INSERT INTO external_principal_app_identity VALUES (?, ?, ?, ?, ?)').run('owner-principal', 'feishu', appId, 'open_id', owner.openId)
      expect(readFeishuPreviewOwner(path, agentId, appId)).toEqual(owner)
      expect(() => readFeishuPreviewOwner(path, agentId, 'cli_other')).toThrow('feishu_preview_owner_unavailable')
      db.prepare('UPDATE feishu_owner_app_identity SET open_id_digest = ?').run('sha256:wrong')
      expect(() => readFeishuPreviewOwner(path, agentId, appId)).toThrow('feishu_preview_owner_unavailable')
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
