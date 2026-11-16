// Synthetic MCP form request for the Goose native research probe.
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'

const pending = new Map()
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (pending.has(message.id) && !message.method) {
    const callId = pending.get(message.id)
    pending.delete(message.id)
    writeFileSync(process.env.ROVAI_GOOSE_ELICITATION_MARKER, JSON.stringify(message))
    reply(callId, { content: [{ type: 'text', text: 'GOOSE_ELICITATION_RESULT:' + message.result?.action }] })
    return
  }
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'goose-elicitation-probe', version: '1' }
    })
  } else if (message.method === 'tools/list') {
    reply(message.id, { tools: [{ name: 'ask', description: 'Request a synthetic form response.', inputSchema: { type: 'object', properties: {} } }] })
  } else if (message.method === 'tools/call') {
    const id = 'elicitation_' + message.id
    pending.set(id, message.id)
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id, method: 'elicitation/create', params: {
        message: 'Choose a synthetic research option.',
        requestedSchema: { type: 'object', properties: { choice: { type: 'string', enum: ['one', 'two'] } }, required: ['choice'] }
      }
    }) + '\n')
  } else if (message.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Research fixture does not implement this method' } }) + '\n')
  }
})
