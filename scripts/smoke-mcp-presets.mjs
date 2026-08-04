import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const protocolVersion = '2025-03-26'
const clientInfo = { name: 'rovai-development-smoke', version: '0.37' }

const context7 = await smokeRemote('context7', 'https://mcp.context7.com/mcp')
const playwright = await smokePlaywright()

const results = [context7, playwright]
console.log(JSON.stringify({
  ok: results.every((result) => result.status !== 'failed'),
  results
}, null, 2))
if (results.some((result) => result.status === 'failed')) process.exitCode = 1

async function smokeRemote(preset, url, extraHeaders = {}) {
  try {
    const headers = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': protocolVersion,
      ...extraHeaders
    }
    const initialized = await rpcPost(url, headers, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: {}, clientInfo }
    })
    const sessionId = initialized.response.headers.get('mcp-session-id')
    if (!initialized.message?.result?.serverInfo) throw new Error('initialize result omitted serverInfo')
    if (sessionId) headers['MCP-Session-Id'] = sessionId
    await rpcPost(url, headers, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }, false)
    const listed = await rpcPost(url, headers, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    })
    const tools = listed.message?.result?.tools
    if (!Array.isArray(tools) || tools.length === 0) throw new Error('tools/list returned no tools')
    return {
      preset,
      status: 'passed',
      server: initialized.message.result.serverInfo.name,
      version: initialized.message.result.serverInfo.version ?? null,
      toolCount: tools.length
    }
  } catch (error) {
    return { preset, status: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

async function rpcPost(url, headers, payload, expectsMessage = true) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000)
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const message = parseRpcBody(body)
  if (expectsMessage && !message) throw new Error('response omitted a JSON-RPC message')
  if (message?.error) throw new Error(`JSON-RPC ${message.error.code ?? 'error'}`)
  return { response, message }
}

function parseRpcBody(body) {
  const candidates = body.includes('\ndata:') || body.startsWith('data:')
    ? body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
    : [body.trim()]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // Continue until a complete JSON-RPC event is found.
    }
  }
  return null
}

async function smokePlaywright() {
  const child = spawn('npx', ['-y', '@playwright/mcp@0.0.78', '--isolated'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = createInterface({ input: child.stdout })
  let nextId = 1
  const pending = new Map()
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`JSON-RPC ${message.error.code ?? 'error'}`))
    else request.resolve(message.result)
  })
  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`${method} timed out`))
    }, 60_000)
    pending.set(id, {
      resolve(value) {
        clearTimeout(timer)
        resolveRequest(value)
      },
      reject(error) {
        clearTimeout(timer)
        rejectRequest(error)
      }
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  try {
    const initialized = await request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo
    })
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    })}\n`)
    const listed = await request('tools/list', {})
    if (!Array.isArray(listed?.tools) || listed.tools.length === 0) {
      throw new Error('tools/list returned no tools')
    }
    return {
      preset: 'playwright',
      status: 'passed',
      server: initialized?.serverInfo?.name ?? 'Playwright',
      version: '@playwright/mcp@0.0.78',
      toolCount: listed.tools.length
    }
  } catch (error) {
    return {
      preset: 'playwright',
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    }
  } finally {
    child.kill('SIGTERM')
    lines.close()
  }
}
