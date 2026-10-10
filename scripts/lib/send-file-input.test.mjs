import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const repository = resolve(import.meta.dirname, '../..')
const cli = join(repository, 'target/debug', process.platform === 'win32' ? 'rovai.exe' : 'rovai')

// Owns the CLI process/IPC seam. Input matrices belong to the Rust parser tests;
// this fixture neither starts Core nor claims actual message publication.
test('Send files preserve the IPC request, fail before dispatch and never wait on inherited stdin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-send-cli-'))
  const socket = process.platform === 'win32'
    ? `\\\\.\\pipe\\rovai-ai-${process.pid}-4b812837-7ffc-4ca2-ab62-d5dc89bcd411`
    : join(root, 'cli.sock')
  const requests = []
  const rejection = { code: 'message.invalid_input', message: 'Fixture business rejection.', recovery: 'fix_input' }
  const server = createServer(connection => {
    let frame = ''
    connection.setEncoding('utf8')
    connection.on('data', chunk => {
      frame += chunk
      if (!frame.endsWith('\n')) return
      const request = JSON.parse(frame)
      requests.push(request)
      const preimage = {
        contractVersion: 1, domain: 'rovai.builtin-tool-receipt.v1', ok: false,
        operation: request.operation, requestId: request.request_id, resultOrError: rejection
      }
      const receipt = `sha256:${createHash('sha256').update(JSON.stringify(preimage)).digest('hex')}`
      connection.end(`${JSON.stringify({ kind: 'envelope', envelope: {
        contractVersion: 1, ok: false, operation: request.operation,
        requestId: request.request_id, receipt, error: rejection
      } })}\n`)
    })
  })
  server.listen(socket)
  await once(server, 'listening')
  const contextPath = join(root, 'context.json')
  const version = Number((await readFile(join(repository, 'crates/rovai-core/src/builtin_tool_transport.rs'), 'utf8'))
    .match(/BUILTIN_TOOL_CONTRACT_VERSION: u32 = (\d+);/u)[1])
  await writeFile(contextPath, JSON.stringify({
    contractVersion: version, ipcProtocolVersion: 2,
    coreEndpoint: process.platform === 'win32'
      ? { transport: 'windows_named_pipe', name: socket } : { transport: 'unix_socket', path: socket },
    processId: 'fixture', processToken: 'fixture',
    lease: { executionRoot: root, runTmp: root, leaseId: 'fixture', leaseGeneration: 1, leaseToken: 'fixture' }
  }))
  async function run(args, stdin) {
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
      return { code, output: JSON.parse(stdout) }
    } finally {
      clearTimeout(timer)
      child.stdin.destroy()
    }
  }
  async function reachesCore(args, expected, stdin) {
    const before = requests.length
    const result = await run(args, stdin)
    assert.equal(result.code, 1, JSON.stringify({ result, dispatched: requests.length - before }))
    assert.deepEqual(result.output, { error: rejection })
    assert.equal(requests.length, before + 1, 'business rejection must not trigger fallback or a second request')
    assert.deepEqual(requests.at(-1).input, expected)
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
    const raw = ' 中文 🌸\r\n# Markdown\n\n"quote" `code` \\n\n'
    await writeFile(join(root, 'reply.md'), raw)
    await reachesCore(['send', '--public-only', '--input-file', 'reply.md'], { body: raw, publicOnly: true })
    await reachesCore(['send', '--input-file', 'reply.md', '--to', 'agent_5', '--file', 'report.pdf'], {
      body: raw, to: ['agent_5'], files: ['report.pdf']
    })
    assert.equal(await readFile(join(root, 'reply.md'), 'utf8'), raw)
    const legacy = { body: 'legacy\nreply', publicOnly: true, mentionUser: true, files: ['report.pdf'] }
    await writeFile(join(root, 'request.json'), JSON.stringify(legacy))
    await reachesCore(['send', '--input-file', 'request.json'], legacy)
    await reachesCore(['send'], legacy, JSON.stringify(legacy))
    await reachesCore(['send', '--body', 'direct', '--public-only'], { body: 'direct', publicOnly: true })
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
