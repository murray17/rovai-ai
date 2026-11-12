import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const repository = resolve(import.meta.dirname, '../..')
const cli = join(repository, 'target/debug', process.platform === 'win32' ? 'rovai.exe' : 'rovai')

// Owns the CLI process/IPC seam. Input matrices belong to the Rust parser tests;
// this fixture neither starts Core nor claims actual message publication.
test('CLI discovery stays local and Send files preserve requests without waiting on inherited stdin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-send-cli-'))
  // The child obtains cwd from the OS, which resolves macOS's /var alias.
  const cliCwd = await realpath(root)
  const socket = process.platform === 'win32'
    ? `\\\\.\\pipe\\rovai-ai-${process.pid}-4b812837-7ffc-4ca2-ab62-d5dc89bcd411`
    : join(root, 'cli.sock')
  const requests = []
  let rejection = { code: 'message.invalid_input', message: 'Fixture business rejection.', recovery: 'fix_input' }
  const server = createServer(connection => {
    let frame = ''
    connection.setEncoding('utf8')
    connection.on('data', chunk => {
      frame += chunk
      if (!frame.endsWith('\n')) return
      const request = JSON.parse(frame)
      requests.push(request)
      connection.end(`${JSON.stringify({ kind: 'envelope', envelope: {
        contractVersion: 2, ok: false, operation: request.operation,
        requestId: request.request_id, error: rejection
      } })}\n`)
    })
  })
  server.listen(socket)
  await once(server, 'listening')
  const contextPath = join(root, 'context.json')
  const version = Number((await readFile(join(repository, 'crates/rovai-core/src/builtin_tool_transport.rs'), 'utf8'))
    .match(/BUILTIN_TOOL_CONTRACT_VERSION: u32 = (\d+);/u)[1])
  const context = {
    contractVersion: version, ipcProtocolVersion: 3,
    coreEndpoint: process.platform === 'win32'
      ? { transport: 'windows_named_pipe', name: socket } : { transport: 'unix_socket', path: socket },
    processId: 'fixture', processToken: 'fixture',
    lease: { executionRoot: root, runTmp: root, leaseId: 'fixture', leaseGeneration: 1, leaseToken: 'fixture' }
  }
  await writeFile(contextPath, JSON.stringify(context))
  async function run(args, stdin, jsonOutput = true) {
    const child = spawn(cli, args, {
      cwd: root, env: { ...process.env, ROVAI_CLI_CONTEXT: contextPath, ROVAI_RUN_TMP: root },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const timer = setTimeout(() => child.kill(), 5000)
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    if (stdin !== undefined) child.stdin.end(stdin)
    try {
      const [code, signal] = await once(child, 'close')
      assert.equal(signal, null, `CLI blocked with stdin open: ${args.join(' ')}`)
      assert.equal(stderr, '')
      return { code, output: jsonOutput ? JSON.parse(stdout) : stdout }
    } finally {
      clearTimeout(timer)
      child.stdin.destroy()
    }
  }
  async function reachesCore(args, expected, stdin, exitCode = 1) {
    const before = requests.length
    const result = await run(args, stdin)
    assert.equal(result.code, exitCode, JSON.stringify({ result, dispatched: requests.length - before }))
    assert.deepEqual(result.output, { error: rejection })
    assert.equal(requests.length, before + 1, 'business rejection must not trigger fallback or a second request')
    assert.deepEqual(requests.at(-1).input, expected)
    const fileIndex = args.indexOf('--input-file')
    assert.equal(requests.at(-1).sendInputFilePath,
      args[0] === 'send' && fileIndex >= 0
        ? resolve(cliCwd, args[fileIndex + 1]).replaceAll('\\', '/') : undefined)
  }
  async function rejected(args, message, stdin) {
    const before = requests.length
    const result = await run(args, stdin)
    assert.equal(result.code, 2)
    assert.equal(result.output.error.code, 'builtin_tool.invalid_input')
    assert.equal(result.output.error.recovery, 'fix_input')
    if (message) assert.equal(result.output.error.message, message)
    assert.equal(requests.length, before, 'input failure must not contact Core')
    assert.ok(!JSON.stringify(result.output).includes(root), 'local paths must not leak')
  }
  try {
    // Discovery is local even with an active IPC endpoint. Missing, malformed,
    // old, future and unbound projections must not advertise Tasks.
    for (const projection of [
      null, '{', context, { ...context, tasksEnabled: false },
      { ...context, tasksEnabled: true, contractVersion: version - 1 },
      { ...context, tasksEnabled: true, contractVersion: version + 1 },
      { ...context, tasksEnabled: true, lease: null }
    ]) {
      if (projection === null) await rm(contextPath, { force: true })
      else await writeFile(contextPath, typeof projection === 'string' ? projection : JSON.stringify(projection))
      const help = await run(['--help'], undefined, false)
      assert.equal(help.code, 0)
      assert.ok(!help.output.includes('rovai task'))
      for (const args of [['task', '--help'], ['task', 'get', '--help'], ['task', 'list']]) {
        const disabled = await run(args)
        assert.equal(disabled.code, 2)
        assert.deepEqual(disabled.output, { error: {
          code: 'task.feature_disabled', message: 'Tasks are disabled. Continue with messages.', recovery: 'stop'
        } })
      }
    }
    await writeFile(contextPath, JSON.stringify({ ...context, tasksEnabled: true }))
    assert.ok((await run(['--help'], undefined, false)).output.includes('rovai task'))
    assert.equal((await run(['task', 'get', '--help'], undefined, false)).code, 0)
    assert.ok(!(await run(['send', '--help'], undefined, false)).output.includes('--task-id'))
    assert.equal(requests.length, 0, 'help and disabled Task calls must not contact Core')
    await writeFile(contextPath, JSON.stringify({ ...context, tasksEnabled: true, memoryEnabled: true }))
    assert.ok((await run(['--help'], undefined, false)).output.includes('rovai memory'))
    assert.equal((await run(['memory', 'read', '--help'], undefined, false)).code, 0)
    await writeFile(contextPath, JSON.stringify({ ...context, tasksEnabled: true, memoryEnabled: false }))
    assert.ok(!(await run(['--help'], undefined, false)).output.includes('rovai memory'))
    assert.ok((await run(['--help'], undefined, false)).output.includes('rovai task'))
    assert.equal(requests.length, 0, 'ordinary capability help does not contact Core')
    const originalRejection = rejection
    rejection = { code: 'memory.feature_disabled', message: 'Rovai long-term memory is disabled.', recovery: 'stop' }
    await reachesCore(['memory', 'view', '--scope', 'hearth'], { scope: 'hearth' }, undefined, 2)
    await reachesCore(['memory', 'write', '--action', 'add', '--scope', 'companion', '--kind', 'agreement',
      '--body', 'Preserve an already committed memory receipt.', '--retrieval-keys', 'memory receipts'],
      { action: 'add', scope: 'companion', kind: 'agreement', body: 'Preserve an already committed memory receipt.', retrievalKeys: ['memory receipts'] }, undefined, 2)
    rejection = originalRejection
    await writeFile(contextPath, JSON.stringify(context))
    const raw = ' 中文 🌸\r\n# Markdown\n\n"quote" `code` \\n\n'
    await writeFile(join(root, 'reply.md'), raw)
    await reachesCore(['send', '--public-only', '--input-file', 'reply.md'], { body: raw, publicOnly: true })
    await reachesCore(['send', '--input-file', 'reply.md', '--to', 'agent_5', '--file', 'report.pdf'], {
      body: raw, to: ['agent_5'], files: ['report.pdf']
    })
    await reachesCore(['send', '--input-file', '././reply.md'], { body: raw })
    assert.equal(await readFile(join(root, 'reply.md'), 'utf8'), raw)
    const legacy = { body: 'legacy\nreply', publicOnly: true, mentionUser: true, files: ['report.pdf'] }
    await writeFile(join(root, 'request.json'), JSON.stringify(legacy))
    await reachesCore(['send', '--input-file', 'request.json'], legacy)
    await reachesCore(['send'], legacy, JSON.stringify(legacy))
    await reachesCore(['send', '--body', 'direct', '--public-only'], { body: 'direct', publicOnly: true })
    await reachesCore(['send', '--body', 'legacy', '--to', 'agent_5', '--task-id', 'task-1'], {
      body: 'legacy', to: ['agent_5'], taskId: 'task-1'
    })
    await rejected(['send', '--input-file', 'request.json', '--public-only'],
      'The input file matches a complete Send request and cannot be combined with command-line send options.')
    for (const [args, stdin] of [
      [['send', '--input-file', 'reply.md', '--body', 'second']],
      [['send', '--input-file', 'reply.md', '--input-file', 'reply.md']],
      [['send', '--input-file', 'missing']],
      [['send', '--input-file', '.']],
      [['send'], 'plain text is not JSON stdin'],
      [['member', 'list', '--input-file', 'reply.md']],
      [['member', 'get', '--input-file', 'request.json', '--agent-id', 'agent_5']]
    ]) await rejected(args, undefined, stdin)
    for (const bytes of [Buffer.from([0xff]), Buffer.from('body\0tail'), Buffer.alloc(32769, 0x61)]) {
      await writeFile(join(root, 'bad.txt'), bytes)
      await rejected(['send', '--input-file', 'bad.txt'])
    }
    await writeFile(join(root, 'members.json'), '{}')
    await reachesCore(['member', 'list', '--input-file', 'members.json'], {})
    if (process.platform !== 'win32') {
      const fifo = join(root, 'pipe')
      execFileSync('mkfifo', [fifo])
      await rejected(['send', '--input-file', fifo])
      await rejected(['send', '--input-file', '/dev/null'])
      if (process.getuid() !== 0) {
        await chmod(join(root, 'reply.md'), 0)
        await rejected(['send', '--input-file', 'reply.md'])
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
