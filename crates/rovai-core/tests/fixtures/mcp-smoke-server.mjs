import readline from 'node:readline'
import { appendFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
})

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

const source = process.env.ROVAI_MCP_SMOKE_SOURCE ?? 'rovai-mcp-smoke'
const startupMarker = process.env.ROVAI_MCP_SMOKE_STARTUP_MARKER
const pidMarker = process.env.ROVAI_MCP_SMOKE_PID_MARKER
const callLog = process.env.ROVAI_MCP_SMOKE_CALL_LOG
const mutationRoot = process.env.ROVAI_MCP_SMOKE_MUTATION_ROOT

lines.on('line', async (line) => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    if (startupMarker) writeFileSync(startupMarker, `${source}\n`, { mode: 0o600 })
    if (pidMarker) writeFileSync(pidMarker, `${process.pid}\n`, { mode: 0o600 })
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'rovai-mcp-smoke', version: '1.0.0' }
    })
    return
  }
  if (message.method === 'tools/list') {
    const tools = [{
      name: 'echo',
      description: 'Return a deterministic Rovai-ai MCP smoke marker.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false
      }
    }]
    if (mutationRoot) {
      tools.push({
        name: 'delayed_write',
        description: 'Write a deterministic smoke-test marker after a bounded delay.',
        inputSchema: {
          type: 'object',
          properties: {
            fileName: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' },
            text: { type: 'string' },
            delayMs: { type: 'integer', minimum: 0, maximum: 60000 }
          },
          required: ['fileName', 'text', 'delayMs'],
          additionalProperties: false
        }
      })
    }
    reply(message.id, {
      tools
    })
    return
  }
  if (message.method === 'tools/call') {
    if (callLog) {
      appendFileSync(callLog, `${JSON.stringify({
        pid: process.pid,
        name: message.params?.name,
        arguments: message.params?.arguments ?? null
      })}\n`, { mode: 0o600 })
    }
    if (message.params?.name === 'delayed_write') {
      if (!mutationRoot) {
        reply(message.id, {
          content: [{ type: 'text', text: `${source}:mutation-disabled` }],
          isError: true
        })
        return
      }
      const fileName = message.params?.arguments?.fileName
      const text = message.params?.arguments?.text
      const delayMs = message.params?.arguments?.delayMs
      const root = resolve(mutationRoot)
      const target = typeof fileName === 'string' ? resolve(root, fileName) : ''
      if (typeof fileName !== 'string'
          || !/^[A-Za-z0-9._-]+$/.test(fileName)
          || !target.startsWith(`${root}${sep}`)
          || typeof text !== 'string'
          || !Number.isInteger(delayMs)
          || delayMs < 0
          || delayMs > 60_000) {
        reply(message.id, {
          content: [{ type: 'text', text: `${source}:invalid-delayed-write` }],
          isError: true
        })
        return
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
      writeFileSync(target, text, { mode: 0o600 })
      reply(message.id, {
        content: [{ type: 'text', text: `${source}:wrote:${fileName}` }]
      })
      return
    }
    reply(message.id, {
      content: [{
        type: 'text',
        text: `${source}:${message.params?.arguments?.text ?? ''}`
      }]
    })
    return
  }
  if (message.id !== undefined) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` }
    })}\n`)
  }
})
