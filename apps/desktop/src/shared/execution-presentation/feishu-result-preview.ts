import type { AgentRunExecutionEvidenceView } from '@contracts'
import { executionStepPublicTitle, type ExecutionStep } from './index'

const HIDDEN = '[已隐藏]'
const SENSITIVE_NAME = /token|secret|password|passwd|authorization|credential|cookie|api[_-]?key|private[_-]?key|stdin|密码|口令/iu
const ASSIGNMENT = /(?<![\w.-])(["']?[\w.-]*(?:token|secret|password|passwd|authorization|credential|cookie|api[_-]?key|private[_-]?key|stdin)[\w.-]*["']?|密码|口令)\s*[:=]\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s,;&|]+))/giu
const SECRET_FLAG = /(?<![\w-])--[\w-]*(?:token|secret|password|passwd|authorization|credential|cookie|api[_-]?key|private[_-]?key|stdin)[\w-]*(?:=|\s+)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s;&|]+))/giu
const AUTH_HEADER = /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*([^\r\n'"]+)/giu
const PRIVATE_KEY = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gu
const RAW_PATCH = /(?:\*\*\* (?:Begin Patch|Update File|Add File|Delete File)|^diff --git |^@@\s+-\d)/mu
const ROVAI_SEND = /(?:^|[\s/\\])rovai(?:\.exe)?["']?\s+send(?:\s|$)/u
const MESSAGE_BODY = /--body(?:=|\s+)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s;&|]+))/gu

type CommandProjection = { title: string; result: string }

/** The channel boundary never uses ExecutionStep.detail: it mixes inputs and results. */
export function createFeishuCommandProjector(
  evidence: AgentRunExecutionEvidenceView[],
  agentRunId: string
): (step: ExecutionStep) => CommandProjection {
  const events = evidence.filter((event) => event.agentRunId === agentRunId)
  const secrets = new Set<string>()
  const outputs = new Map<string, string>()
  const privateMessageOperations = new Set<string>()
  for (const event of events) {
    collectSecrets(event.payload, secrets)
    const payload = record(event.payload)
    const operationId = event.canonical?.operationId ?? event.id
    const item = record(payload.item)
    const input = record(payload.input)
    const command = [item.command, input.command, input.commandLine, input.CommandLine, input.cmd, payload.input]
      .find((value) => typeof value === 'string')
    // Send results can echo the message in arbitrary, untyped response fields. They
    // are not an execution-result preview; the public message has its own TextBlock.
    if ((typeof command === 'string' && ROVAI_SEND.test(command))
      || [event.canonical?.toolName, payload.canonicalTool].includes('camp.message.send')) {
      privateMessageOperations.add(operationId)
      if (typeof command === 'string') {
        for (const match of command.matchAll(MESSAGE_BODY)) {
          const body = match[1] ?? match[2] ?? match[3]
          addSecret(secrets, body)
          addSecret(secrets, body?.replace(/\s+/gu, ' '))
        }
      }
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
        output = textualResult(envelope.result) ?? textualResult(envelope.error) ?? output
      }
    }
    if (output !== undefined) outputs.set(operationId, output)
  }
  // Collect before selecting head/tail, including values declared in the omitted middle.
  const values = [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)
  return (step) => {
    const title = step.toolName === 'apply_patch' ? 'apply_patch' : executionStepPublicTitle(step)
    let safeTitle = RAW_PATCH.test(title)
      ? '命令内容已隐藏（含原始补丁）'
      : redactSecrets(title, values)
    if (privateMessageOperations.has(step.id)) {
      safeTitle = safeTitle.replace(MESSAGE_BODY, `--body ${HIDDEN}`)
    }
    let result: string
    if (step.fileChanges?.length) {
      result = step.fileChanges
        .map((change) => `${change.path} +${change.additions} −${change.deletions}`)
        .join('\n')
    } else if (privateMessageOperations.has(step.id)) {
      result = '（消息内容不在执行结果中重复展示）'
    } else {
      result = outputs.get(step.id) ?? ''
      if (RAW_PATCH.test(result)) result = '（原始补丁已隐藏）'
      else if (looksLikeStructuredResult(result)) result = '（结构化工具结果已隐藏）'
    }
    return {
      title: safeTitle,
      result: resultPreview(redactSecrets(result, values))
    }
  }
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

function resultPreview(value: string): string {
  if (!value.trim()) return '（无可公开的文本结果）'
  // A final newline terminates the last output line; indentation is still output.
  const lines = value.replace(/\n$/u, '').split('\n')
  const preview = lines.length <= 20
    ? lines
    : [...lines.slice(0, 9), `… 已截断 ${lines.length - 19} 行 …`, ...lines.slice(-10)]
  return preview.map(boundFeishuPreviewLine).join('\n')
}

/** A line is not a byte budget. Keep pathological single-line results deliverable. */
export function boundFeishuPreviewLine(line: string): string {
  const byteLimit = 512
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= byteLimit) return line
  const suffix = ' …（此行过长，已截断）'
  const available = byteLimit - encoder.encode(suffix).length
  let bytes = 0
  let prefix = ''
  for (const character of line) {
    bytes += encoder.encode(character).length
    if (bytes > available) break
    prefix += character
  }
  return prefix + suffix
}
