import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const fixture = join(root, 'crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')
const temporary = await mkdtemp(join(tmpdir(), 'rovai-native-mcp-smoke-'))
const selected = (process.env.ROVAI_MCP_SMOKE_ADAPTERS
  ?? 'codex-cli,claude-code-cli,opencode-cli,copilot-cli')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const supported = new Set([
  'codex-cli',
  'claude-code-cli',
  'opencode-cli',
  'copilot-cli',
  'codebuddy-cli',
  'qwen-code'
])

try {
  for (const adapter of selected) {
    if (!supported.has(adapter)) throw new Error(`Unsupported MCP smoke Adapter: ${adapter}`)
  }
  const node = process.execPath
  const results = []
  for (const adapter of selected) {
    const expected = `rovai-mcp-smoke:${adapterName(adapter)}`
    const prompt = `Call the rovai_smoke echo tool exactly once with text ${adapterName(adapter)}. Then output only its result.`
    const startedAt = Date.now()
    const { output, version } = await runAdapter(adapter, { node, fixture, prompt, expected, temporary })
    assert(output.includes(expected), `${adapter} did not return ${expected}: ${output}`)
    results.push({
      adapter,
      version: firstLine(version),
      result: expected,
      durationMs: Date.now() - startedAt
    })
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2))
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function runAdapter(adapter, context) {
  switch (adapter) {
    case 'codex-cli':
      return runCodex(context)
    case 'claude-code-cli':
      return runClaude(context)
    case 'opencode-cli':
      return runOpenCode(context)
    case 'copilot-cli':
      return runCopilot(context)
    case 'codebuddy-cli':
      return runCodeBuddy(context)
    case 'qwen-code':
      return runQwen(context)
    default:
      throw new Error(`Unsupported Adapter: ${adapter}`)
  }
}

async function runCodex({ node, fixture, prompt, temporary }) {
  const lastMessage = join(temporary, 'codex-last-message.txt')
  const table = `{rovai_smoke={command=${tomlString(node)},args=[${tomlString(fixture)}],default_tools_approval_mode="approve"}}`
  const output = await run('codex', [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--color', 'never',
    '-o', lastMessage,
    '-c', `mcp_servers=${table}`,
    '-c', 'approval_policy="never"',
    prompt
  ])
  return {
    output: `${output}\n${await readFile(lastMessage, 'utf8')}`,
    version: await run('codex', ['--version'])
  }
}

async function runClaude({ node, fixture, prompt, temporary }) {
  const config = join(temporary, 'claude-mcp.json')
  await writeFile(config, `${JSON.stringify({
    mcpServers: {
      rovai_smoke: {
        type: 'stdio',
        command: node,
        args: [fixture]
      }
    }
  }, null, 2)}\n`, { mode: 0o600 })
  const output = await run('claude', [
    '--print',
    '--output-format', 'json',
    '--model', process.env.ROVAI_MCP_CLAUDE_MODEL ?? 'haiku',
    '--max-budget-usd', process.env.ROVAI_MCP_CLAUDE_BUDGET ?? '0.12',
    '--mcp-config', config,
    '--allowedTools=mcp__rovai_smoke__echo'
  ], {}, prompt)
  return { output, version: await run('claude', ['--version']) }
}

async function runOpenCode({ node, fixture, prompt, temporary }) {
  const config = JSON.stringify({
    permission: 'allow',
    mcp: {
      rovai_smoke: {
        type: 'local',
        command: [node, fixture],
        enabled: true
      }
    }
  })
  const output = await run('opencode', [
    'run',
    '--model', process.env.ROVAI_MCP_OPENCODE_MODEL ?? 'opencode/mimo-v2.5-free',
    '--format', 'json',
    prompt
  ], {
    OPENCODE_CONFIG_CONTENT: config
  })
  return { output, version: await run('opencode', ['--version']) }
}

async function runCopilot({ node, fixture, prompt }) {
  const config = JSON.stringify({
    mcpServers: {
      rovai_smoke: {
        type: 'local',
        command: node,
        args: [fixture],
        tools: ['*']
      }
    }
  })
  const output = await run('copilot', [
    '--additional-mcp-config', config,
    '--allow-all-tools',
    '--no-custom-instructions',
    '--no-remote',
    '--no-remote-export',
    '--no-auto-update',
    '--no-color',
    '--silent',
    '--prompt', prompt
  ])
  return { output, version: await run('copilot', ['--version']) }
}

async function runCodeBuddy({ node, fixture, prompt, temporary }) {
  const config = await writeAdditiveConfig(temporary, 'codebuddy', node, fixture)
  const output = await run('codebuddy', [
    '--print',
    '--output-format', 'json',
    '--permission-mode', 'bypassPermissions',
    '--mcp-config', config,
    '--allowedTools=mcp__rovai_smoke__echo',
    '--no-session-persistence',
    prompt
  ])
  return { output, version: await run('codebuddy', ['--version']) }
}

async function runQwen({ node, fixture, prompt, temporary }) {
  const config = await writeAdditiveConfig(temporary, 'qwen', node, fixture)
  const output = await run('qwen', [
    '--prompt', prompt,
    '--output-format', 'json',
    '--approval-mode', 'yolo',
    '--mcp-config', config
  ])
  return { output, version: await run('qwen', ['--version']) }
}

async function writeAdditiveConfig(temporary, runtime, node, fixture) {
  const config = join(temporary, `${runtime}-mcp.json`)
  await writeFile(config, `${JSON.stringify({
    mcpServers: {
      rovai_smoke: {
        type: 'stdio',
        command: node,
        args: [fixture]
      }
    }
  }, null, 2)}\n`, { mode: 0o600 })
  return config
}

function run(command, args, environment = {}, input = null) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      rejectRun(new Error(`${command} timed out after 180 seconds`))
    }, 180_000)
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    if (input !== null) child.stdin.end(input)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolveRun(`${stdout.join('')}\n${stderr.join('')}`)
      else rejectRun(new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`))
    })
  })
}

function adapterName(adapter) {
  return ({
    'codex-cli': 'codex',
    'claude-code-cli': 'claude',
    'opencode-cli': 'opencode',
    'copilot-cli': 'copilot',
    'codebuddy-cli': 'codebuddy',
    'qwen-code': 'qwen'
  })[adapter]
}

function tomlString(value) {
  return JSON.stringify(value)
}

function firstLine(value) {
  return value.trim().split(/\r?\n/, 1)[0]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
