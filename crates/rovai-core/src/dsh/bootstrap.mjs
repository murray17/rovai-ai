import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'

export const name = 'rovai-bootstrap'
export const inject = ['loader', 'systemPrompt', 'tools']
export const readinessService = 'rovaiDshReady'
const MAX_OBSERVED_FILE_CONTENT_BYTES = 2 * 1024 * 1024
const DSH_MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

// The ACP app can claim stdio while sibling Loader entries are still starting.
// Hold its injected readiness service until every configured native MCP client
// has completed the official Cordis entry lifecycle. Session-scoped ACP MCP
// clients are mounted later by DSH itself and are intentionally not involved.
async function awaitNativeMcpReadiness(ctx) {
  const entries = [...ctx.loader.entries()]
    .filter(entry => !entry.disabled && entry.options.name === DSH_MCP_CLIENT)
  await Promise.all(entries.map(async entry => {
    await entry.refresh()
    await entry._await()
  }))
}

// A normal DSH prompt section is assembled before every model step, including
// the step after native compaction. Variables are substituted only once, so
// braces inside user-authored identity text remain literal.
export async function apply(ctx, config) {
  // DSH's documented MCP namespace normalization (0.1.5). A Session's
  // scoped MCP must replace the entire inherited server, including native-only
  // tools. The official restriction seam leaves scoped registrations visible.
  const namespaces = (config.mcpServerNames ?? []).map(name => /^[A-Za-z0-9_-]{1,32}$/.test(name)
    ? name : `${name.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'server'}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`.slice(0, 32))
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession != null || namespaces.length === 0) return
    let previous = '', dispose, refreshing = false
    const refresh = () => {
      if (refreshing) return
      refreshing = true
      try {
        const deny = ctx.tools.schemas().map(tool => tool.name)
          .filter(name => namespaces.some(server => name.startsWith(`mcp__${server}__`))).sort()
        const key = JSON.stringify(deny)
        if (key === previous) return
        previous = key
        const next = deny.length ? agent.ctx.tools.restrict({ deny }) : undefined
        dispose?.(); dispose = next
      } finally { refreshing = false }
    }
    refresh()
    agent.ctx.on('tools/change', refresh)
  })
  // Automatic compaction has a durable owner turn on its start event. Idle
  // manual compaction has turn=null and cannot be charged to a later AgentRun.
  const compactionTurns = new Map()
  // Observe committed native per-call accounting, never prompt bodies or a
  // replayed Session total. ACP's occupancy gauge is a separate measurement.
  ctx.on('session/event', (session, event) => {
    if (session.header.parentSession != null) return
    const compactionKey = JSON.stringify([session.id, event.data?.compactionId])
    if (event.type === 'compaction/start') {
      compactionTurns.set(compactionKey, event.data.turn)
      return
    }
    if (event.type === 'compaction/end') {
      compactionTurns.delete(compactionKey)
      return
    }
    if (!['assistant/message', 'compaction/summary'].includes(event.type) || !event.data?.usage) return
    const turn = event.type === 'compaction/summary' ? compactionTurns.get(compactionKey) : event.data.turn
    if (event.type === 'compaction/summary' && !Number.isSafeInteger(turn)) return
    const usage = {}
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
      const value = event.data.usage[field]
      if (Number.isSafeInteger(value) && value >= 0) usage[field] = value
    }
    if (!Number.isSafeInteger(event.seq) || !Number.isSafeInteger(turn)) throw new Error('rovai_dsh_usage_identity_invalid')
    const key = createHash('sha256').update(session.id).digest('hex')
    const target = join(config.observationRoot, `${key}.usage-${event.seq}.json`)
    writeFileSync(`${target}.tmp`, JSON.stringify({ schemaVersion: 1, sessionId: session.id,
      seq: event.seq, turn, sourceEvent: event.type, usage }), { mode: 0o600 })
    renameSync(`${target}.tmp`, target)
  })
  // The official synchronous, immutable result observer precedes the durable
  // tool/result event. ACP currently drops the shell's canonical exit status
  // and write/edit before/after state. Preserve only those structured facts,
  // scoped to an exact root Session/call; stdout and tool arguments remain on
  // ACP. Core consumes each file once.
  ctx.on('tools/result', (exec, result) => {
    const sessionId = exec.agent?.session.id
    if (exec.parent || !sessionId || exec.agent.session.header.parentSession != null) return
    const callId = exec.callId
    const key = createHash('sha256').update(JSON.stringify([sessionId, callId])).digest('hex')
    const value = result.isError ? null : result.value
    const isBoundedFileContent = content => typeof content === 'string'
      && Buffer.byteLength(content, 'utf8') <= MAX_OBSERVED_FILE_CONTENT_BYTES
    // Native write uses null to prove that the target did not exist. Missing
    // before is still incomplete; edit always requires two string states.
    const hasCompleteFileState = isBoundedFileContent(value?.after)
      && (exec.name === 'write'
        ? value?.before === null || isBoundedFileContent(value?.before)
        : exec.name === 'edit' && isBoundedFileContent(value?.before))
    const status = {
      schemaVersion: 1, sessionId, callId, tool: exec.name,
      isError: result.isError,
      path: ['read', 'read_image', 'write', 'edit'].includes(exec.name)
        && typeof value?.path === 'string' ? value.path : null,
      exitCode: Number.isSafeInteger(value?.exitCode) ? value.exitCode : null,
      signal: typeof value?.signal === 'string' ? value.signal : null,
      timedOut: value?.timedOut === true,
      aborted: value?.aborted === true,
      ...(hasCompleteFileState ? { before: value.before, after: value.after } : {})
    }
    const target = join(config.observationRoot, `${key}.json`)
    writeFileSync(`${target}.tmp`, JSON.stringify(status), { mode: 0o600 })
    renameSync(`${target}.tmp`, target)
  })
  ctx.systemPrompt.variable('rovai_bootstrap', ({ agent }) => {
    const sessionId = agent?.session.id
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) {
      throw new Error('rovai_dsh_bootstrap_session_invalid')
    }
    // Native child agents receive their own delegation context, not the Camp
    // member's self identity. Only the ACP root is bound by Core.
    if (agent.session.header.parentSession != null) return ''
    const binding = JSON.parse(readFileSync(join(config.bindingRoot, `${sessionId}.json`), 'utf8'))
    if (binding.schemaVersion !== 1 || binding.sessionId !== sessionId
      || typeof binding.bootstrap !== 'string' || binding.bootstrap.trim() === ''
      || createHash('sha256').update(binding.bootstrap).digest('hex') !== binding.sha256) {
      throw new Error('rovai_dsh_bootstrap_binding_invalid')
    }
    return binding.bootstrap
  })
  ctx.systemPrompt.section({ name: 'rovai:bootstrap', order: 11000, text: '{{rovai_bootstrap}}' })
  await awaitNativeMcpReadiness(ctx)
  ctx.provide(readinessService, Object.freeze({ ready: true }))
}
