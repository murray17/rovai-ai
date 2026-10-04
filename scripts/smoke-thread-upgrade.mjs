import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { startQualificationCore } from './lib/qualification-core.mjs'

// Real old/new Core processes, one isolated store; no App or Runtime is started.
const args = process.argv.slice(2), options = {}
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--baseline', '--candidate', '--output'].includes(args[i]) && args[i + 1])
  assert.equal(options[args[i]], undefined)
  options[args[i]] = resolve(args[i + 1])
}
for (const key of ['--baseline', '--candidate', '--output']) assert.ok(options[key], `Missing ${key}`)
await mkdir(options['--output'], { mode: 0o700 })
const root = await realpath(options['--output']), data = join(root, 'data'), mcp = join(root, 'mcp.json')
await mkdir(data, { mode: 0o700 })
await writeFile(mcp, JSON.stringify({ mcpServers: {} }), { mode: 0o600 })
const run = promisify(execFile)
const snapshotStore = async () => JSON.parse((await run('python3', ['-c', `
import hashlib,json,sqlite3,sys,pathlib
p=pathlib.Path(sys.argv[1])
wal=pathlib.Path(str(p)+'-wal')
assert not wal.exists() or wal.stat().st_size == 0, 'Stopped Core must checkpoint before immutable verification'
c=sqlite3.connect(p.as_uri()+'?mode=ro&immutable=1',uri=True)
tables=['camp','conversation','event_log','context_manifest','agent_run_input','native_session_bootstrap_evidence','native_session_platform_skills_evidence']
existing={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
rows={t:c.execute('SELECT * FROM '+t+' ORDER BY rowid').fetchall() for t in tables if t in existing}
print(json.dumps({'schema':c.execute('SELECT projection_schema_version FROM rovai_data_contract').fetchone()[0], 'digest':hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':'),default=str).encode()).hexdigest(),'counts':{t:len(v) for t,v in rows.items()}}))
`, join(data, 'rovai.sqlite')])).stdout)
let core
const start = executable => startQualificationCore({ coreExecutable: executable, dataDirectory: data, workingDirectory: root, runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: mcp })
const skill = join(data, 'skills', 'cli-operations', 'SKILL.md')
async function waitForSkill(word) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await readFile(skill, 'utf8').catch(() => '')).includes(word)) return
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Bundled Skill did not synchronize at its original path: ${word}`)
}
try {
  delete process.env.ROVAI_BUNDLED_SKILLS_ROOT
  core = start(options['--baseline'])
  await core.request('health.check')
  const preflight = await core.request('camps.creationPreflight')
  const create = { commandId: crypto.randomUUID(), name: 'Before upgrade', workspace: null, memberAgentIds: [preflight.initialLeadAgentId], defaultLeadAgentId: preflight.initialLeadAgentId, collaborationMode: 'peer' }
  const created = await core.request('camps.create', create)
  const id = created.payload.campId
  assert.match(id, /^rvcamp_/)
  const old = await core.request('camps.snapshot', { campId: id })
  const rename = { commandId: crypto.randomUUID(), command: { campId: id, title: 'Frozen old command result', expectedVersion: old.camp.version } }
  const renamed = await core.request('camps.rename', rename)
  assert.equal(renamed.status, 'applied')
  await waitForSkill('CampMessage')
  await writeFile(join(data, 'skills', 'cli-operations', 'local-note.txt'), 'keep user file')
  await core.stop(); core = null
  const before = await snapshotStore()
  assert.equal(before.schema, 127)
  core = start(options['--candidate'])
  await core.request('health.check')
  const current = await core.request('threads.snapshot', { threadId: id })
  assert.equal(current.thread.id, id)
  assert.equal(current.thread.title, 'Frozen old command result')
  assert.equal(current.camp, undefined)
  assert.deepEqual(await core.request('camps.snapshot', { campId: id }), current)
  const createdReplay = await core.request('threads.create', create)
  assert.equal(createdReplay.payload.threadId, id)
  assert.equal(createdReplay.payload.campId, undefined)
  assert.equal(createdReplay.recordedAt, created.recordedAt)
  const { campId, ...command } = rename.command
  const replay = await core.request('threads.rename', { ...rename, command: { ...command, threadId: campId } })
  assert.equal(replay.recordedAt, renamed.recordedAt)
  assert.equal(replay.status, 'applied')
  await assert.rejects(core.request('threads.snapshot', { threadId: id, campId: id }))
  await waitForSkill('ThreadMessage')
  assert.equal(await readFile(join(data, 'skills', 'cli-operations', 'local-note.txt'), 'utf8'), 'keep user file')
  await core.stop(); core = null
  const after = await snapshotStore()
  assert.equal(after.schema, 128)
  assert.deepEqual(after.counts, before.counts)
  assert.equal(after.digest, before.digest, 'Upgrade or replay changed existing business/evidence rows')
  const report = { passed: true, before, after, threadId: id, preservedCommandReplay: true, legacyInputsAccepted: true, duplicateAliasesRejected: true, skillUpdatedAtOriginalPath: skill, nativeRuntimeStarted: false }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
} finally { await core?.stop() }
