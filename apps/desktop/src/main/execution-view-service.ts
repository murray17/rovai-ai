import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type {
  AgentRunExecutionEvidenceView,
  CoreEvent,
  ExecutionWebSettingsSnapshot
} from '@contracts'
import {
  activityStatusForAgentRun,
  buildLiveExecutionProgress,
  liveRuntimeEventFromExecutionEvidence,
  type ActivityIconKind,
  type ActivityStatus
} from '../shared/execution-presentation'
import {
  createExecutionPublicResultProjector,
  createExecutionPublicTextRedactor,
  executionPublicCommandTitle
} from '../shared/execution-presentation/public-result'
import {
  groupConsecutiveToolItems,
  toolActivityGroupPresentation
} from '../shared/execution-presentation/tool-grouping'
import type { CoreClient } from './core-client'
import { EXECUTION_VIEW_PAGE } from './execution-view-page'
import {
  ExecutionWebSettingsStore,
  isExecutionWebPort
} from './execution-web-settings'

const SSE_HEARTBEAT_MS = 20_000
const IGNORED_INTERFACE = /^(?:lo|docker|veth|br-|bridge|utun|vmnet|vbox|awdl|llw)/iu
const PREFERRED_INTERFACE = /^(?:en[01]|wlan|wifi|ethernet|eth)/iu

export type ExecutionViewScope = {
  channelConversationId: string
  targetAppId: string
  campId: string
  agentId: string
  focusRunId: string
  maxRunCreatedAt: string
}

type CoreExecutionWebRun = {
  id: string
  campTurnId: string
  purpose: string
  invocationKind: string
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  waitReason: string | null
  terminalReasonCode: string | null
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  trigger: {
    summary: string
    authorDisplayName: string
    channelLabel: string
    createdAt: string
  }
  evidence: AgentRunExecutionEvidenceView[]
  publicOutput: string | null
  fileChanges: {
    files: Array<{
      path: string
      additions?: number
      deletions?: number
    }>
  } | null
}

type CoreExecutionWebSnapshot = {
  schemaVersion: 1
  focusRunId: string
  camp: { id: string; title: string }
  agent: { id: string; displayName: string }
  runs: CoreExecutionWebRun[]
}

type PublicExecutionActivity = {
  iconKind: ActivityIconKind
  title: string
  status: ActivityStatus
  statusLabel: string
  result: string | null
  files: Array<{ path: string; additions: number | null; deletions: number | null }>
}

type PublicExecutionItem =
  | { kind: 'narration'; body: string }
  | {
    kind: 'activityGroup'
    status: ActivityStatus
    statusLabel: string
    primary: string
    currentTitle: string | null
    accessibleLabel: string
    activities: PublicExecutionActivity[]
  }

type PublicExecutionSnapshot = {
  schemaVersion: 1
  focusRunId: string
  terminal: boolean
  camp: { id: string; title: string }
  agent: { id: string; displayName: string }
  runs: Array<{
    id: string
    status: CoreExecutionWebRun['status']
    createdAt: string
    startedAt: string | null
    endedAt: string | null
    purpose: string
    trigger: CoreExecutionWebRun['trigger']
    items: PublicExecutionItem[]
  }>
}

type Grant = {
  scope: Readonly<ExecutionViewScope>
  clients: Set<ServerResponse>
  refresh: Promise<void>
}

type Listener = { server: Server; address: string; port: number }

export type ExecutionViewServiceDependencies = {
  core: Pick<CoreClient, 'request' | 'onEvent'>
  settingsFilePath: string
  resolveAddress?: () => string | null
  randomToken?: () => string
  createHttpServer?: typeof createServer
}

export class ExecutionViewService {
  readonly #dependencies: ExecutionViewServiceDependencies
  readonly #listeners = new Set<(snapshot: ExecutionWebSettingsSnapshot) => void>()
  readonly #grants = new Map<string, Grant>()
  #store: ExecutionWebSettingsStore | null = null
  #listener: Listener | null = null
  #state: ExecutionWebSettingsSnapshot['server'] = {
    state: 'disabled', address: null, errorCode: null
  }
  #unsubscribeCore: (() => void) | null = null
  #heartbeat: ReturnType<typeof setInterval> | null = null
  #mutationTail: Promise<void> = Promise.resolve()

  constructor(dependencies: ExecutionViewServiceDependencies) {
    this.#dependencies = dependencies
  }

  async start(): Promise<void> {
    if (this.#store) return
    this.#store = await ExecutionWebSettingsStore.load(this.#dependencies.settingsFilePath)
    this.#unsubscribeCore = this.#dependencies.core.onEvent((event) => this.#handleCoreEvent(event))
    this.#heartbeat = setInterval(() => this.#writeHeartbeat(), SSE_HEARTBEAT_MS)
    const settings = this.#store.get()
    if (!settings.enabled) {
      this.#setState('disabled')
      return
    }
    await this.#activate(settings.port)
  }

  async stop(): Promise<void> {
    await this.#enqueueMutation(async () => {
      this.#unsubscribeCore?.()
      this.#unsubscribeCore = null
      if (this.#heartbeat) clearInterval(this.#heartbeat)
      this.#heartbeat = null
      this.#invalidateAllGrants()
      const listener = this.#listener
      this.#listener = null
      if (listener) await closeServer(listener.server)
      this.#setState('disabled')
    })
  }

  onChanged(listener: (snapshot: ExecutionWebSettingsSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSettings(): ExecutionWebSettingsSnapshot {
    const settings = this.#store?.get() ?? { schemaVersion: 1 as const, enabled: false, port: 8765 }
    return { ...settings, server: { ...this.#state } }
  }

  async setSettings(next: { enabled: boolean; port: number }): Promise<ExecutionWebSettingsSnapshot> {
    return this.#enqueueMutation(async () => {
      if (!this.#store) throw new Error('execution_web_service_not_started')
      if (typeof next.enabled !== 'boolean' || !isExecutionWebPort(next.port)) {
        throw new Error('execution_web_settings_invalid')
      }
      const current = this.#store.get()
      if (current.enabled === next.enabled && current.port === next.port) return this.getSettings()

      if (!next.enabled) {
        await this.#store.set(next)
        this.#invalidateAllGrants()
        const listener = this.#listener
        this.#listener = null
        if (listener) await closeServer(listener.server)
        this.#setState('disabled')
        return this.getSettings()
      }

      await this.#store.set(next)
      await this.#activate(next.port)
      return this.getSettings()
    })
  }

  async createExecutionViewUrl(scope: ExecutionViewScope): Promise<string | null> {
    return this.#enqueueMutation(async () => {
      const settings = this.#store?.get()
      if (!settings?.enabled) return null
      let listener = this.#listener

      // The URL is frozen once per card, but its address is selected at card
      // creation time. A changed interface rebinds only the one global service;
      // old card URLs and grants are intentionally not repaired.
      const currentAddress = this.#resolveAddress()
      if (!listener || this.#state.state !== 'ready' || currentAddress !== listener.address) {
        await this.#activate(settings.port, currentAddress)
        listener = this.#listener
      }
      if (!listener || this.#state.state !== 'ready') return null

      const token = this.#dependencies.randomToken?.() ?? randomBytes(32).toString('base64url')
      if (token.length < 32) throw new Error('execution_web_token_entropy_insufficient')
      const tokenHash = hashToken(token)
      this.#grants.set(tokenHash, {
        scope: Object.freeze({ ...scope }),
        clients: new Set(),
        refresh: Promise.resolve()
      })
      return `http://${listener.address}:${listener.port}/execution/${encodeURIComponent(scope.focusRunId)}#t=${token}`
    })
  }

  revokeExecutionViewUrl(url: string | null): void {
    if (!url) return
    try {
      const token = new URL(url).hash.slice(1)
      const value = new URLSearchParams(token).get('t')
      if (value) this.#invalidateGrant(hashToken(value))
    } catch { /* A malformed presentation URL has no live grant to revoke. */ }
  }

  async #activate(port: number, address = this.#resolveAddress()): Promise<void> {
    const previous = this.#listener
    if (previous) {
      // A configured address/port change intentionally makes every old card
      // URL stale. End live streams before waiting for Node to close the old
      // listener; otherwise an SSE response can keep the rebind pending forever.
      this.#invalidateAllGrants()
      this.#listener = null
      await closeServer(previous.server)
    }
    this.#setState('starting')
    const listener = await this.#openListener(port, address)
    if (!listener) return
    this.#listener = listener
    this.#setState('ready', `${listener.address}:${listener.port}`)
  }

  async #openListener(port: number, address: string | null): Promise<Listener | null> {
    if (!address) {
      this.#setState('no_lan_address', null, 'execution_web_no_lan_address')
      return null
    }
    const serverFactory = this.#dependencies.createHttpServer ?? createServer
    const server = serverFactory((request, response) => {
      void this.#handleRequest(request, response).catch(() => {
        if (!response.headersSent) {
          applySecurityHeaders(response)
          sendEmpty(response, 503)
        } else if (!response.writableEnded) {
          response.end()
        }
      })
    })
    try {
      await listen(server, address, port)
      return { server, address, port }
    } catch (error) {
      await closeServer(server)
      const code = error instanceof Error && 'code' in error
        ? String((error as NodeJS.ErrnoException).code ?? '') : ''
      this.#setState(
        code === 'EADDRINUSE' ? 'port_conflict' : 'error',
        null,
        code === 'EADDRINUSE' ? 'execution_web_port_conflict' : 'execution_web_bind_failed'
      )
      return null
    }
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response)
    if (request.method !== 'GET' || !request.url || !this.#listener) {
      sendEmpty(response, 404)
      return
    }
    if (request.headers.host !== `${this.#listener.address}:${this.#listener.port}`) {
      sendEmpty(response, 421)
      return
    }
    const url = new URL(request.url, `http://${request.headers.host}`)
    const pageMatch = url.pathname.match(/^\/execution\/([A-Za-z0-9_-]{1,200})$/u)
    if (pageMatch) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Connection': 'close'
      })
      response.end(EXECUTION_VIEW_PAGE)
      return
    }
    const endpoint = url.pathname.match(/^\/api\/execution\/([A-Za-z0-9_-]{1,200})\/(snapshot|events)$/u)
    if (!endpoint) {
      sendEmpty(response, 404)
      return
    }
    const grantEntry = this.#authorizedGrant(request, endpoint[1])
    if (!grantEntry) {
      sendEmpty(response, 401)
      return
    }
    const [tokenHash, grant] = grantEntry
    if (endpoint[2] === 'snapshot') {
      const snapshot = await this.#readPublicSnapshot(grant)
      if (!snapshot) {
        this.#invalidateGrant(tokenHash)
        sendEmpty(response, 410)
        return
      }
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Connection': 'close'
      })
      response.end(JSON.stringify(snapshot))
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    grant.clients.add(response)
    request.once('close', () => grant.clients.delete(response))
    const snapshot = await this.#readPublicSnapshot(grant)
    if (!snapshot) {
      writeSse(response, { type: 'invalidated' })
      response.end()
      this.#invalidateGrant(tokenHash)
      return
    }
    writeSse(response, { type: snapshot.terminal ? 'terminal' : 'snapshot', snapshot })
    if (snapshot.terminal) response.end()
  }

  #authorizedGrant(request: IncomingMessage, runId: string): [string, Grant] | null {
    const authorization = request.headers.authorization
    if (!authorization?.startsWith('Bearer ')) return null
    const token = authorization.slice('Bearer '.length)
    if (!token) return null
    const tokenHash = hashToken(token)
    const grant = this.#grants.get(tokenHash)
    return grant?.scope.focusRunId === runId ? [tokenHash, grant] : null
  }

  async #readPublicSnapshot(grant: Grant): Promise<PublicExecutionSnapshot | null> {
    const raw = await this.#dependencies.core.request<CoreExecutionWebSnapshot | null>(
      'channels.executionConsole.webSnapshot',
      grant.scope
    )
    return raw ? publicExecutionSnapshot(raw) : null
  }

  #handleCoreEvent(event: CoreEvent): void {
    if (!event.method.startsWith('agent_run.')) return
    for (const [tokenHash, grant] of this.#grants) {
      if (!grant.clients.size) continue
      grant.refresh = grant.refresh.then(async () => {
        if (!grant.clients.size || !this.#grants.has(tokenHash)) return
        try {
          const snapshot = await this.#readPublicSnapshot(grant)
          if (!snapshot) {
            for (const client of grant.clients) {
              writeSse(client, { type: 'invalidated' })
              client.end()
            }
            this.#invalidateGrant(tokenHash)
            return
          }
          for (const client of [...grant.clients]) {
            writeSse(client, { type: snapshot.terminal ? 'terminal' : 'snapshot', snapshot })
            if (snapshot.terminal) client.end()
          }
        } catch { /* A later Core event will retry; the AgentRun remains unaffected. */ }
      })
    }
  }

  #writeHeartbeat(): void {
    for (const grant of this.#grants.values()) {
      for (const client of grant.clients) {
        if (!client.destroyed && !client.writableEnded) client.write(': keep-alive\n\n')
      }
    }
  }

  #invalidateGrant(tokenHash: string): void {
    const grant = this.#grants.get(tokenHash)
    if (!grant) return
    this.#grants.delete(tokenHash)
    for (const client of grant.clients) {
      if (!client.writableEnded) client.end()
    }
    grant.clients.clear()
  }

  #invalidateAllGrants(): void {
    for (const tokenHash of [...this.#grants.keys()]) this.#invalidateGrant(tokenHash)
  }

  #resolveAddress(): string | null {
    return this.#dependencies.resolveAddress
      ? this.#dependencies.resolveAddress()
      : selectPrivateLanAddress()
  }

  #enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  #setState(
    state: ExecutionWebSettingsSnapshot['server']['state'],
    address: string | null = null,
    errorCode: string | null = null
  ): void {
    this.#state = { state, address, errorCode }
    const snapshot = this.getSettings()
    for (const listener of this.#listeners) listener(snapshot)
  }
}

export function selectPrivateLanAddress(
  interfaces: NodeJS.Dict<ReturnType<typeof networkInterfaces>[string]> = networkInterfaces()
): string | null {
  return Object.entries(interfaces)
    .flatMap(([name, addresses]) => (addresses ?? []).flatMap((address) => {
      if (address.internal || address.family !== 'IPv4' || IGNORED_INTERFACE.test(name)
        || !isPrivateIpv4(address.address)) return []
      return [{ name, address: address.address, preferred: PREFERRED_INTERFACE.test(name) }]
    }))
    .sort((left, right) => Number(right.preferred) - Number(left.preferred)
      || left.name.localeCompare(right.name) || left.address.localeCompare(right.address))[0]?.address ?? null
}

function isPrivateIpv4(value: string): boolean {
  const octets = value.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

function publicExecutionSnapshot(raw: CoreExecutionWebSnapshot): PublicExecutionSnapshot {
  const runs = raw.runs.map((run) => {
    const events = run.evidence.map(liveRuntimeEventFromExecutionEvidence)
    const redact = createExecutionPublicTextRedactor(events, run.id)
    const projectResult = createExecutionPublicResultProjector(events, run.id)
    const progress = buildLiveExecutionProgress(events, run.id, { textMode: 'complete' })
    const groupedItems = groupConsecutiveToolItems(progress.items)
    const trailingItem = groupedItems.at(-1)
    const items = groupedItems.flatMap((item): PublicExecutionItem[] => {
      if (item.kind === 'toolGroup') {
        const presentation = toolActivityGroupPresentation(
          item.items,
          run.status,
          run.status === 'running' && item === trailingItem
        )
        return [{
          kind: 'activityGroup',
          status: presentation.status,
          statusLabel: presentation.statusLabel,
          primary: presentation.primary,
          currentTitle: presentation.currentTitle
            ? redact(presentation.currentTitle)
            : null,
          accessibleLabel: redact(presentation.accessibleLabel),
          activities: item.items.map(({ step }) => {
            const status = activityStatusForAgentRun(step.status, run.status)
            return {
              iconKind: step.iconKind,
              title: executionPublicCommandTitle(step, redact),
              status,
              statusLabel: activityLabel(status),
              result: projectResult(step),
              files: step.fileChanges?.map((file) => ({
                path: file.path,
                additions: file.additions,
                deletions: file.deletions
              })) ?? []
            }
          })
        }]
      }
      if (item.kind !== 'narration') return []
      const body = redact(item.body).trim()
      return body ? [{ kind: 'narration', body }] : []
    })
    const output = redact(run.publicOutput?.trim() ?? '')
    if (output && !items.some((item) => item.kind === 'narration' && item.body === output)) {
      items.push({ kind: 'narration', body: output })
    }
    if (run.fileChanges?.files.length && !items.some((item) => item.kind === 'activityGroup'
      && item.activities.some((activity) => activity.files.length))) {
      items.push({
        kind: 'activityGroup',
        status: 'recorded',
        statusLabel: '已记录',
        primary: '已汇总 1 项操作',
        currentTitle: null,
        accessibleLabel: '已汇总 1 项操作；状态：已记录',
        activities: [{
          iconKind: 'file',
          title: '文件变化',
          status: 'recorded',
          statusLabel: '已记录',
          result: null,
          files: run.fileChanges.files.map((file) => ({
            path: file.path,
            additions: Number.isFinite(file.additions) ? file.additions ?? null : null,
            deletions: Number.isFinite(file.deletions) ? file.deletions ?? null : null
          }))
        }]
      })
    }
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      purpose: bounded(redact(run.trigger.summary || run.purpose), 240),
      trigger: {
        summary: bounded(redact(run.trigger.summary), 2_000),
        authorDisplayName: '你',
        channelLabel: '',
        createdAt: run.trigger.createdAt
      },
      items
    }
  })
  const focus = runs.find((run) => run.id === raw.focusRunId)
  return {
    schemaVersion: 1,
    focusRunId: raw.focusRunId,
    terminal: Boolean(focus && isTerminal(focus.status)),
    camp: { id: raw.camp.id, title: bounded(raw.camp.title, 120) },
    agent: { id: raw.agent.id, displayName: bounded(raw.agent.displayName, 80) },
    runs
  }
}

function activityLabel(status: string): string {
  return ({ running: '执行中', completed: '已完成', waiting: '等待中', failed: '失败', stopped: '已停止', recorded: '已记录' } as Record<string, string>)[status] ?? status
}

function isTerminal(status: CoreExecutionWebRun['status']): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

function bounded(value: string, limit: number): string {
  const characters = Array.from(value.trim())
  return characters.length <= limit ? characters.join('') : `${characters.slice(0, limit - 1).join('')}…`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'Connection': 'close' })
  response.end()
}

function writeSse(response: ServerResponse, value: unknown): void {
  if (!response.destroyed && !response.writableEnded) {
    response.write(`data: ${JSON.stringify(value)}\n\n`)
  }
}

function listen(server: Server, address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => reject(error)
    server.once('error', fail)
    server.listen({ host: address, port, exclusive: true }, () => {
      server.off('error', fail)
      resolve()
    })
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}
