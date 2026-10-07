// Research client for the user's installed Cline Hub. No Cline SDK or runtime
// code is imported. This transport never retries a command after uncertainty.
import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

export async function readOwnedDiscovery(path, root) {
  const canonicalRoot = await realpath(root)
  const canonicalPath = await realpath(path)
  const inside = relative(canonicalRoot, canonicalPath)
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('Discovery is outside the owned probe directory')
  }
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
      || (process.getuid && metadata.uid !== process.getuid())) {
    throw new Error('Discovery must be an owner-only regular file')
  }
  const record = JSON.parse(await readFile(path, 'utf8'))
  const url = new URL(record.url)
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1'
      || url.username || url.password || url.search || url.hash
      || record.host !== '127.0.0.1' || Number(url.port) !== record.port
      || !Number.isSafeInteger(record.pid) || record.pid <= 0
      || typeof record.authToken !== 'string' || !record.authToken
      || record.protocolVersion !== 'v1') {
    throw new Error('Unsupported or unsafe Hub discovery record')
  }
  return record
}

export function openHubSocket(url, token, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, token ? [`cline-hub-auth.${token}`] : [])
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeEventListener('error', failed)
      socket.removeEventListener('close', closed)
      if (error) {
        socket.close()
        reject(error)
      } else resolve(socket)
    }
    const failed = () => finish(new Error('Hub WebSocket connection rejected'))
    const closed = () => finish(new Error('Hub closed before connection opened'))
    const timer = setTimeout(() => finish(new Error('Hub connection timed out')), timeoutMs)
    socket.addEventListener('error', failed)
    socket.addEventListener('close', closed)
    socket.addEventListener('open', () => finish(), { once: true })
  })
}

export class NativeHubClient {
  constructor(socket, onEvent = () => {}) {
    this.socket = socket
    this.clientId = `rovai-research-${randomUUID()}`
    this.pending = new Map()
    this.onEvent = onEvent
    socket.addEventListener('message', ({ data }) => {
      try {
        const frame = JSON.parse(String(data))
        if (frame.kind === 'reply') {
          const pending = this.pending.get(frame.envelope?.requestId)
          if (!pending) return
          this.pending.delete(frame.envelope.requestId)
          clearTimeout(pending.timer)
          pending.resolve(frame.envelope)
        } else if (frame.kind === 'event') this.onEvent(frame.envelope)
      } catch {
        this.rejectPending('Malformed Hub frame; command outcome may be unknown')
        socket.close()
      }
    })
    socket.addEventListener('close', () => this.rejectPending('Hub disconnected; command outcome may be unknown'))
    socket.addEventListener('error', () => this.rejectPending('Hub transport failed; command outcome may be unknown'))
  }

  static async connect(discovery, onEvent) {
    return new NativeHubClient(await openHubSocket(discovery.url, discovery.authToken), onEvent)
  }

  rejectPending(message) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  command(command, payload = {}, { sessionId, timeoutMs = 30_000 } = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Hub is not connected')
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Hub ${command} timed out; execution outcome is unknown; no retry`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({
          kind: 'command',
          envelope: { version: 'v1', requestId, command, clientId: this.clientId, ...(sessionId ? { sessionId } : {}), payload }
        }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error(`Hub ${command} send failed; no retry`))
      }
    })
  }

  register() {
    return this.command('client.register', {
      clientId: this.clientId, clientType: 'research', displayName: 'Rovai Hub probe',
      transport: 'websocket', capabilities: []
    })
  }

  subscribe(sessionId) {
    this.socket.send(JSON.stringify({ kind: 'stream.subscribe', clientId: this.clientId, ...(sessionId ? { sessionId } : {}) }))
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000)
      this.socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true })
      this.socket.close()
    })
    this.rejectPending('Client closed; closing a socket does not cancel a native run')
  }
}
