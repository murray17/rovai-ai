import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AdapterKind,
  AdapterPermissionConfig,
  AgentProfile,
  AgentRunDiagnosticView,
  AdapterInstallation,
  ClearMemberRuntimeConfigurationCommand,
  CoreMethod,
  CreateAgentProfileCommand,
  ModelSelection,
  SendCampMessageResult,
  SetMemberRuntimeConfigurationCommand,
  StoredCommandResult
} from '@contracts'

export const USER_AUTOMATION_CONTRACT_VERSION = 1
export const USER_AUTOMATION_CONTEXT_ENV = 'ROVAI_APP_AUTOMATION_CONTEXT'
const MAX_FRAME_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MILLISECONDS = 60_000

type CoreRequester = {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
}

type AutomationDependencies = {
  core: CoreRequester
  openCamp(campId: string): Promise<{ campId: string; opened: true }>
  appVersion: string
}

type AutomationRequest = {
  contractVersion: number
  instanceId: string
  credential: string
  requestId: string
  operation: string
  params: unknown
}

type AutomationContext = {
  contractVersion: 1
  instanceId: string
  pid: number
  endpoint: { transport: 'unix_socket'; path: string }
  credential: string
}

type RecordValue = Record<string, unknown>

const ADAPTER_KINDS: readonly AdapterKind[] = [
  'codex-cli',
  'opencode-cli',
  'copilot-cli',
  'claude-code-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli',
  'cursor-agent',
  'kimi-code-cli',
  'antigravity-app'
]

export class UserAutomationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserAutomationError('automation_invalid_input', `${label} must be an object`)
  }
  return value as RecordValue
}

function stringField(value: RecordValue, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.trim() === '') {
    throw new UserAutomationError('automation_invalid_input', `${key} must be a non-empty string`)
  }
  return field
}

function optionalBoolean(value: RecordValue, key: string): boolean {
  const field = value[key]
  if (field === undefined) return false
  if (typeof field !== 'boolean') {
    throw new UserAutomationError('automation_invalid_input', `${key} must be a boolean`)
  }
  return field
}

function optionalStringField(value: RecordValue, key: string): string | null {
  const field = value[key]
  if (field === undefined || field === null) return null
  if (typeof field !== 'string') {
    throw new UserAutomationError('automation_invalid_input', `${key} must be a string or null`)
  }
  return field
}

function integerField(value: RecordValue, key: string): number {
  const field = value[key]
  if (!Number.isSafeInteger(field) || (field as number) < 1) {
    throw new UserAutomationError(
      'automation_invalid_input',
      `${key} must be a positive safe integer`
    )
  }
  return field as number
}

function stringArrayField(value: RecordValue, key: string): string[] {
  const field = value[key]
  if (!Array.isArray(field) || field.some((item) => typeof item !== 'string')) {
    throw new UserAutomationError('automation_invalid_input', `${key} must be an array of strings`)
  }
  return field
}

function adapterKindField(value: RecordValue, key: string): AdapterKind {
  const field = stringField(value, key)
  if (!ADAPTER_KINDS.includes(field as AdapterKind)) {
    throw new UserAutomationError('automation_invalid_input', `${key} is not a supported Runtime`)
  }
  return field as AdapterKind
}

function modelSelectionField(value: RecordValue, key: string): ModelSelection {
  const model = record(value[key], key)
  const mode = stringField(model, 'mode')
  if (mode === 'runtime_default') return { mode }
  if (mode !== 'explicit') {
    throw new UserAutomationError('automation_invalid_input', `${key}.mode is not supported`)
  }
  return {
    mode,
    modelId: stringField(model, 'modelId'),
    options: record(model.options, `${key}.options`)
  }
}

function permissionConfigField(
  value: RecordValue,
  key: string,
  adapterKind: AdapterKind
): AdapterPermissionConfig {
  const permissions = record(value[key], key)
  const permissionAdapterKind = adapterKindField(permissions, 'adapterKind')
  if (permissionAdapterKind !== adapterKind) {
    throw new UserAutomationError(
      'automation_invalid_input',
      `${key}.adapterKind must match adapterKind`
    )
  }
  return {
    adapterKind: permissionAdapterKind,
    schemaVersion: integerField(permissions, 'schemaVersion'),
    values: record(permissions.values, `${key}.values`)
  }
}

function createMemberCommand(input: RecordValue): CreateAgentProfileCommand {
  return {
    displayName: stringField(input, 'displayName'),
    avatarRef: optionalStringField(input, 'avatarRef'),
    teamRole: optionalStringField(input, 'teamRole') ?? '',
    professionalResponsibilities: optionalStringField(input, 'professionalResponsibilities') ?? '',
    personalityTraits: input.personalityTraits === undefined
      ? []
      : stringArrayField(input, 'personalityTraits'),
    workingPrinciples: optionalStringField(input, 'workingPrinciples') ?? '',
    growthTopic: optionalStringField(input, 'growthTopic') ?? ''
  }
}

function setMemberRuntimeCommand(input: RecordValue): SetMemberRuntimeConfigurationCommand {
  const adapterKind = adapterKindField(input, 'adapterKind')
  return {
    agentId: stringField(input, 'agentId'),
    expectedVersion: integerField(input, 'expectedVersion'),
    adapterKind,
    model: modelSelectionField(input, 'model'),
    permissions: permissionConfigField(input, 'permissions', adapterKind)
  }
}

function clearMemberRuntimeCommand(input: RecordValue): ClearMemberRuntimeConfigurationCommand {
  return {
    agentId: stringField(input, 'agentId'),
    expectedVersion: integerField(input, 'expectedVersion')
  }
}

function launchResult(result: SendCampMessageResult): RecordValue {
  if (result.pendingExecution !== null) {
    throw new UserAutomationError(
      'automation_contract_upgrade_required',
      'Automation V1 cannot observe Pending Execution intents.'
    )
  }
  const command = result.commandResult
  if (!command) {
    return {
      status: 'rejected',
      code: 'camp_send_result_unavailable',
      message: 'The Camp send result is unavailable.',
      preflight: result.preflight,
      replayed: result.replayed
    }
  }
  if (command.status === 'rejected') {
    return {
      status: 'rejected',
      code: command.code,
      message: command.code,
      preflight: result.preflight,
      replayed: result.replayed
    }
  }
  const payload = command.payload
  const campMessageId = payload.campMessageId
  const campTurnId = payload.campTurnId
  const agentRunIds = payload.agentRunIds
  const executionBudget = payload.executionBudget
  if (
    typeof campMessageId !== 'string'
    || typeof campTurnId !== 'string'
    || !Array.isArray(agentRunIds)
    || agentRunIds.some((id) => typeof id !== 'string')
    || !executionBudget
    || typeof executionBudget !== 'object'
  ) {
    throw new UserAutomationError(
      'automation_contract_upgrade_required',
      'The Camp send result does not match Automation V1.'
    )
  }
  return {
    status: 'dispatched',
    campMessageId,
    campTurnId,
    agentRunIds,
    executionBudget,
    replayed: result.replayed
  }
}

async function sendCampMessage(
  dependencies: AutomationDependencies,
  input: RecordValue
): Promise<RecordValue> {
  const campId = stringField(input, 'campId')
  const agentId = stringField(input, 'agentId')
  const body = stringField(input, 'body')
  const commandId = stringField(input, 'commandId')
  const budget = input.executionBudget === undefined
    ? null
    : record(input.executionBudget, 'executionBudget')
  const result = await dependencies.core.request<SendCampMessageResult>(
    'userAutomation.camp.send', {
    commandId,
    campId,
    agentId,
    body,
    execution: {
      taskId: null,
      purpose: body,
      completionRole: 'required',
      budget
    }
  })
  return launchResult(result)
}

type StartableUserAutomationServer = {
  start(): Promise<void>
  stop(): Promise<void>
}

export async function startUserAutomationOptional<T extends StartableUserAutomationServer>(
  create: () => T,
  reportUnavailable: (error: unknown) => void = () => {
    console.error('[rovai] User Automation is unavailable; Desktop will continue.')
  }
): Promise<T | null> {
  let server: T | null = null
  try {
    server = create()
    await server.start()
    return server
  } catch (error) {
    await server?.stop().catch(() => undefined)
    reportUnavailable(error)
    return null
  }
}

export async function dispatchUserAutomation(
  operation: string,
  params: unknown,
  dependencies: AutomationDependencies
): Promise<unknown> {
  const input = record(params ?? {}, 'params')
  switch (operation) {
    case 'status': {
      const core = await dependencies.core.request<RecordValue>('app.info')
      return {
        appRunning: true,
        authorized: true,
        coreVersion: core.version ?? null,
        appVersion: dependencies.appVersion,
        automationContractVersion: USER_AUTOMATION_CONTRACT_VERSION
      }
    }
    case 'runtime.list': {
      const installations = await dependencies.core.request<AdapterInstallation[]>(
        'runtime.installations.list'
      )
      if (!optionalBoolean(input, 'readyOnly')) return installations
      return installations.filter((installation) =>
        installation.enabled
        && installation.pathState === 'valid'
        && installation.snapshot?.probeStatus === 'ready'
      )
    }
    case 'runtime.check':
      return dependencies.core.request('runtime.product.check', {
        runtimeKind: adapterKindField(input, 'adapterKind')
      })
    case 'runtime.models':
      return dependencies.core.request('runtime.modelCatalog.open', {
        runtimeKind: adapterKindField(input, 'adapterKind')
      })
    case 'member.list':
      return dependencies.core.request<AgentProfile[]>('members.list')
    case 'member.show':
      return dependencies.core.request<AgentProfile>('members.get', {
        agentId: stringField(input, 'agentId')
      })
    case 'member.create':
      return dependencies.core.request<StoredCommandResult>('members.create', {
        commandId: stringField(input, 'commandId'),
        command: createMemberCommand(input)
      })
    case 'member.runtime.set':
      return dependencies.core.request<StoredCommandResult>('members.runtime.set', {
        commandId: stringField(input, 'commandId'),
        command: setMemberRuntimeCommand(input)
      })
    case 'member.runtime.clear':
      return dependencies.core.request<StoredCommandResult>('members.runtime.clear', {
        commandId: stringField(input, 'commandId'),
        command: clearMemberRuntimeCommand(input)
      })
    case 'workspace.inspect':
      return dependencies.core.request('workspaces.inspect', { path: stringField(input, 'path') })
    case 'camp.create':
      return dependencies.core.request<StoredCommandResult>('camps.create', input)
    case 'camp.send':
      return sendCampMessage(dependencies, input)
    case 'camp.open':
      return dependencies.openCamp(stringField(input, 'campId'))
    case 'agentRun.diagnostic':
      return dependencies.core.request<AgentRunDiagnosticView>('agentRuns.diagnostic.get', {
        agentRunId: stringField(input, 'agentRunId')
      })
    case 'domain.events':
      return dependencies.core.request('events.subscribe', {
        campId: stringField(input, 'campId'),
        afterGlobalSequence: input.afterGlobalSequence ?? 0,
        limit: input.limit ?? 500
      })
    case 'evidence.list':
      return dependencies.core.request('agentRunEvidence.list', {
        campId: stringField(input, 'campId'),
        agentRunId: stringField(input, 'agentRunId'),
        afterSequence: input.afterSequence ?? 0,
        limit: input.limit ?? 500
      })
    case 'agentRun.cancel': {
      const agentRunId = stringField(input, 'agentRunId')
      const diagnostic = await dependencies.core.request<AgentRunDiagnosticView>(
        'agentRuns.diagnostic.get',
        { agentRunId }
      )
      return dependencies.core.request<StoredCommandResult>('agentRuns.cancel', {
        commandId: stringField(input, 'commandId'),
        command: {
          campId: diagnostic.campId,
          agentRunId,
          expectedVersion: diagnostic.version
        }
      })
    }
    default:
      throw new UserAutomationError(
        'automation_operation_unsupported',
        `Unsupported User Automation operation: ${operation}`
      )
  }
}

async function removeStaleSocket(path: string): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isSocket()) {
      throw new UserAutomationError(
        'automation_endpoint_unsafe',
        'The Automation endpoint path is occupied by a non-socket file.'
      )
    }
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function atomicWritePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

function responseError(error: unknown): { code: string; message: string } {
  if (error instanceof UserAutomationError) {
    return { code: error.code, message: error.message }
  }
  console.error('[rovai] User Automation request failed.', error)
  return {
    code: 'automation_internal_error',
    message: 'The User Automation request could not be completed.'
  }
}

export class UserAutomationServer {
  #server: Server | null = null
  #context: AutomationContext | null = null

  constructor(
    private readonly rootPath: string,
    private readonly dependencies: AutomationDependencies
  ) {}

  get contextPath(): string {
    return join(this.rootPath, 'connection-v1.json')
  }

  async start(): Promise<void> {
    if (process.platform === 'win32') {
      throw new UserAutomationError(
        'automation_platform_unsupported',
        'User Automation V1 currently requires a Unix-domain socket.'
      )
    }
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 })
    const rootMetadata = await lstat(this.rootPath)
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new UserAutomationError(
        'automation_endpoint_unsafe',
        'The Automation data root is not a private directory.'
      )
    }
    await chmod(this.rootPath, 0o700)
    const endpointPath = join(this.rootPath, 'app.sock')
    await removeStaleSocket(endpointPath)
    const context: AutomationContext = {
      contractVersion: USER_AUTOMATION_CONTRACT_VERSION,
      instanceId: randomUUID(),
      pid: process.pid,
      endpoint: { transport: 'unix_socket', path: endpointPath },
      credential: randomBytes(32).toString('hex')
    }
    const server = createServer((socket) => this.#handle(socket, context))
    server.unref()
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(endpointPath, () => {
        server.off('error', onError)
        resolve()
      })
    })
    try {
      await chmod(endpointPath, 0o600)
      await atomicWritePrivateJson(this.contextPath, context)
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await unlink(endpointPath).catch(() => undefined)
      throw error
    }
    this.#server = server
    this.#context = context
  }

  async stop(): Promise<void> {
    const server = this.#server
    const context = this.#context
    this.#server = null
    this.#context = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    if (context) {
      await unlink(context.endpoint.path).catch(() => undefined)
      try {
        const published = JSON.parse(await readFile(this.contextPath, 'utf8')) as AutomationContext
        if (published.instanceId === context.instanceId) await unlink(this.contextPath)
      } catch {
        // Stale or replaced discovery records are handled safely by the next start.
      }
    }
  }

  #handle(socket: Socket, context: AutomationContext): void {
    let bytes = 0
    let frame = ''
    let completed = false
    const finish = async (request: AutomationRequest): Promise<void> => {
      if (completed) return
      completed = true
      let response: unknown
      try {
        if (
          request.contractVersion !== USER_AUTOMATION_CONTRACT_VERSION
          || request.instanceId !== context.instanceId
          || request.credential !== context.credential
          || typeof request.requestId !== 'string'
          || typeof request.operation !== 'string'
        ) {
          throw new UserAutomationError(
            'automation_unauthorized',
            'The User Automation credential or contract is invalid.'
          )
        }
        let result = await dispatchUserAutomation(
          request.operation,
          request.params,
          this.dependencies
        )
        if (request.operation === 'status' && result && typeof result === 'object') {
          result = { ...result, instanceId: context.instanceId }
        }
        response = { requestId: request.requestId, ok: true, result }
      } catch (error) {
        response = { requestId: request.requestId, ok: false, error: responseError(error) }
      }
      socket.end(`${JSON.stringify(response)}\n`)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(REQUEST_TIMEOUT_MILLISECONDS, () => socket.destroy())
    socket.on('data', (chunk: string) => {
      if (completed) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_FRAME_BYTES) {
        completed = true
        socket.end(`${JSON.stringify({
          ok: false,
          error: { code: 'automation_frame_too_large', message: 'Automation request is too large.' }
        })}\n`)
        return
      }
      frame += chunk
      const newline = frame.indexOf('\n')
      if (newline < 0) return
      const raw = frame.slice(0, newline).trim()
      try {
        void finish(JSON.parse(raw) as AutomationRequest)
      } catch {
        completed = true
        socket.end(`${JSON.stringify({
          ok: false,
          error: { code: 'automation_invalid_json', message: 'Automation request is invalid JSON.' }
        })}\n`)
      }
    })
  }
}

export function userAutomationRoot(
  appDataPath: string,
  userDataPath: string,
  hasExplicitUserDataDirectory: boolean
): string {
  return hasExplicitUserDataDirectory
    ? join(userDataPath, 'automation-v1')
    : join(appDataPath, 'Rovai AI', 'automation-v1')
}
