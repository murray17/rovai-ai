import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Process-boundary regression: the shell closes all stdio and exits before its
// descendant. A direct-child unit mock cannot establish process-group ownership.
test('ZCode retains closed-shell groups until descendants exit or Host closes', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-zcode-owner-'))
  const companion = await readFile(new URL('../crates/rovai-core/src/zcode/stdio-owner.cjs', import.meta.url), 'utf8')
  const report = join(root, 'owner-cleanup.json')
  const kernel = join(root, 'kernel.cjs')
  const context = join(root, 'host-context.json')
  const childContext = join(root, 'child-context-path')
  await writeFile(context, JSON.stringify({ lease: { leaseId: 'original-run' } }), { mode: 0o600 })
  await writeFile(kernel, `const {spawn}=require('node:child_process');
    spawn('/bin/sh',['-c','cat "$ROVAI_CLI_CONTEXT" > "$1"','fixture',${JSON.stringify(join(root, 'unscoped-context.json'))}],{stdio:'ignore'});
    process.stdin.once('data',()=>{
    const child=spawn('/bin/sh',['-c','printf %s "$ROVAI_CLI_CONTEXT" > "$2"; sleep 600 >/dev/null 2>&1 & echo $! > "$1"', 'fixture', ${JSON.stringify(join(root, 'descendant'))}, ${JSON.stringify(childContext)}],{detached:true,stdio:'ignore'});
    child.once('close',()=>process.stdout.write('closed\\n'));
    const timer=setInterval(()=>{if(!require('node:fs').existsSync(${JSON.stringify(join(root, 'release-delayed'))}))return;
      clearInterval(timer); const late=spawn('/bin/sh',['-c','cat "$ROVAI_CLI_CONTEXT" > "$1"','fixture',${JSON.stringify(join(root, 'delayed-context.json'))}],{stdio:'ignore'});
      late.once('close',()=>process.stdout.write('delayed\\n'));
    },25);
    });
    process.stdin.resume();`)
  const unrelated = spawn('/bin/sleep', ['600'], { detached: true, stdio: 'ignore' })
  const host = spawn(process.execPath, ['--eval', companion, kernel], { detached: true, env: { ...process.env, ROVAI_ZCODE_OWNER_REPORT: report, ROVAI_CLI_CONTEXT: context, ROVAI_ZCODE_CLI_CONTEXT_DIR: join(root, 'contexts') }, stdio: ['pipe', 'pipe', 'pipe'] })
  const hostClosed = once(host, 'close')
  let descendant
  try {
    let output = ''
    host.stdin.write('original-request\n')
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('shell close timed out')), 5000)
      host.stdout.on('data', (chunk) => { output += chunk; if (output.includes('closed\n')) { clearTimeout(timer); resolve() } })
      host.once('error', reject)
    })
    const frozenContext = await readFile(childContext, 'utf8')
    assert.notEqual(frozenContext, context)
    await writeFile(context, JSON.stringify({ lease: { leaseId: 'successor-run' } }))
    assert.equal(JSON.parse(await readFile(frozenContext, 'utf8')).lease.leaseId, 'original-run')
    assert.equal((await stat(frozenContext)).mode & 0o777, 0o600)
    await writeFile(join(root, 'release-delayed'), '')
    let delayedContext
    for (let i = 0; i < 100; i++) {
      delayedContext = await readFile(join(root, 'delayed-context.json'), 'utf8').then((value) => { try { return JSON.parse(value) } catch { return null } }, () => null)
      if (delayedContext) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(delayedContext?.lease?.leaseId, 'original-run', 'Delayed async children must retain the original request lease')
    assert.equal(JSON.parse(await readFile(join(root, 'unscoped-context.json'), 'utf8')).lease, null, 'Unscoped work must never acquire the current Host lease')
    descendant = Number(await readFile(join(root, 'descendant'), 'utf8'))
    assert(Number.isSafeInteger(descendant) && descendant > 1)
    await new Promise((resolve) => setTimeout(resolve, 250))
    process.kill(descendant, 0)
    host.kill('SIGKILL')
    await hostClosed
    let cleanup
    for (let i = 0; i < 120; i++) {
      cleanup = await readFile(report, 'utf8').then(JSON.parse, () => null)
      if (cleanup) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.deepEqual(cleanup, { confirmed: true, pendingGroups: 0, signalFailed: false })
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' })
    process.kill(unrelated.pid, 0)
  } finally {
    host.kill('SIGKILL')
    unrelated.kill('SIGKILL')
    if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch {} }
    await rm(root, { recursive: true, force: true })
  }
})
