export class SessionRequired extends Error {
  constructor() { super('会话已失效，请重新登录。') }
}

export type WebOperation = 'app.info' | 'navigation.snapshot' | 'navigation.groupCamps' |
  'camp.messages.page' | 'camp.messages.find' | 'members.list' | 'tasks.list' | 'memory.list' |
  'automations.list' | 'runtime.installations.list' | 'runtime.subsystems.get' |
  'skills.list' | 'mcp.config.get'

export type ConnectionState = 'connecting' | 'live' | 'offline' | 'expired'

/** Decodes bounded SSE frames; payloads are invalidations, never private Core events. */
export class InvalidationDecoder {
  #buffer = ''
  push(text: string): boolean {
    this.#buffer += text
    if (this.#buffer.length > 64 * 1024) throw new Error('实时连接的数据超出限制。')
    let changed = false
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.#buffer)
      if (!match) return changed
      const frame = this.#buffer.slice(0, match.index)
      this.#buffer = this.#buffer.slice(match.index + match[0].length)
      if (/^event: ?(?:resync|invalidate)\r?$/m.test(frame)) changed = true
    }
  }
}

export class ConsoleClient {
  readonly origin: string
  #token: string | null = null
  #generation = 0
  #lifetime = new AbortController()
  #fetch: typeof fetch

  constructor(origin: string, fetcher: typeof fetch = fetch) {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('控制台地址无效。')
    this.origin = origin
    // Native Window.fetch requires its Window receiver even when retained by a
    // transport object. Node's implementation does not expose this constraint.
    this.#fetch = fetcher.bind(globalThis)
  }

  async login(administratorToken: string): Promise<void> {
    this.clear()
    const generation = this.#generation
    const response = await this.#fetch(`${this.origin}/api/v1/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ administratorToken }), credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: this.#lifetime.signal
    })
    if (!response.ok) throw new Error(response.status === 429 ? '登录次数过多，请稍后再试。' : '登录失败，请检查管理令牌。')
    const session = await response.json() as { token?: unknown }
    if (generation !== this.#generation) throw new SessionRequired()
    if (typeof session.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error('会话响应无效。')
    this.#token = session.token
  }

  clear(): void {
    this.#token = null
    this.#generation++
    this.#lifetime.abort()
    this.#lifetime = new AbortController()
  }

  async logout(): Promise<void> {
    try { await this.#authorized('logout', { method: 'POST' }) } finally { this.clear() }
  }

  async request<T>(operation: WebOperation, params: unknown = {}): Promise<T> {
    const generation = this.#generation
    const response = await this.#authorized('request', { method: 'POST', body: JSON.stringify({ operation, params }) })
    const body = await response.json() as { result: T; error?: { code?: string } }
    if (generation !== this.#generation) throw new SessionRequired()
    if (body.error) throw new Error(`暂时无法读取此内容（${body.error.code ?? 'request_failed'}）。`)
    return body.result
  }

  async #authorized(path: 'request' | 'events' | 'logout', options: RequestInit = {}): Promise<Response> {
    if (!this.#token) throw new SessionRequired()
    const generation = this.#generation
    const response = await this.#fetch(`${this.origin}/api/v1/${path}`, {
      ...options, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#token}` },
      signal: options.signal ? AbortSignal.any([options.signal, this.#lifetime.signal]) : this.#lifetime.signal
    })
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (response.status === 401) { this.clear(); throw new SessionRequired() }
    if (!response.ok) throw new Error(response.status === 429 ? '请求较多，请稍后重试。' : '连接暂时不可用，请重试。')
    return response
  }

  subscribe(invalidate: () => void, status: (state: ConnectionState) => void): () => void {
    const controller = new AbortController()
    const lifetime = this.#lifetime.signal
    const signal = AbortSignal.any([controller.signal, lifetime])
    const run = async (): Promise<void> => {
      let retry = 1000
      while (!signal.aborted) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          status('connecting')
          const response = await this.#authorized('events', { signal })
          if (!response.body) throw new Error('实时连接不可用。')
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          const frames = new InvalidationDecoder()
          status('live')
          retry = 1000
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (frames.push(decoder.decode(value, { stream: true }))) invalidate()
          }
        } catch (error) {
          if (error instanceof SessionRequired) { status('expired'); return }
          if (signal.aborted) return
        } finally {
          await reader?.cancel().catch(() => undefined)
          reader?.releaseLock()
        }
        if (signal.aborted) return
        status('offline')
        await new Promise<void>((resolve) => {
          const onAbort = (): void => { clearTimeout(timer); resolve() }
          const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, retry)
          signal.addEventListener('abort', onAbort, { once: true })
        })
        retry = Math.min(retry * 2, 30_000)
      }
    }
    void run()
    return () => controller.abort()
  }
}
