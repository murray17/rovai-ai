import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile, readFile, access, realpath } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { resolve, join, dirname, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'
import { configureProductRuntime } from './configure-product-runtime.mjs'

// Explicit real-Runtime acceptance, never part of unit tests. No daily App data.
const [coreArgument, outputArgument] = process.argv.slice(2)
assert(coreArgument && outputArgument && isAbsolute(coreArgument) && isAbsolute(outputArgument),
  'Usage: node scripts/smoke-mission.mjs <absolute-core> <new-absolute-output-directory>')
const coreExecutable = await realpath(resolve(coreArgument)), requestedOutput = resolve(outputArgument), repository = resolve(import.meta.dirname, '..')
await mkdir(requestedOutput, { recursive: false, mode: 0o700 })
const output = await realpath(requestedOutput)
const dataDirectory = join(output, 'core-data'), skillLibraryRoot = join(output, 'skill-library')
// Login-shell dotfiles on the developer machine can replace Core's candidate CLI PATH.
// Keep the two-product acceptance channel independent of the installed daily CLI.
const shellDirectory = join(output, 'shell')
const source = join(output, 'project'), project = join(source, 'packages/app'), plain = join(output, 'plain')
await Promise.all([mkdir(dataDirectory), mkdir(skillLibraryRoot), mkdir(shellDirectory), mkdir(project, { recursive: true }), mkdir(plain)])
console.log(JSON.stringify({ channel: 'automatic_acceptance', coreExecutable, dataDirectory, skillLibraryRoot, shellDirectory, output }))
const gitExecutable = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim()
const git = (cwd, ...args) => execFileSync(gitExecutable, ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
git(source, 'init', '-b', 'main'); git(source, 'config', 'user.name', 'Mission Fixture'); git(source, 'config', 'user.email', 'fixture@example.invalid')
await writeFile(join(project, 'tracked.txt'), 'base\n'); await writeFile(join(source, '.gitignore'), '*.ignored\n')
git(source, 'add', '.'); git(source, 'commit', '-m', 'fixture base')
const baseSha = git(source, 'rev-parse', 'HEAD')
await writeFile(join(project, 'tracked.txt'), 'source dirty content\n')
await writeFile(join(project, 'private-untracked.txt'), 'must not copy\n')
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), output, baseSha, cases: [], runs: [], status: 'running' }
let client, db
function startCore() {
  const child = spawn(coreExecutable, [...coreDataDirectoryArguments(dataDirectory), '--skill-library-root', skillLibraryRoot,
    '--mcp-config-path', join(dataDirectory, 'mcp.json')], { cwd: repository, env: { ...process.env, ZDOTDIR: shellDirectory }, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map(), errors = []; let id = 0, stopped = false
  child.stderr.on('data', chunk => { errors.push(String(chunk)); void writeFile(join(output, 'core-stderr.log'), errors.join('')) })
  const closed = once(child, 'close')
  child.once('close', (code, signal) => { if (!stopped) for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Core exited ${code}/${signal}: ${errors.slice(-4).join('')}`)) } })
  createInterface({ input: child.stdout }).on('line', line => {
    const value = JSON.parse(line); if (value.kind === 'core_startup') { errors.push(JSON.stringify(value)); void writeFile(join(output, 'startup.log'), errors.join('\n')) }
    if (!value.id) return
    const entry = pending.get(value.id); if (!entry) return
    pending.delete(value.id); clearTimeout(entry.timer)
    value.error ? entry.reject(new Error(`${entry.method}: ${JSON.stringify(value.error)}`)) : entry.resolve(value.result)
  })
  return {
    request: (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`RPC timeout: ${method}`)) }, 180_000)
      pending.set(requestId, { resolve, reject, timer, method }); child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`)
    }),
    stop: async () => {
      if (stopped) return; stopped = true; child.stdin.end()
      await Promise.race([closed, delay(5_000)])
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await Promise.race([closed, delay(5_000)]) }
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    }
  }
}
const command = (method, command) => client.request(method, { commandId: crypto.randomUUID(), command })
const applied = value => { assert.equal(value.status, 'applied', JSON.stringify(value)); return value.payload }
const accepted = value => { assert.equal(value.status, 'accepted', JSON.stringify(value)); return value.payload }
async function createProfile(displayName) {
  const result = await command('members.create', { displayName, teamRole: '使命验收队员', professionalResponsibilities: '执行隔离使命验收步骤并核对真实 Core 结果。',
    personalityTraits: ['严谨'], workingPrinciples: '收到 mission_start 时先用 rovai mission get 读取描述，再执行其中指定的 Node 脚本。其他消息执行其中明确指定的 Node 脚本。不要改写脚本，不要额外创建 Task 或委派；脚本负责发布本次结果。', growthTopic: '' })
  applied(result); return result.resultEntity.entityId
}
async function setRuntime(agentId) {
  const profile = await client.request('members.get', { agentId })
  applied(await command('members.runtime.set', { agentId, expectedVersion: profile.version, adapterKind: 'codex-cli',
    model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } } }))
}
async function createMission(title, description, path, members) {
  const payload = applied(await command('missions.create', { title, description, projectPath: path, projectBindingKind: 'directory',
    memberAgentIds: members, defaultLeadAgentId: members[0], tags: ['验收'] }))
  return { missionId: payload.missionId, threadId: payload.threadId }
}
async function waitForIdle(threadId, minimumRuns) {
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const snapshot = await client.request('camps.snapshot', { threadId })
    const failed = snapshot.agentRuns.find(run => ['failed', 'cancelled'].includes(run.status))
    if (failed) { await writeFile(join(output, 'failed-snapshot.json'), JSON.stringify(snapshot, null, 2)); throw new Error(`Mission Run failed: ${JSON.stringify(failed)}`) }
    if (snapshot.agentRuns.length >= minimumRuns && snapshot.agentRuns.every(run => run.status === 'succeeded')) return snapshot
    await delay(500)
  }
  throw new Error('Mission Run did not settle before 600 seconds')
}
async function sendMessage(threadId, body) {
  const sent = await client.request('camp.messages.send', { commandId: crypto.randomUUID(), threadId,
    content: { version: 2, segments: [{ kind: 'text', text: body }] }, sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: '验证后续普通输入复用使命工作区', completionRole: 'required' } })
  assert.equal((sent.commandResult ?? sent).status, 'accepted', JSON.stringify(sent))
}
async function waitForWorkspaceState(missionId, expected) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT * FROM mission_workspace WHERE mission_id=?').get(missionId)
    if (row?.state === expected) return row
    await delay(100)
  }
  throw new Error(`Mission workspace did not reach ${expected}`)
}
async function waitForWorkspaceDiagnostic(missionId, expected) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT * FROM mission_workspace WHERE mission_id=?').get(missionId)
    if (row?.state === 'ready' && row?.diagnostic === expected) return row
    await delay(100)
  }
  throw new Error(`Mission workspace did not report ${expected}`)
}
async function waitForWorkspaceCleanupFinished(missionId) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT * FROM mission_workspace WHERE mission_id=?').get(missionId)
    if (row?.cleanup_worktree_removed === 1 && row?.cleanup_branch_removed === 1) return row
    await delay(100)
  }
  throw new Error('Mission workspace cleanup did not finish')
}
const generatedPreamble = `import assert from 'node:assert/strict';\nimport {execFileSync} from 'node:child_process';\nimport {readFileSync,writeFileSync,existsSync} from 'node:fs';\nimport {resolve,join} from 'node:path';\nconst cli=(args,input={})=>JSON.parse(execFileSync(process.env.ROVAI_AGENT_CLI,args,{input:JSON.stringify(input),encoding:'utf8'}));\nconst output=${JSON.stringify(output)};\nconst info=cli(['mission','get']);\nassert.deepEqual(Object.keys(info).sort(),['attachments','description','missionId','sourceMessageId','status','title']);\nassert.deepEqual(info.attachments,[]);\n`
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`
try {
  client = startCore(); await client.request('members.list')
  db = new DatabaseSync(join(dataDirectory, 'rovai.sqlite')); db.exec('PRAGMA busy_timeout=5000')
  const members = [await createProfile('Mission Lead'), await createProfile('Mission Reviewer')]
  await configureProductRuntime(client.request, 'codex-cli', members); for (const member of members) await setRuntime(member)
  const follower = join(output, 'follower.mjs'), lead = join(output, 'lead.mjs'), continuation = join(output, 'continuation.mjs'), detached = join(output, 'detached.mjs'), rebuilt = join(output, 'rebuilt.mjs'), nonGit = join(output, 'non-git.mjs')
  await writeFile(follower, generatedPreamble + `assert.equal(info.status,'not_started');\nconst updated=cli(['mission','update'],{description:'已由非队长核对交付与工作区'});assert.equal(updated.changed,true);\nconst status=cli(['mission','status'],{status:'completed'});assert.equal(status.changed,true);\nconst completed=cli(['mission','get']);assert.equal(completed.status,'completed');assert.equal(completed.sourceMessageId,null);\nconst sent=cli(['send'],{publicOnly:true,body:'MISSION_FOLLOWER_OK：共享工作区与无来源状态更新已验证。'});\nwriteFileSync(join(output,'follower-evidence.json'),JSON.stringify({cwd:process.cwd(),info,updated,status,completed,sent}));\n`)
  await writeFile(lead, generatedPreamble + `assert.equal(info.status,'not_started');assert.equal(readFileSync('tracked.txt','utf8'),'base\\n');assert(!existsSync('private-untracked.txt'));\nconst updated=cli(['mission','update'],{title:'已验证持久工作区'});assert.equal(updated.changed,true);\nconst git=(...args)=>execFileSync(${JSON.stringify(gitExecutable)},args,{encoding:'utf8'}).trim();\nwriteFileSync('tracked.txt','committed\\n');git('add','tracked.txt');git('commit','-m','mission fixture committed');\nwriteFileSync('tracked.txt','staged\\n');git('add','tracked.txt');writeFileSync('tracked.txt','current net\\n');\nwriteFileSync('new.txt','new untracked\\n');writeFileSync('secret.ignored','ignored\\n');writeFileSync('delivery.md','# Mission delivery\\n实际 Agent 文件交付。\\n');\nconst sent=cli(['send'],{publicOnly:true,body:'MISSION_LEAD_FILE_OK',files:[resolve('delivery.md')]});\nconst delegated=cli(['send'],{to:[${JSON.stringify(members[1])}],body:${JSON.stringify(`执行本次使命验收：node ${shellQuote(follower)}。脚本完成后结束本轮。`)}});\nwriteFileSync(join(output,'lead-evidence.json'),JSON.stringify({cwd:process.cwd(),info,updated,sent,delegated}));\n`)
  await writeFile(continuation, generatedPreamble + `assert.equal(info.status,'completed');assert.equal(readFileSync('tracked.txt','utf8'),'current net\\n');const branch=execFileSync(${JSON.stringify(gitExecutable)},['symbolic-ref','--short','HEAD'],{encoding:'utf8'}).trim();assert.equal(branch,'external/mission-validation');cli(['send'],{publicOnly:true,body:'MISSION_CONTINUATION_OK'});writeFileSync(join(output,'continuation-evidence.json'),JSON.stringify({cwd:process.cwd(),info,branch}));\n`)
  await writeFile(detached, generatedPreamble + `assert.equal(info.status,'completed');let detached=false;try{execFileSync(${JSON.stringify(gitExecutable)},['symbolic-ref','--quiet','HEAD'],{encoding:'utf8'})}catch{detached=true}assert.equal(detached,true);cli(['send'],{publicOnly:true,body:'MISSION_DETACHED_OK'});writeFileSync(join(output,'detached-evidence.json'),JSON.stringify({cwd:process.cwd(),info,detached}));\n`)
  await writeFile(rebuilt, generatedPreamble + `assert.equal(info.status,'completed');assert.equal(readFileSync('tracked.txt','utf8'),'base\\n');const branch=execFileSync(${JSON.stringify(gitExecutable)},['symbolic-ref','--short','HEAD'],{encoding:'utf8'}).trim();assert.equal(branch,'rovai/mission/001');cli(['send'],{publicOnly:true,body:'MISSION_REBUILT_OK'});writeFileSync(join(output,'rebuilt-evidence.json'),JSON.stringify({cwd:process.cwd(),info,branch}));\n`)
  await writeFile(nonGit, generatedPreamble + `assert.equal(info.status,'not_started');cli(['send'],{publicOnly:true,body:'MISSION_NON_GIT_OK'});writeFileSync(join(output,'non-git-evidence.json'),JSON.stringify({cwd:process.cwd(),info}));\n`)
  const mission = await createMission('持久使命工作区验收', `执行 node ${shellQuote(lead)}。脚本通过 Rovai CLI 验证权限和交付，并将独立检查交给队员。无需修改脚本。`, project, members)
  report.mission = mission
  assert.equal(db.prepare('SELECT count(*) n FROM agent_run r JOIN camp_turn t ON t.id=r.camp_turn_id WHERE t.camp_id=?').get(mission.threadId).n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM mission_workspace').get().n, 0)
  assert.equal((await client.request('missions.delivery', { missionId: mission.missionId })).workspace, null)
  report.cases.push('save creates Mission and main Camp without Run or worktree')
  const startId = crypto.randomUUID(), startParams = { commandId: startId, command: { missionId: mission.missionId } }
  const started = await client.request('missions.start', startParams)
  assert.equal(started.status, 'accepted', JSON.stringify(started))
  assert.deepEqual(await client.request('missions.start', startParams), started)
  const snapshot = await waitForIdle(mission.threadId, 2)
  await writeFile(join(output, 'first-snapshot.json'), JSON.stringify(snapshot, null, 2))
  const workspace = db.prepare('SELECT * FROM mission_workspace WHERE mission_id=?').get(mission.missionId)
  assert.equal(workspace.base_sha, baseSha); assert.equal(workspace.branch, 'rovai/mission/001')
  assert.equal(workspace.worktree_path, `${source}-mission-001`)
  assert.equal(workspace.working_directory, join(workspace.worktree_path, 'packages/app'))
  assert(snapshot.agentRuns.every(run => run.workspace.path === workspace.working_directory))
  assert.equal(await readFile(join(project, 'tracked.txt'), 'utf8'), 'source dirty content\n')
  for (const file of ['lead-evidence.json', 'follower-evidence.json']) assert.equal(JSON.parse(await readFile(join(output, file))).cwd, workspace.working_directory)
  const manifests = snapshot.contextManifests
  assert.equal(manifests.length, 2); assert(manifests.every(m => m.workspaceFactIncluded && m.workspaceFact.workingDirectory === workspace.working_directory))
  assert(manifests.every(m => Object.keys(m.runFactPayload.mission).sort().join() === 'missionId,status,title'))
  assert(manifests.every(m => m.runFactRefs.some(ref => ref.missionId === mission.missionId)))
  assert.equal(db.prepare('SELECT count(*) n FROM mission_start').get().n, 1)
  report.cases.push('Start is status-independent and idempotent; preparing creates clean fixed-base worktree; A2A and non-lead editing use the same cwd; Agent CLI completes a Mission without a source message')
  const indexBefore = git(workspace.worktree_path, 'ls-files', '--stage', '-z')
  const changes = await client.request('missions.changes', { missionId: mission.missionId })
  assert.deepEqual(changes.checkoutState, { kind: 'branch', branch: workspace.branch, head: git(workspace.worktree_path, 'rev-parse', 'HEAD') })
  assert.equal(typeof changes.viewId, 'string'); assert.equal(changes.diffError, null)
  assert.deepEqual(changes.files.map(file => file.path).sort(), ['packages/app/delivery.md', 'packages/app/new.txt', 'packages/app/tracked.txt'])
  const tracked = changes.files.find(file => file.path.endsWith('tracked.txt'))
  const patch = await client.request('missions.fileDiff', { missionId: mission.missionId, fileId: tracked.id, viewId: changes.viewId })
  assert(patch.patch.includes('-base') && patch.patch.includes('+current net')); assert(!patch.patch.includes('staged'))
  assert.equal(git(workspace.worktree_path, 'ls-files', '--stage', '-z'), indexBefore)
  const delivery = await client.request('missions.delivery', { missionId: mission.missionId })
  assert.equal(delivery.workspace.managedBranch, workspace.branch)
  const deliveryMessage = snapshot.messages.find(message => message.body === 'MISSION_LEAD_FILE_OK')
  assert(deliveryMessage?.attachments.some(attachment => attachment.displayName === 'delivery.md'))
  await writeFile(join(output, 'delivery.json'), JSON.stringify({ delivery, changes, patch }, null, 2))
  report.cases.push('fixed-base net diff includes commits, index, working tree and untracked files; the published Agent message retains its source attachment')
  git(workspace.worktree_path, 'switch', '-c', 'external/mission-validation')
  git(source, 'branch', '-D', workspace.branch)
  assert.throws(() => git(source, 'rev-parse', '--verify', `refs/heads/${workspace.branch}`))
  const switched = await client.request('missions.changes', { missionId: mission.missionId })
  assert.deepEqual(switched.checkoutState, { kind: 'branch', branch: 'external/mission-validation', head: git(workspace.worktree_path, 'rev-parse', 'HEAD') })
  assert.equal(typeof switched.viewId, 'string'); assert.deepEqual(switched.files.map(file => file.path), changes.files.map(file => file.path))
  await assert.rejects(client.request('missions.fileDiff', { missionId: mission.missionId, fileId: tracked.id, viewId: changes.viewId }), /mission.changes_refresh_required/)
  await client.request('missions.fileDiff', { missionId: mission.missionId, fileId: tracked.id, viewId: switched.viewId })
  report.cases.push('activity view follows the actual checkout while managed branch identity stays unchanged; old file views are rejected without reusing their temporary index')
  db.close(); db = null; await client.stop(); client = startCore(); await client.request('members.list')
  db = new DatabaseSync(join(dataDirectory, 'rovai.sqlite')); db.exec('PRAGMA busy_timeout=5000')
  await sendMessage(mission.threadId, `只验证原使命目录和当前状态：node ${shellQuote(continuation)}。不要推进或重开使命。`)
  const resumed = await waitForIdle(mission.threadId, 3)
  const newManifest = resumed.contextManifests.find(m => !manifests.some(old => old.id === m.id))
  assert(newManifest); assert.equal(newManifest.workspaceFactIncluded, true)
  assert.equal(newManifest.workspaceFact.workingDirectory, workspace.working_directory)
  assert.equal(newManifest.workspaceFact.branch, 'external/mission-validation')
  assert.equal((await client.request('missions.get', { missionId: mission.missionId })).status, 'completed')
  assert.equal(db.prepare('SELECT base_sha FROM mission_workspace WHERE mission_id=?').get(mission.missionId).base_sha, baseSha)
  assert.equal(JSON.parse(await readFile(join(output, 'continuation-evidence.json'))).cwd, workspace.working_directory)
  assert.equal(JSON.parse(await readFile(join(output, 'continuation-evidence.json'))).branch, 'external/mission-validation')
  report.cases.push('Core restart and ordinary input reuse the same Worktree after checkout change and managed-branch deletion, with the changed checkout fact reflected in Runtime context')
  git(workspace.worktree_path, 'checkout', '--detach')
  const detachedHead = git(workspace.worktree_path, 'rev-parse', 'HEAD')
  db.prepare('UPDATE mission_workspace SET base_sha=? WHERE mission_id=?').run('f'.repeat(40), mission.missionId)
  const unavailableDiff = await client.request('missions.changes', { missionId: mission.missionId })
  assert.deepEqual(unavailableDiff.checkoutState, { kind: 'detached', head: detachedHead })
  assert.equal(unavailableDiff.viewId, null); assert.equal(unavailableDiff.files, null); assert.match(unavailableDiff.diffError, /mission.base_unavailable/)
  await sendMessage(mission.threadId, `在 detached HEAD 且比较基准不可用时继续执行：node ${shellQuote(detached)}。不要修改使命状态。`)
  const detachedResumed = await waitForIdle(mission.threadId, 4)
  assert.equal(JSON.parse(await readFile(join(output, 'detached-evidence.json'))).cwd, workspace.working_directory)
  db.prepare('UPDATE mission_workspace SET base_sha=? WHERE mission_id=?').run(baseSha, mission.missionId)
  report.cases.push('detached HEAD and an unavailable fixed diff base degrade activity data but do not block the real Runtime dispatch path')
  const simple = await createMission('非 Git 使命', '', plain, members)
  await sendMessage(simple.threadId, `执行 node ${shellQuote(nonGit)}，只核对环境，不修改使命状态。`)
  const plainSnapshot = await waitForIdle(simple.threadId, 1)
  const plainDelivery = await client.request('missions.delivery', { missionId: simple.missionId })
  assert.equal(plainDelivery.git, false); assert.equal(plainDelivery.workspace, null)
  assert.deepEqual(plainSnapshot.contextManifests[0].workspaceFact, { workingDirectory: plain })
  assert.equal(plainSnapshot.contextManifests[0].workspaceFactIncluded, true)
  await assert.rejects(client.request('missions.changes', { missionId: simple.missionId }), /mission.git_not_applicable/)
  report.cases.push('non-Git ordinary-message first Run keeps original directory, not_started status and no branch/Diff')
  git(workspace.worktree_path, 'switch', 'external/mission-validation')
  applied(await command('missions.workspace.cleanup', { missionId: mission.missionId }))
  const dirtyRefusal = await waitForWorkspaceDiagnostic(mission.missionId, 'mission.workspace_dirty')
  assert.equal(dirtyRefusal.cleanup_expected_branch_oid, null)
  assert.equal(dirtyRefusal.cleanup_worktree_removed, 0); assert.equal(dirtyRefusal.cleanup_branch_removed, 0)
  assert.equal(await readFile(join(workspace.working_directory, 'tracked.txt'), 'utf8'), 'current net\n')
  const dirtyChanges = await client.request('missions.changes', { missionId: mission.missionId })
  assert(dirtyChanges.files.some(file => file.path.endsWith('tracked.txt')))
  db.prepare("UPDATE mission_workspace SET state='cleanup_failed',cleanup_worktree_removed=0,cleanup_branch_removed=0,diagnostic='mission.workspace_branch_mismatch' WHERE mission_id=?").run(mission.missionId)
  applied(await command('missions.workspace.cleanup', { missionId: mission.missionId }))
  await waitForWorkspaceDiagnostic(mission.missionId, 'mission.workspace_dirty')
  git(workspace.worktree_path, 'add', '-A'); git(workspace.worktree_path, 'commit', '-m', 'preserve external mission result')
  const managedCommit = git(workspace.worktree_path, 'rev-parse', 'HEAD')
  applied(await command('missions.workspace.cleanup', { missionId: mission.missionId }))
  await waitForWorkspaceCleanupFinished(mission.missionId)
  await assert.rejects(access(workspace.worktree_path))
  assert.throws(() => git(source, 'rev-parse', '--verify', `refs/heads/${workspace.branch}`))
  assert.equal(git(source, 'rev-parse', '--verify', 'refs/heads/external/mission-validation'), managedCommit)
  await sendMessage(mission.threadId, `验证清理后的使命工作区重建：node ${shellQuote(rebuilt)}。不要修改使命状态。`)
  const rebuiltSnapshot = await waitForIdle(mission.threadId, 5)
  const rebuiltWorkspace = await waitForWorkspaceState(mission.missionId, 'ready')
  assert.equal(rebuiltWorkspace.worktree_path, workspace.worktree_path)
  assert.equal(JSON.parse(await readFile(join(output, 'rebuilt-evidence.json'))).cwd, workspace.working_directory)
  assert.equal(git(source, 'rev-parse', '--verify', 'refs/heads/external/mission-validation'), managedCommit)
  applied(await command('missions.workspace.cleanup', { missionId: mission.missionId }))
  await waitForWorkspaceCleanupFinished(mission.missionId)
  const currentMission = await client.request('camps.snapshot', { threadId: mission.threadId })
  accepted(await command('camps.delete', { threadId: mission.threadId, expectedVersion: currentMission.thread.version, force: false, workspaceDisposition: 'retain' }))
  assert.equal(db.prepare('SELECT count(*) n FROM mission_workspace WHERE mission_id=?').get(mission.missionId).n, 0)
  report.cases.push('dirty cleanup is refused asynchronously without leaving cleanup_failed; a legacy untouched failure recovers on retry; clean non-managed checkout cleanup preserves its branch and the next Run rebuilds through the preparation path')
  report.runs = [...rebuiltSnapshot.agentRuns, ...plainSnapshot.agentRuns].map(({ id, status, workspace }) => ({ id, status, workspace }))
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1
} finally {
  db?.close(); await client?.stop(); report.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
}
