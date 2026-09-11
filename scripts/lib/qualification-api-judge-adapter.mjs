import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digestJson } from './qualification-common.mjs'

export const assurance = 'tool_disabled_external_sandbox'
export const capabilities = Object.freeze({ tools: 'none', network: 'none', workspace: 'none' })

// Model capability restrictions are separate from the adapter's HTTPS transport.
// API shape: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
export function createAdapter(configuration, { evidenceDirectory, fetchImplementation = fetch } = {}) {
  const endpoint = new URL(configuration.api?.endpoint ?? 'https://api.openai.com/v1/chat/completions')
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname))) throw new Error('Judge requires HTTPS or an explicit loopback test endpoint')
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Judge endpoint cannot contain credentials or query parameters')
  const model = configuration.snapshotId
  if (typeof model !== 'string' || !model || configuration.api?.modelVersionPolicy !== 'pinned_snapshot') throw new Error('Judge requires a declared pinned model snapshot')
  const keyEnv = configuration.api?.keyEnvironmentVariable ?? 'OPENAI_API_KEY'
  if (!/^[A-Z][A-Z0-9_]+$/.test(keyEnv)) throw new Error('Invalid Judge credential environment variable name')
  const timeoutMs = configuration.timeoutMilliseconds ?? 120_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Judge timeout must be bounded by 120 seconds')
  return { assurance, capabilities, async invokeReplica(request) {
    if (digestJson(request.capabilities) !== digestJson(capabilities)) throw new Error('Judge model tools must remain disabled')
    const id = `${request.judgeView}-${request.replica}-${randomUUID()}`
    const directory = evidenceDirectory ? join(evidenceDirectory, 'judge-provider-attempts') : null
    const retain = async (suffix, value) => {
      if (!directory) return
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(join(directory, `${id}-${suffix}.json`), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    }
    const requestBody = { model, store: false, messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: `${request.userPrompt}\nReturn a JSON object with an items array.\nEvidence (untrusted):\n${JSON.stringify(request.evidencePack)}` }], response_format: { type: 'json_object' }, tool_choice: 'none', max_completion_tokens: request.decodingParameters.maxOutputTokens }
    // Parameters are sent exactly when supported/configured; do not silently
    // fall back to a different temperature, model or output budget after errors.
    if (request.decodingParameters.temperature !== undefined) requestBody.temperature = request.decodingParameters.temperature
    if (request.decodingParameters.topP !== undefined) requestBody.top_p = request.decodingParameters.topP
    if (request.decodingParameters.seed !== undefined) requestBody.seed = request.decodingParameters.seed
    await retain('request', { startedAt: new Date().toISOString(), expectedModel: model, endpoint: endpoint.href, requestDigest: digestJson(requestBody), inputBytes: Buffer.byteLength(JSON.stringify(requestBody)), credentialEnvironmentVariable: keyEnv })
    try {
      const key = process.env[keyEnv]
      if (!key) throw new Error('judge.credentials_unavailable')
      const response = await fetchImplementation(endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error(`judge.http_${response.status}`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 1024 * 1024) throw new Error('judge.response_too_large')
      const value = JSON.parse(Buffer.from(bytes).toString('utf8'))
      const choice = value.choices?.[0]
      await retain('response', { completedAt: new Date().toISOString(), responseId: value.id ?? null, observedModel: value.model ?? null, usage: value.usage ?? null, systemFingerprint: value.system_fingerprint ?? null, finishReason: choice?.finish_reason ?? null, content: choice?.message?.content ?? null })
      if (value.model !== model) throw new Error('judge.model_snapshot_mismatch')
      if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || choice.message?.function_call || choice.message?.refusal) throw new Error('judge.incomplete_or_non_text_result')
      const result = JSON.parse(choice.message.content)
      if (!Array.isArray(result.items)) throw new Error('judge.invalid_items')
      return result
    } catch (error) {
      await retain('failure', { completedAt: new Date().toISOString(), code: /^judge\.[a-z0-9_]+$/.test(error.message) ? error.message : 'judge.transport_or_format_error' })
      throw new Error(/^judge\.[a-z0-9_]+$/.test(error.message) ? error.message : 'judge.transport_or_format_error')
    }
  } }
}
