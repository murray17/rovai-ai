import readline from 'node:readline'
import { writeFileSync } from 'node:fs'

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
})

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

const source = process.env.ROVAI_MCP_SMOKE_SOURCE ?? 'rovai-mcp-smoke'
const startupMarker = process.env.ROVAI_MCP_SMOKE_STARTUP_MARKER

lines.on('line', (line) => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    if (startupMarker) writeFileSync(startupMarker, `${source}\n`, { mode: 0o600 })
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'rovai-mcp-smoke', version: '1.0.0' }
    })
    return
  }
  if (message.method === 'tools/list') {
    reply(message.id, {
      tools: [{
        name: 'echo',
        description: 'Return a deterministic Rovai-ai MCP smoke marker.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        }
      }]
    })
    return
  }
  if (message.method === 'tools/call') {
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
