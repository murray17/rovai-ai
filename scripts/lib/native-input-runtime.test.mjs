import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
for (const scenario of ['matching-scope', 'wrong-scope', 'uncertain-ack']) {
  test('native input fixture publication: ' + scenario, { timeout: 10_000 }, async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'rovai-input-scope-'))
    let child, exited
    try {
      const cli = join(fixture, 'cli'), program = join(fixture, 'cli.mjs')
      const sent = join(fixture, 'sent'), result = join(fixture, 'result.json'), control = join(fixture, 'control.json')
      await writeFile(program, "import{appendFileSync}from'node:fs';\n"
        + "if(process.argv[2]==='thread')console.log(JSON.stringify({threadId:process.env.ROVAI_INPUT_FIXTURE_THREAD}));\n"
        + "else{appendFileSync(process.env.ROVAI_INPUT_FIXTURE_SENT,'sent\\n');console.log(JSON.stringify({messageId:'fixture-message',agentAddressingMode:process.env.ROVAI_INPUT_FIXTURE_ACK,effectiveRecipients:[],deliveryIds:[]}))}\n")
      await writeFile(cli, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(program) + ' "$@"\n')
      await chmod(cli, 0o700)
      await writeFile(control, JSON.stringify({ publishFile: join(fixture, 'body.md'), publicationResult: result,
        publicationThreadId: 'fixture-thread' }))
      child = spawn(process.execPath, [resolve(import.meta.dirname, '../fixtures/input-performance-acp-runtime.mjs'), '--fixture-control', control],
        { env: { ...process.env, ROVAI_AGENT_CLI: cli, ROVAI_INPUT_FIXTURE_THREAD: scenario === 'wrong-scope' ? 'another-thread' : 'fixture-thread',
          ROVAI_INPUT_FIXTURE_SENT: sent, ROVAI_INPUT_FIXTURE_ACK: scenario === 'uncertain-ack' ? 'unexpected' : 'public_only' },
        stdio: ['pipe', 'pipe', 'pipe'] })
      exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
      child.stdout.resume(); child.stderr.resume()
      for (const message of [{ id: 1, method: 'initialize' }, { id: 2, method: 'session/new', params: { cwd: fixture } },
        { id: 3, method: 'session/prompt' }]) child.stdin.write(JSON.stringify(message) + '\n')
      let value
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        try { value = JSON.parse(await readFile(result, 'utf8')); break } catch {}
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.ok(value, 'fixture must settle publication')
      assert.equal(value.code, scenario === 'matching-scope' ? 0 : 1)
      if (scenario === 'matching-scope') {
        assert.equal(value.threadId, 'fixture-thread')
        assert.equal(value.ack.messageId, 'fixture-message')
      }
      if (scenario === 'wrong-scope') {
        assert.equal(value.stage, 'scope')
        assert.equal(await readFile(sent).then(() => true, () => false), false, 'scope mismatch must not publish')
      } else {
        await new Promise(resolve => setTimeout(resolve, 120))
        assert.equal(await readFile(sent, 'utf8'), 'sent\n', 'a nonce must never be retried after a send')
        if (scenario === 'uncertain-ack') assert.equal(value.uncertain, true)
      }
      child.stdin.end(); await exited; child = null
    } finally {
      if (child) { child.kill('SIGTERM'); await exited.catch(() => {}) }
      await rm(fixture, { recursive: true, force: true })
    }
  })
}
