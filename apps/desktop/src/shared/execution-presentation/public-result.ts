import type { ExecutionStep, LiveRuntimeEvent } from './index'

const HIDDEN = '[已隐藏]'
const SENSITIVE_NAME = /token|secret|password|passwd|authorization|credential|cookie|api[_-]?key|private[_-]?key|stdin|密码|口令/iu
const ASSIGNMENT = /(?<![\w.-])(["']?[\w.-]*(?:token|secret|password|passwd|authorization|credential|cookie|api[_-]?key|private[_-]?key|stdin)[\w.-]*["']?|密码|口令)\s*[:=]\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s,;&|]+))/giu
const SECRET_FLAG = /(?<![\w-])--[\w-]*(?:token|secret|password|passwd|authorization|credential|cookie|api[_-]?key|private[_-]?key|stdin)[\w-]*(?:=|\s+)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s;&|]+))/giu
const AUTH_HEADER = /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*([^\r\n'"]+)/giu
const PRIVATE_KEY = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gu
const RAW_PATCH = /(?:\*\*\* (?:Begin Patch|Update File|Add File|Delete File)|^diff --git |^@@\s+-\d)/mu
const ROVAI_SEND = /(?:^|[\s/\\])rovai(?:\.exe)?["']?\s+send(?:\s|$)/u
const MESSAGE_BODY = /--body(?:=|\s+)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s;&|]+))/gu
export const CHANNEL_COMMAND_PREVIEW_COLUMNS = 72
export const FEISHU_CARD_RESULT_PREVIEW_LINES = 2

type PublicEvidence = Pick<LiveRuntimeEvent, 'id' | 'agentRunId' | 'eventType' | 'payload' | 'canonical'>

/** Collect across the entire Run before any windowing or head/tail selection. */
export function createExecutionPublicTextRedactor(
  evidence: PublicEvidence[],
  agentRunId: string
): (text: string) => string {
  const secrets = new Set<string>()
  for (const event of evidence) {
    if (event.agentRunId !== agentRunId) continue
    collectSecrets(event.payload, secrets)
    collectSecrets(event.canonical?.diffProjection, secrets)
    const command = eventCommand(record(event.payload))
    if (command && ROVAI_SEND.test(command)) {
      for (const match of command.matchAll(MESSAGE_BODY)) {
        const body = match[1] ?? match[2] ?? match[3]
        addSecret(secrets, body)
        addSecret(secrets, body?.replace(/\s+/gu, ' '))
      }
    }
  }
  const values = [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)
  return (text) => redactSecrets(text, values)
}

/** Inputs and local detail are never result sources. Only completed operations expose previews. */
export function createExecutionPublicResultProjector(
  evidence: PublicEvidence[],
  agentRunId: string
): (step: ExecutionStep) => string | null {
  const events = evidence.filter((event) => event.agentRunId === agentRunId)
  const redact = createExecutionPublicTextRedactor(events, agentRunId)
  const outputs = new Map<string, string>()
  const privateMessageOperations = new Set<string>()
  for (const event of events) {
    const payload = record(event.payload)
    const operationId = event.canonical?.operationId ?? event.id
    const item = record(payload.item)
    const command = eventCommand(payload)
    // Send results can echo the message in arbitrary, untyped response fields. They
    // are not an execution-result preview; the public message has its own TextBlock.
    if ((typeof command === 'string' && ROVAI_SEND.test(command))
      || [event.canonical?.toolName, payload.canonicalTool].includes('camp.message.send')) {
      privateMessageOperations.add(operationId)
    }
    if (event.eventType === 'command.output.delta') {
      if (typeof payload.delta === 'string') {
        outputs.set(operationId, (outputs.get(operationId) ?? '') + payload.delta)
      }
      continue
    }
    let output: string | undefined
    if (event.eventType === 'activity.started' || event.eventType === 'activity.completed') {
      output = textualResult(item.aggregatedOutput) ?? textualResult(item.output)
    } else if (event.eventType === 'runtime.action') {
      output = textualResult(payload.output)
      if (payload.sourceAuthority === 'core') {
        const envelope = record(payload.coreEnvelope)
        const projection = record(payload.operationProjection)
        output = textualResult(envelope.result) ?? textualResult(envelope.error)
          ?? textualResult(record(envelope.error).message)
          ?? textualResult(projection.canonicalResult) ?? output
      }
    }
    if (output !== undefined) outputs.set(operationId, output)
  }
  return (step) => {
    if (step.status === 'running' || step.status === 'waiting') return null
    let result: string
    if (step.fileChanges?.length) {
      result = step.fileChanges
        .map((change) => `${change.path} +${change.additions} −${change.deletions}`)
        .join('\n')
    } else if (privateMessageOperations.has(step.id)) {
      result = '（消息内容不在执行结果中重复展示）'
    } else {
      result = normalizeText(outputs.get(step.id) ?? '')
      if (RAW_PATCH.test(result)) result = '（原始补丁已隐藏）'
      else if (looksLikeStructuredResult(result)) result = '（结构化工具结果已隐藏）'
    }
    return resultPreview(redact(result))
  }
}

export function executionPublicCommandTitle(step: ExecutionStep, redact: (text: string) => string): string {
  const title = step.toolName === 'apply_patch' ? 'apply_patch' : step.publicCommand ?? step.title
  if (RAW_PATCH.test(title)) return '命令内容已隐藏（含原始补丁）'
  const safeTitle = redact(title)
  return ROVAI_SEND.test(title) ? safeTitle.replace(MESSAGE_BODY, `--body ${HIDDEN}`) : safeTitle
}

/** Compact provider-card label; the complete safe command remains available in the Web console. */
export function executionPublicCommandPreview(
  step: ExecutionStep,
  redact: (text: string) => string,
  maxColumns = CHANNEL_COMMAND_PREVIEW_COLUMNS
): string {
  const title = executionPublicCommandTitle(step, redact).replace(/\s+/gu, ' ').trim()
  const prompt = step.publicCommand && step.toolName !== 'apply_patch' ? `$ ${title}` : title
  return truncateDisplayColumns(prompt, maxColumns)
}

/** Feishu-only folded result preview. DingTalk deliberately never consumes this projection. */
export function feishuCardResultPreview(
  value: string | null,
  maxLines = FEISHU_CARD_RESULT_PREVIEW_LINES,
  maxColumns = CHANNEL_COMMAND_PREVIEW_COLUMNS
): string | null {
  if (!value?.trim() || maxLines < 1 || maxColumns < 1) return null
  const lines = value.trim().replace(/\r\n?/gu, '\n').split('\n')
  const hasMoreLines = lines.length > maxLines
  const visible = lines.slice(0, maxLines).map((line, index) => {
    if (!hasMoreLines || index !== maxLines - 1) return truncateEndDisplayColumns(line, maxColumns)
    const omission = ' …'
    const omissionColumns = displayColumns(Array.from(omission))
    if (omissionColumns >= maxColumns) return truncateEndDisplayColumns('…', maxColumns)
    const body = takeDisplayColumns(Array.from(line.trimEnd()), maxColumns - omissionColumns, false)
    return `${body.trimEnd()}${omission}`
  })
  return visible.join('\n')
}

/**
 * Approximate terminal-cell width is more stable across mixed Chinese/ASCII commands than a
 * UTF-16 or code-point count. Head and tail are retained because the executable and final target
 * path are usually the two most useful parts of a long command.
 */
export function truncateDisplayColumns(value: string, maxColumns: number): string {
  if (maxColumns < 1) return ''
  const characters = Array.from(value)
  if (displayColumns(characters) <= maxColumns) return value
  if (maxColumns === 1) return '…'
  const available = maxColumns - 1
  const headBudget = Math.ceil(available * 0.75)
  const tailBudget = available - headBudget
  return `${takeDisplayColumns(characters, headBudget, false)}…${takeDisplayColumns(characters, tailBudget, true)}`
}

function truncateEndDisplayColumns(value: string, maxColumns: number): string {
  if (maxColumns < 1) return ''
  const characters = Array.from(value)
  if (displayColumns(characters) <= maxColumns) return value
  if (maxColumns === 1) return '…'
  return `${takeDisplayColumns(characters, maxColumns - 1, false)}…`
}

function displayColumns(characters: string[]): number {
  return characters.reduce((total, character) => total + displayColumnWidth(character), 0)
}

function takeDisplayColumns(characters: string[], budget: number, fromEnd: boolean): string {
  const source = fromEnd ? [...characters].reverse() : characters
  const selected: string[] = []
  let used = 0
  for (const character of source) {
    const width = displayColumnWidth(character)
    if (used + width > budget) break
    selected.push(character)
    used += width
  }
  return (fromEnd ? selected.reverse() : selected).join('')
}

function displayColumnWidth(character: string): number {
  if (/\p{Mark}/u.test(character)) return 0
  const code = character.codePointAt(0) ?? 0
  return code >= 0x1100 && (
    code <= 0x115f
    || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff)
    || (code >= 0x20000 && code <= 0x3fffd)
  ) ? 2 : 1
}

function eventCommand(payload: Record<string, unknown>): string | undefined {
  const item = record(payload.item)
  const input = record(payload.input)
  return [item.command, input.command, input.commandLine, input.CommandLine, input.cmd, payload.command, payload.input]
    .find((value): value is string => typeof value === 'string')
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Explicit textual result fields only; never stringify an input or an output envelope. */
function textualResult(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const result = record(value)
  const streams = [result.stdout, result.stderr].filter((value): value is string => typeof value === 'string')
  if (streams.length) return streams.filter(Boolean).join('\n')
  if (typeof result.output === 'string') return result.output
  if (result.type === 'text' && typeof result.text === 'string') return result.text
  const content = Array.isArray(value) ? value : result.content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((part) => {
    const block = record(part)
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  })
  return text.length ? text.join('\n') : undefined
}

function collectSecrets(value: unknown, secrets: Set<string>, depth = 0, sensitive = false): void {
  if (depth > 20) return
  if (typeof value === 'string') {
    const text = normalizeText(value)
    if (sensitive) addSecret(secrets, text)
    for (const match of text.matchAll(ASSIGNMENT)) addSecret(secrets, match[2] ?? match[3] ?? match[4])
    for (const match of text.matchAll(SECRET_FLAG)) addSecret(secrets, match[1] ?? match[2] ?? match[3])
    for (const match of text.matchAll(AUTH_HEADER)) {
      addSecret(secrets, match[1])
      for (const cookie of match[1].split(';')) {
        const separator = cookie.indexOf('=')
        if (separator >= 0) addSecret(secrets, cookie.slice(separator + 1))
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectSecrets(item, secrets, depth + 1, sensitive))
  } else {
    for (const [key, item] of Object.entries(record(value))) {
      collectSecrets(item, secrets, depth + 1, sensitive || SENSITIVE_NAME.test(key))
    }
  }
}

function addSecret(secrets: Set<string>, value: string | undefined): void {
  const secret = value?.trim()
  if (!secret || secret === HIDDEN) return
  secrets.add(secret)
  if (/^(?:Bearer|Basic)\s+/iu.test(secret)) secrets.add(secret.replace(/^\S+\s+/u, ''))
  // JSON-escaped sensitive values can be echoed as their decoded text.
  if (secret.includes('\\')) {
    try {
      const decoded: unknown = JSON.parse(`"${secret}"`)
      if (typeof decoded === 'string' && decoded) secrets.add(decoded)
    } catch { /* A shell value is not necessarily a JSON string. */ }
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
}

function redactSecrets(value: string, secrets: string[]): string {
  let text = normalizeText(value).replace(PRIVATE_KEY, '[已隐藏私钥]')
  for (const secret of secrets) text = text.split(secret).join(HIDDEN)
  return text
    .replace(AUTH_HEADER, (header) => `${header.slice(0, header.indexOf(':') + 1)} ${HIDDEN}`)
    .replace(ASSIGNMENT, (_match, name: string) => `${name}=${HIDDEN}`)
    .replace(SECRET_FLAG, (flag) => `${flag.split(/[=\s]/u, 1)[0]}=${HIDDEN}`)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${HIDDEN}`)
    .replace(/\b(?:sk|ghp|gho|xoxb|xoxp)[_-][A-Za-z0-9_-]{10,}\b/gu, HIDDEN)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, HIDDEN)
}

function looksLikeStructuredResult(value: string): boolean {
  const text = normalizeText(value).trim()
  if (!text) return false
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object') return true
  } catch { /* Also fail closed on truncated or embedded tool JSON below. */ }
  return /^\s*(?:\{\s*"|"[\w.-]+"\s*:|\[\s*\{)/mu.test(text)
}

function resultPreview(value: string): string | null {
  if (!value.trim()) return null
  if (/(?:data:[^\s,]+;base64,|(?:^|\n)\s*[A-Za-z0-9+/]{160,}={0,2}\s*(?:\n|$))/u.test(value)) {
    return '（二进制或编码结果已隐藏）'
  }
  // A final newline terminates the last output line; indentation is still output.
  const lines = value.replace(/\n$/u, '').split('\n')
  const preview = lines.length <= 20
    ? lines
    : [...lines.slice(0, 9), `… 已截断 ${lines.length - 19} 行 …`, ...lines.slice(-10)]
  const bounded = preview.map((line) => boundExecutionPreviewLine(line, 512, true))
  if (new TextEncoder().encode(bounded.join('\n')).length <= 4096) return bounded.join('\n')
  // Preserve the selected head/tail lines while also bounding a dense 20-line
  // result. Newline separators and truncation notices are part of the budget.
  const lineBudget = Math.floor((4096 - preview.length + 1) / preview.length)
  return preview.map((line) => boundExecutionPreviewLine(line, lineBudget, true)).join('\n')
}

/** A line is not a byte budget. Keep pathological single-line results deliverable. */
export function boundExecutionPreviewLine(line: string, byteLimit = 512, retainTail = false): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= byteLimit) return line
  const suffix = retainTail ? ' …（此行过长，已截断）… ' : ' …（此行过长，已截断）'
  const available = byteLimit - encoder.encode(suffix).length
  const prefixBudget = retainTail ? Math.floor(available / 2) : available
  let bytes = 0
  let prefix = ''
  for (const character of line) {
    bytes += encoder.encode(character).length
    if (bytes > prefixBudget) break
    prefix += character
  }
  if (!retainTail) return prefix + suffix
  let tail = ''
  bytes = 0
  for (const character of Array.from(line).reverse()) {
    bytes += encoder.encode(character).length
    if (bytes > available - prefixBudget) break
    tail = character + tail
  }
  return prefix + suffix + tail
}
