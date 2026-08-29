import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const DINGTALK_DWS_VERSION = '1.0.60'

const DWS_SHA256: Readonly<Record<string, string>> = {
  'darwin-arm64': '5998d83346839048f555c3abe4ff7207191317759dd720ba46e883cefe4bf777',
  'darwin-x64': 'fd66b021f83ea0468e39470b4b9d9736e6b7cac8f2158e09cd9a65da0bad3347',
  'win32-x64': '6eccc842f09e661fa3a1aefd2231b8ae849e9542903bf87da6499e24ab1ae3d3'
}

export type DingTalkGatewayOperation =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.status'
  | 'profile.switch'
  | 'app.create'
  | 'app.get'
  | 'app.update'
  | 'app.credentials.get'
  | 'app.robot.get'
  | 'app.robot.config'
  | 'app.robot.enable'
  | 'app.permission.list'
  | 'app.permission.add'
  | 'app.event.list'
  | 'app.event.subscribe'
  | 'app.version.create'
  | 'app.version.checkApproval'
  | 'app.version.publish'
  | 'app.version.status'

export type DingTalkGatewayRequest = {
  operation: DingTalkGatewayOperation
  values?: Readonly<Record<string, string | boolean | readonly string[] | undefined>>
  signal?: AbortSignal
  timeoutMs?: number
}

export type DingTalkGatewayBackend = {
  execute(request: DingTalkGatewayRequest): Promise<unknown>
}

export type DingTalkDeveloperGatewayOptions = {
  binaryPath: string
  archivePath?: string
  configDir: string
  expectedSha256: string
  oauthClientId?: string
  oauthClientSecret?: string
  env?: NodeJS.ProcessEnv
}

const COMMANDS: Readonly<Record<DingTalkGatewayOperation, readonly string[]>> = {
  'auth.login': ['auth', 'login'],
  'auth.logout': ['auth', 'logout'],
  'auth.status': ['auth', 'status'],
  'profile.switch': ['profile', 'switch'],
  'app.create': ['devapp', '+create'],
  'app.get': ['devapp', '+get'],
  'app.update': ['devapp', '+update'],
  'app.credentials.get': ['devapp', '+credentials-get'],
  'app.robot.get': ['devapp', '+robot-get'],
  'app.robot.config': ['devapp', '+robot-config'],
  'app.robot.enable': ['devapp', '+robot-enable'],
  'app.permission.list': ['devapp', '+permission-list'],
  // These two write surfaces intentionally use the reviewed full command.
  // The v1.0.60 shortcut catalog keeps +permission-add and +version-publish
  // unavailable even though their full Developer commands are public.
  'app.permission.add': ['dev', 'app', 'permission', 'add'],
  'app.event.list': ['devapp', '+event-list'],
  'app.event.subscribe': ['devapp', '+event-subscribe'],
  'app.version.create': ['devapp', '+version-create'],
  'app.version.checkApproval': ['devapp', '+version-check-approval'],
  'app.version.publish': ['dev', 'app', 'version', 'publish'],
  'app.version.status': ['devapp', '+version-status']
}

const FLAGS: Readonly<Record<string, string>> = {
  appName: '--name',
  description: '--desc',
  unifiedAppId: '--unified-app-id',
  iconMediaId: '--icon-media-id',
  robotName: '--name',
  robotBrief: '--brief',
  robotDescription: '--desc',
  mode: '--mode',
  addScope: '--add-scope',
  scopeValues: '--scope-values',
  eventCodes: '--event-codes',
  scopeValue: '--scope-value',
  authStatus: '--auth-status',
  keyword: '--keyword',
  pageSize: '--page-size',
  versionId: '--version-id',
  versionDescription: '--desc',
  approverUserId: '--approver-user-id',
  confirmedSensitive: '--confirmed-sensitive',
  device: '--device',
  profile: '--profile'
}

const MUTATIONS = new Set<DingTalkGatewayOperation>([
  'app.create', 'app.update', 'app.robot.config', 'app.robot.enable',
  'app.permission.add', 'app.event.subscribe', 'app.version.create',
  'app.version.publish'
])

export class DingTalkDeveloperGateway implements DingTalkGatewayBackend {
  readonly #options: DingTalkDeveloperGatewayOptions
  #verified = false

  constructor(options: DingTalkDeveloperGatewayOptions) {
    this.#options = options
  }

  async execute(request: DingTalkGatewayRequest): Promise<unknown> {
    await this.#verifyBinary()
    const invocation = buildDingTalkGatewayInvocation(request, {
      oauthClientId: this.#options.oauthClientId,
      oauthClientSecret: this.#options.oauthClientSecret
    })
    const timeoutMs = request.timeoutMs
      ?? (request.operation === 'auth.login' ? 10 * 60_000 : 120_000)
    return runDws({
      binaryPath: this.#options.binaryPath,
      args: invocation.args,
      configDir: this.#options.configDir,
      env: { ...this.#options.env, ...invocation.env },
      signal: request.signal,
      timeoutMs
    })
  }

  async #verifyBinary(): Promise<void> {
    if (this.#verified) return
    await materializeDingTalkDwsBinary(this.#options)
    await access(this.#options.binaryPath, constants.X_OK)
      .catch(() => { throw new Error('dingtalk_dws_unavailable') })
    const digest = createHash('sha256')
      .update(await readFile(this.#options.binaryPath))
      .digest('hex')
    if (digest !== this.#options.expectedSha256) {
      throw new Error('dingtalk_dws_integrity_failed')
    }
    this.#verified = true
  }
}

export function buildDingTalkGatewayInvocation(
  request: Pick<DingTalkGatewayRequest, 'operation' | 'values'>,
  oauth: Pick<DingTalkDeveloperGatewayOptions, 'oauthClientId' | 'oauthClientSecret'> = {}
): { args: string[]; env: NodeJS.ProcessEnv } {
  const command = COMMANDS[request.operation]
  if (!command) throw new Error('dingtalk_gateway_operation_rejected')
  const values = { ...request.values }
  const positional: string[] = []
  if (request.operation === 'profile.switch') {
    const selector = values.profileSelector
    delete values.profileSelector
    if (typeof selector !== 'string' || !canonicalArg(selector)) {
      throw new Error('dingtalk_gateway_argument_invalid:profileSelector')
    }
    positional.push(selector)
  }
  const args = [...command, ...positional, ...gatewayArgs(values)]
  const env: NodeJS.ProcessEnv = {}
  if (request.operation === 'auth.login') {
    const clientId = oauth.oauthClientId?.trim()
    const clientSecret = oauth.oauthClientSecret?.trim()
    if (!clientId || !clientSecret) throw new Error('dingtalk_oauth_client_unconfigured')
    // DWS officially accepts the OAuth client pair through these environment
    // variables. Keep the secret out of argv so it is not visible in the
    // process list while the browser/device authorization is in progress.
    env.DWS_CLIENT_ID = clientId
    env.DWS_CLIENT_SECRET = clientSecret
  }
  if (MUTATIONS.has(request.operation)) args.push('--yes')
  if (request.operation !== 'auth.login') args.push('--format', 'json')
  return { args, env }
}

export function resolveDingTalkDwsOptions(input: {
  appRoot: string
  resourcesPath: string
  packaged: boolean
  userDataPath: string
  platform?: NodeJS.Platform
  arch?: string
  oauthClientId?: string
  oauthClientSecret?: string
}): DingTalkDeveloperGatewayOptions {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const key = `${platform}-${arch}`
  const expectedSha256 = DWS_SHA256[key]
  if (!expectedSha256) throw new Error('dingtalk_dws_platform_unsupported')
  const executable = platform === 'win32' ? 'dws.exe' : 'dws'
  const target = platform === 'darwin'
    ? `macos-${arch === 'x64' ? 'x64' : 'arm64'}`
    : 'windows-x64'
  const packagedMacosBinaryPath = join(
    input.userDataPath,
    'channel-runtime',
    'dingtalk-dws',
    `v${DINGTALK_DWS_VERSION}`,
    expectedSha256,
    executable
  )
  return {
    binaryPath: input.packaged
      ? platform === 'darwin'
        ? packagedMacosBinaryPath
        : join(input.resourcesPath, 'bin', executable)
      : join(input.appRoot, 'resources', 'bin', target, executable),
    archivePath: input.packaged && platform === 'darwin'
      ? join(input.resourcesPath, 'bin', `${executable}.gz`)
      : undefined,
    configDir: join(input.userDataPath, 'channel-auth', 'dingtalk-dws'),
    expectedSha256,
    oauthClientId: input.oauthClientId,
    oauthClientSecret: input.oauthClientSecret
  }
}

export async function materializeDingTalkDwsBinary(
  options: Pick<DingTalkDeveloperGatewayOptions, 'archivePath' | 'binaryPath' | 'expectedSha256'>
): Promise<void> {
  if (!options.archivePath) return
  if (await fileMatchesDigest(options.binaryPath, options.expectedSha256)) {
    await chmod(options.binaryPath, 0o700)
      .catch(() => { throw new Error('dingtalk_dws_unavailable') })
    return
  }

  let archive: Buffer
  try {
    archive = await readFile(options.archivePath)
  } catch {
    throw new Error('dingtalk_dws_unavailable')
  }
  let binary: Buffer
  try {
    binary = gunzipSync(archive)
  } catch {
    throw new Error('dingtalk_dws_integrity_failed')
  }
  if (digest(binary) !== options.expectedSha256) {
    throw new Error('dingtalk_dws_integrity_failed')
  }

  const directory = dirname(options.binaryPath)
  const temporaryPath = join(directory, `.${basename(options.binaryPath)}.${randomUUID()}.tmp`)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    await writeFile(temporaryPath, binary, { flag: 'wx', mode: 0o700 })
    await chmod(temporaryPath, 0o700)
    await rename(temporaryPath, options.binaryPath)
  } catch {
    throw new Error('dingtalk_dws_unavailable')
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }

  if (!await fileMatchesDigest(options.binaryPath, options.expectedSha256)) {
    throw new Error('dingtalk_dws_integrity_failed')
  }
}

async function fileMatchesDigest(path: string, expectedSha256: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false
    return digest(await readFile(path)) === expectedSha256
  } catch {
    return false
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function gatewayArgs(
  values: Readonly<Record<string, string | boolean | readonly string[] | undefined>> = {}
): string[] {
  const args: string[] = []
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    const flag = FLAGS[key]
    if (!flag) throw new Error(`dingtalk_gateway_argument_rejected:${key}`)
    if (typeof value === 'boolean') {
      if (value) args.push(flag)
      else args.push(`${flag}=false`)
    } else if (typeof value !== 'string') {
      if (value.length === 0 || value.some((item) => !canonicalArg(item))) {
        throw new Error(`dingtalk_gateway_argument_invalid:${key}`)
      }
      args.push(flag, value.join(','))
    } else {
      if (!canonicalArg(value)) throw new Error(`dingtalk_gateway_argument_invalid:${key}`)
      args.push(flag, value)
    }
  }
  return args
}

function canonicalArg(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 4_096 && !value.includes('\0')
}

async function runDws(input: {
  binaryPath: string
  args: string[]
  configDir: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  timeoutMs: number
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new Error('dingtalk_operation_cancelled'))
      return
    }
    const child = spawn(input.binaryPath, input.args, {
      env: {
        ...process.env,
        ...input.env,
        DWS_CONFIG_DIR: input.configDir,
        NO_COLOR: '1'
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8')
      return next.length > 2_000_000 ? next.slice(-2_000_000) : next
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const finishWithError = (code: string): void => {
      child.kill('SIGTERM')
      reject(new Error(code))
    }
    const timer = setTimeout(() => finishWithError('dingtalk_dws_timeout'), input.timeoutMs)
    timer.unref?.()
    const onAbort = (): void => finishWithError('dingtalk_operation_cancelled')
    input.signal?.addEventListener('abort', onAbort, { once: true })
    child.once('error', () => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      reject(new Error('dingtalk_dws_unavailable'))
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      if (input.signal?.aborted) return reject(new Error('dingtalk_operation_cancelled'))
      if (code !== 0) {
        // DWS failures can contain token-shaped values and developer identity
        // fields. Keep the Renderer-facing error stable and opaque; callers
        // can still classify the operation without receiving child output.
        void redactText(stderr || stdout)
        return reject(new Error('dingtalk_dws_failed'))
      }
      if (input.args[0] === 'auth' && ['login', 'logout'].includes(input.args[1] ?? '')) {
        return resolve({ completed: true })
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('dingtalk_dws_response_invalid'))
      }
    })
  })
}

function redactText(value: string): string {
  return value
    .replace(/(app(?:_|\s*)secret|access(?:_|\s*)token|refresh(?:_|\s*)token)\s*[:=]\s*\S+/giu, '$1=[REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
}
