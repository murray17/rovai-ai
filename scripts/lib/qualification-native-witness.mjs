import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { digestFile, digestJson } from './qualification-common.mjs'

import { directExecWrapper, parallelExecWrapper, splitParallelOutput } from './qualification-native-exec-wrapper.mjs'
export { directExecWrapper } from './qualification-native-exec-wrapper.mjs'

export const NATIVE_WITNESS_POLICY = 'bound-native-command-witness-v1'
export const PARALLEL_WITNESS_POLICY = 'bound-native-command-witness-v2'
const LIMIT = 200_000
const processText = /review-duo|cli-operations|\bagent_\d+\b|SKILL\.md/
const rovaiCommand = /(?:^|[\s;&|('\"])(?:[^\s]*\/)?rovai(?:['\"])?(?:\s|$)/

// Same public field projection as Core's command Execution Evidence. Admission
// requires equality with an already persisted Core payload digest, not trust in
// the native file's path or its own self-declared command identity.
export function nativeCommandCorePayload(item) {
  const keys = ['id', 'type', 'status', 'title', 'command', 'cwd', 'durationMs', 'exitCode', 'aggregatedOutput', 'output', 'summary', 'changes', 'tool', 'server', 'error']
  const projected = Object.fromEntries(keys.map(key => [key, item[key] ?? null]))
  projected.commandActions = item.commandActions?.map(action => ({ name: action.name ?? null, path: action.path ?? null, type: action.type })) ?? null
  return { item: projected, reasonCode: null, runtimeDiff: null }
}

export function nativeOutputProjection(command, output, terminalOutput, policy = NATIVE_WITNESS_POLICY) {
  if (typeof output !== 'string') return null
  let projection = 'whole_command'
  // A narrow public-help suffix is separable only when the native terminal
  // output includes that exact suffix and the full result ends in it.
  const help = command.match(/\n(rovai(?: [a-z][a-z-]*)+) --help\s*$/)
  const helpStart = help ? output.startsWith(`${help[1]}\n`) ? 0 : output.lastIndexOf(`\n${help[1]}\n`) + 1 : -1
  if (help && helpStart > 0 && terminalOutput?.endsWith(output.slice(helpStart))) {
    command = command.slice(0, help.index)
    output = output.slice(0, helpStart)
    projection = 'verification_prefix_before_readonly_cli_help'
  }
  if (rovaiCommand.test(command) || processText.test(command + '\n' + output)
      || !(policy === PARALLEL_WITNESS_POLICY && /\b(?:git\s+(?:status|diff)\b|shasum\b|sha256sum\b)/.test(command)) && !/(?:\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bgit\b[^\n]*\bdiff\b[^\n]*--check\b|\b(?:node|python3?|jq)\b)/.test(command)) return null
  return { command, output, projection,
    outputTruncated: /Warning: truncated output|\b(?:tokens|characters) truncated\b|Output truncated/i.test(output) }
}

export function extractNativeWitnesses(rows, nativeItems, coreEvents, workspace, omitted = [], policy = NATIVE_WITNESS_POLICY) {
  const cores = new Map(coreEvents.filter(event => event.kind === 'command' || event.payload?.item?.type === 'commandExecution')
    .map(event => [event.payloadDigest ?? digestJson(event.payload), event]))
  const items = new Map(nativeItems.filter(item => item.type === 'commandExecution').map(item => [item.id, item]))
  const active = new Map(), witnesses = []
  for (const row of rows) {
    const value = row.payload ?? {}
    if (row.type === 'response_item' && value.type === 'custom_tool_call') {
      const wrapper = directExecWrapper(value.input) ?? (policy === PARALLEL_WITNESS_POLICY ? parallelExecWrapper(value.input) : null)
      active.set(value.call_id, { row, wrapper, commands: [] })
    }
    if (row.type === 'event_msg' && value.type === 'item_completed' && value.item?.type === 'CommandExecution') {
      for (const call of active.values()) call.commands.push(row)
    }
    if (row.type !== 'response_item' || value.type !== 'custom_tool_call_output') continue
    const call = active.get(value.call_id); active.delete(value.call_id)
    if (call?.wrapper?.mode === 'parallel_text') {
      witnesses.push(...extractParallelWitnesses(call, row, items, cores, workspace, omitted)); continue
    }
    if (!call?.wrapper || call.commands.length !== 1 || resolve(call.wrapper.args.workdir) !== resolve(workspace)) continue
    const event = call.commands[0], item = items.get(event.payload.item.id)
    if (!item || resolve(item.cwd) !== resolve(workspace) || event.payload.item.command?.at(-1) !== call.wrapper.args.cmd) continue
    const corePayload = nativeCommandCorePayload(item), sourcePayloadDigest = digestJson(corePayload), core = cores.get(sourcePayloadDigest)
    if (!core || core.isTruncated || item.exitCode !== event.payload.item.exit_code) continue
    const blocks = value.output
    if (!Array.isArray(blocks) || blocks.length !== (call.wrapper.mode === 'text_exit' ? 3 : 2) || !blocks[0].text?.startsWith('Script completed') || typeof blocks[1].text !== 'string') continue
    if (call.wrapper.mode === 'text_exit' && blocks[2].text !== `exit_code=${item.exitCode}`) continue
    let output = blocks[1].text, reportedExit = null
    if (call.wrapper.mode === 'json') {
      let decoded
      try { decoded = JSON.parse(output) } catch { continue }
      output = decoded.output; reportedExit = decoded.exit_code
      if (reportedExit !== item.exitCode) continue
    }
    if (typeof output !== 'string' || typeof item.aggregatedOutput !== 'string' || !output.endsWith(item.aggregatedOutput)) continue
    const projection = nativeOutputProjection(call.wrapper.args.cmd, output, item.aggregatedOutput, policy)
    if (!projection) continue
    const payload = { ...(policy === PARALLEL_WITNESS_POLICY ? { policyId: policy } : {}), sourceEvidenceId: core.id, sourcePayloadDigest, nativeItemId: item.id,
      threadId: event.payload.thread_id, turnId: event.payload.turn_id, callId: value.call_id,
      projection, status: item.status, exitCode: item.exitCode,
      sourceRecords: { call: call.row, command: event, response: row, nativeItem: item } }
    if (Buffer.byteLength(JSON.stringify(payload)) > 50_000) { omitted.push({ sourceEvidenceId: core.id, reason: 'native_witness_record_bound' }); continue }
    witnesses.push({ ...payload, witnessDigest: digestJson(payload) })
  }
  return witnesses
}

function extractParallelWitnesses(call, response, nativeById, cores, workspace, omitted) {
  const wrapper=call.wrapper,blocks=response.payload.output
  if(call.commands.length!==wrapper.calls.length||!Array.isArray(blocks)||blocks.length!==2||!blocks[0].text?.startsWith('Script completed'))return []
  const outputs=splitParallelOutput(wrapper,blocks[1].text)
  if(!outputs)return []
  const bound=[]
  for(let ordinal=0;ordinal<wrapper.calls.length;ordinal++){
    const args=wrapper.calls[ordinal],events=call.commands.filter(e=>e.payload.item.command?.at(-1)===args.cmd)
    if(events.length!==1||resolve(args.workdir)!==resolve(workspace))return []
    const event=events[0],item=nativeById.get(event.payload.item.id)
    if(!item||resolve(item.cwd)!==resolve(workspace)||item.exitCode!==event.payload.item.exit_code||typeof item.aggregatedOutput!=='string'||!outputs[ordinal].endsWith(item.aggregatedOutput))return []
    const sourcePayloadDigest=digestJson(nativeCommandCorePayload(item)),core=cores.get(sourcePayloadDigest)
    const projection=nativeOutputProjection(args.cmd,outputs[ordinal],item.aggregatedOutput,PARALLEL_WITNESS_POLICY)
    // Retained raw parallel output is admitted only if every sibling is safe.
    if(!core||core.isTruncated||!projection)return []
    bound.push({event,item,core,sourcePayloadDigest,projection,ordinal})
  }
  return bound.flatMap(({event,item,core,sourcePayloadDigest,projection,ordinal})=>{
    const payload={policyId:PARALLEL_WITNESS_POLICY,sourceEvidenceId:core.id,sourcePayloadDigest,nativeItemId:item.id,threadId:event.payload.thread_id,turnId:event.payload.turn_id,callId:response.payload.call_id,commandOrdinal:ordinal,projection,status:item.status,exitCode:item.exitCode,
      sourceRecords:{call:call.row,commands:call.commands,response,nativeItems:bound.map(row=>row.item)}}
    if(Buffer.byteLength(JSON.stringify(payload))>50_000){omitted.push({sourceEvidenceId:core.id,reason:'native_witness_record_bound'});return []}
    return [{...payload,witnessDigest:digestJson(payload)}]
  })
}

async function nativeCommandItems(executable, threadIds, cwd) {
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
  const pending = new Map(); let sequence = 0
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let response; try { response = JSON.parse(line) } catch { return }
    const call = pending.get(response.id)
    if (call) { pending.delete(response.id); response.error ? call.reject(new Error('native_read.rpc_error')) : call.resolve(response.result) }
  })
  const closed = new Promise(resolveExit => child.once('close', resolveExit))
  child.on('error', () => { for (const call of pending.values()) call.reject(new Error('native_read.spawn_failed')) })
  child.stdin.on('error', () => { for (const call of pending.values()) call.reject(new Error('native_read.stdin_closed')) })
  child.on('exit', () => { for (const call of pending.values()) call.reject(new Error('native_read.closed')) })
  const rpc = (method, params) => new Promise((resolveCall, reject) => {
    const id = ++sequence; pending.set(id, { resolve: resolveCall, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
  let timer
  try {
    return await Promise.race([(async () => {
      await rpc('initialize', { clientInfo: { name: 'rovai-evaluation-native-witness', version: '1' }, capabilities: { experimentalApi: true } })
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
      const items = new Map()
      for (const id of threadIds) {
        const response = await rpc('thread/read', { threadId: id, includeTurns: true })
        items.set(id, response.thread.turns.flatMap(turn => turn.items.filter(item => item.type === 'commandExecution')))
      }
      return items
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('native_read.timeout')), 20_000) })])
  } finally {
    clearTimeout(timer); lines.close(); child.kill('SIGTERM')
    const killer = setTimeout(() => child.kill('SIGKILL'), 3000)
    await closed; clearTimeout(killer)
  }
}

export async function captureNativeCommandWitnesses({ snapshot, workspace, executable, executableDigest, startedAt, completedAt, policy = NATIVE_WITNESS_POLICY, sessionRoot = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions') }) {
  const empty = reason => ({ policyId: policy, state: 'unavailable', reason, records: [], sources: [] })
  try {
    if (await digestFile(executable) !== executableDigest.replace(/^sha256:/, '')) return empty('native_read.executable_changed')
    const files = [], dates = new Set(), omitted = []
    for (const timestamp of [startedAt, completedAt]) for (const offset of [-1, 0, 1]) {
      const date = new Date(Date.parse(timestamp) + offset * 86_400_000)
      if (!Number.isFinite(date.getTime())) return empty('native_read.invalid_window')
      dates.add(date.toISOString().slice(0, 10).replaceAll('-', '/'))
    }
    for (const date of dates) {
      const directory = join(sessionRoot, date)
      for (const name of await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
        if (!/^rollout-.*\.jsonl$/.test(name)) continue
        const path = join(directory, name)
        const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
        let meta
        try { for await (const line of reader) { meta = JSON.parse(line); break } } finally { reader.close() }
        if (meta?.type !== 'session_meta' || meta.payload?.cwd !== workspace) continue
        if ((await stat(path)).size > 16 * 1024 * 1024) { omitted.push({ nativeSessionId: meta.payload.id, reason: 'native_session_file_bound' }); continue }
        files.push({ path, id: meta.payload.id })
      }
    }
    if (!files.length) return empty('native_read.no_matching_sessions')
    const nativeItems = await nativeCommandItems(executable, files.map(file => file.id), process.cwd())
    const records = [], sources = []; let bytes = 0, omittedByTotalBound = 0
    for (const file of files) {
      const rows = (await readFile(file.path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
      // Only selected command records survive; no reasoning, messages, prompts,
      // session instructions or unrelated native tool calls are retained.
      const extracted = extractNativeWitnesses(rows, nativeItems.get(file.id), snapshot.executionEvidence ?? [], workspace, omitted, policy)
      for (const witness of extracted) {
        const size = Buffer.byteLength(JSON.stringify(witness)); if (bytes + size > LIMIT) { omittedByTotalBound++; continue }
        bytes += size; records.push(witness)
      }
      if (extracted.length) sources.push({ nativeSessionId: file.id, sourceFileDigest: await digestFile(file.path), matchedCommands: extracted.length })
    }
    return { policyId: policy, state: 'captured', records, sources, retainedBytes: bytes, limitBytes: LIMIT, omittedByTotalBound, omitted,
      limitation: 'Only digest-bound commands with a recognized direct output wrapper are captured. Missing witnesses are not successful checks.' }
  } catch (error) { return empty(error.message.startsWith('native_read.') ? error.message : 'native_read.source_unavailable') }
}
