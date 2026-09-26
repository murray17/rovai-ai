import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { launchHost } from './host-test-client.mjs'

const root = resolve(import.meta.dirname, '../..')
const executable = process.platform === 'win32' ? 'rovai-server.exe' : 'rovai-server'
const binary = process.env.ROVAI_SERVER_BIN ?? join(root, 'target/debug', executable)
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version

test('Server default root is account scoped and independent of working directory', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-paths-')))
  try {
    assert.match(execFileSync(binary, ['--help'], { cwd: fixture, encoding: 'utf8' }), /\[default: 127\.0\.0\.1:8767\]/)
    const paths = JSON.parse(execFileSync(binary, ['paths'], { cwd: fixture, encoding: 'utf8' }))
    assert.equal(paths.dataDir, join(process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME, '.rovai-server'))
    assert.equal(paths.database, join(paths.dataDir, 'rovai.sqlite'))
    assert.ok(paths.runtimeCampFilesRoot.startsWith(join(paths.dataDir, 'instances') + sep))
    assert.deepEqual(await readdir(fixture), [])
    assert.throws(() => execFileSync(binary, ['--data-dir', 'relative', 'paths'], { stdio: 'pipe' }))
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

// Owns the installed-entry -> shared Core -> HTTP -> persistent root seam.
// HOME is overridden only in the isolated child process, never in the test
// runner or user's shell. No Runtime/model is launched.
test('Native Server default and custom roots retain data and token, reject another owner, and never write Desktop resources', {
  timeout: 120_000,
  skip: process.platform === 'win32' ? 'Windows console shutdown requires its native console acceptance; path and installer checks run independently' : false
}, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-entry-')))
  const home = join(fixture, 'account'), install = join(fixture, 'program'), desktop = join(home, '.rovai')
  await mkdir(join(desktop, 'skills'), { recursive: true })
  let installedBinary = join(install, executable)
  if (process.env.ROVAI_SERVER_RELEASE_DIR) {
    const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
    execFileSync('/bin/sh', [join(root, 'scripts/install-server.sh'), '--version', version, '--from-dir', process.env.ROVAI_SERVER_RELEASE_DIR, '--prefix', install, '--bin-dir', join(fixture, 'bin'), '--no-modify-path'], { env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: 'pipe' })
    installedBinary = join(install, 'current', executable)
  } else {
    await mkdir(join(install, 'web-ui'), { recursive: true }); await cp(binary, installedBinary)
    await writeFile(join(install, 'web-ui/index.html'), '<!doctype html><title>Matched package UI</title><h1>Shared Host</h1>')
  }
  const hostBinary = process.env.ROVAI_HOST_BIN ?? join(root, 'target/debug/rovai-host')
  const isolatedEnvironment = { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
  const desktopPaths = JSON.parse(execFileSync(hostBinary, ['prepare', '--data-dir', join(fixture, 'desktop-data')], { env: isolatedEnvironment, encoding: 'utf8' }))
  console.log(JSON.stringify({ channel: 'automatic_acceptance', name: 'parallel-desktop-host', dataDir: desktopPaths.dataDir, skillLibraryRoot: join(desktop, 'skills'), mcpConfigPath: join(desktop, 'mcp.json'), runtime: false }))
  const desktopHost = launchHost(hostBinary, ['--data-dir', desktopPaths.dataDir, '--skill-library-root', join(desktop, 'skills'), '--mcp-config-path', join(desktop, 'mcp.json'), '--runtime-camp-files-root', desktopPaths.runtimeCampFilesRoot], { cwd: fixture, env: isolatedEnvironment })
  const processes = []
  const start = args => {
    const child = spawn(installedBinary, [...args, '--listen', '127.0.0.1:0'], { cwd: fixture, env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let resolveReady, rejectReady
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject }); void ready.catch(() => {})
    const collect = chunk => { output += chunk; if (output.includes('· Ready')) resolveReady() }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { rejectReady(new Error(output)); resolve({ code, signal }) }) })
    const host = { child, ready, closed, output: () => output, origin: () => /Address  (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] }
    processes.push(host); return host
  }
  const wait = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server entry step timed out')), 20000); timer.unref() })])
  const call = async (host, token, operation, params = {}) => {
    const login = await fetch(`${host.origin()}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: token }) })
    assert.equal(login.status, 200)
    const session = await login.json()
    const deadline = Date.now() + 15_000
    for (;;) {
      const response = await fetch(`${host.origin()}/api/v1/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ operation, params }) })
      const result = await response.json(); assert.equal(response.status, 200)
      if (result.error?.code === 'subsystem_unavailable' && result.error?.details?.state === 'initializing' && Date.now() < deadline) { await delay(50); continue }
      assert.equal(result.error, null, JSON.stringify(result.error)); return result.result
    }
  }
  const desktopCall = async (operation, params = {}) => {
    const deadline = Date.now() + 15_000
    for (;;) {
      try { return await desktopHost.request(operation, params) }
      catch (error) {
        if (error?.code !== 'subsystem_unavailable' || error?.details?.state !== 'initializing' || Date.now() >= deadline) throw error
        await delay(50)
      }
    }
  }
  try {
    await wait(desktopHost.ready)
    const desktopConfig = await desktopCall('mcp.config.get')
    assert.equal((await desktopCall('mcp.servers.create', { expectedConfigDigest: desktopConfig.configDigest, definitionJson: JSON.stringify({ mcpServers: { 'desktop-only': { command: 'not-executed-fixture', args: [] } } }) })).status, 'ok')
    const desktopSource = join(fixture, 'desktop-only-skill'); await mkdir(desktopSource)
    await writeFile(join(desktopSource, 'SKILL.md'), '---\nname: desktop-only-skill\ndescription: Parallel Desktop isolation fixture.\n---\nNever executed.\n')
    const desktopImport = await desktopCall('skills.import.inspect', { path: desktopSource })
    assert.equal(desktopImport.candidates.length, 1, JSON.stringify(desktopImport.rejectedCandidates))
    assert.equal((await desktopCall('skills.import.commit', { commandId: randomUUID(), command: { stagingToken: desktopImport.stagingToken, candidateName: desktopImport.candidates[0].name, expectedDigest: desktopImport.candidates[0].contentDigest, expectedSkillVersion: null, confirmUpdate: false } })).status, 'applied')
    const desktopBaseline = { mcp: await readFile(join(desktop, 'mcp.json'), 'utf8'), skills: await desktopCall('skills.list'), instances: await readdir(join(desktop, 'instances')) }
    const desktopWeb = await desktopHost.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(install, process.env.ROVAI_SERVER_RELEASE_DIR ? 'current/web-ui' : 'web-ui') })
    assert.equal((await call({ origin: () => desktopWeb.origin }, desktopWeb.administratorToken, 'mcp.config.get')).configDigest, (await desktopCall('mcp.config.get')).configDigest)
    await assert.rejects(access(join(home, '.rovai-server')), { code: 'ENOENT' })
    for (const [name, args, data] of [['default', [], join(home, '.rovai-server')], ['custom', ['--data-dir', join(fixture, 'custom')], join(fixture, 'custom')]]) {
      console.log(JSON.stringify({ channel: 'automatic_acceptance', name, dataDir: data, skillLibraryRoot: join(data, 'skills'), mcpConfigPath: join(data, 'mcp.json'), runtime: false }))
      const first = start(args); await wait(first.ready)
      assert.ok(first.origin(), first.output())
      const token = await readFile(join(data, 'server-token'), 'utf8')
      assert.equal(first.output().includes(token), false)
      assert.ok(first.output().includes(`Rovai Server ${version} · Ready`))
      assert.match(first.output(), /Foreground/)
      assert.equal(first.output().includes('Host Core is ready'), false)
      assert.equal(first.output().includes('\x1b['), false)
      assert.ok((await fetch(first.origin())).status === 200)
      const config = await call(first, token, 'mcp.config.get')
      assert.equal(config.servers.some(server => server.name === 'desktop-only'), false)
      const created = await call(first, token, 'mcp.servers.create', { expectedConfigDigest: config.configDigest, definitionJson: JSON.stringify({ mcpServers: { 'server-only': { command: 'not-executed-fixture', args: [] } } }) })
      assert.equal(created.status, 'ok')
      const source = join(fixture, `${name}-skill`); await mkdir(source)
      await writeFile(join(source, 'SKILL.md'), `---\nname: ${name}-skill\ndescription: Isolated Server storage acceptance.\n---\nThis skill is stored, never executed.\n`)
      const inspected = await call(first, token, 'skills.import.inspect', { path: source })
      assert.equal(inspected.candidates.length, 1)
      const imported = await call(first, token, 'skills.import.commit', { commandId: randomUUID(), command: { stagingToken: inspected.stagingToken, candidateName: inspected.candidates[0].name, expectedDigest: inspected.candidates[0].contentDigest, expectedSkillVersion: null, confirmUpdate: false } })
      assert.equal(imported.status, 'applied', JSON.stringify(imported))
      const skills = await call(first, token, 'skills.list'); assert.ok(skills.some(skill => skill.name === `${name}-skill`))
      assert.equal(skills.some(skill => skill.name === 'desktop-only-skill'), false)
      assert.equal(desktopHost.child.exitCode, null, 'Desktop Host remains live beside Server')
      assert.equal(await readFile(join(desktop, 'mcp.json'), 'utf8'), desktopBaseline.mcp)
      assert.deepEqual(await desktopCall('skills.list'), desktopBaseline.skills)
      await access(join(data, 'rovai.sqlite')); await access(join(data, 'mcp.json')); await access(join(data, 'skills')); await access(join(data, 'logs/server.log'))
      const instances = await readdir(join(data, 'instances')); assert.equal(instances.length, 1)
      await access(join(data, 'instances', instances[0], 'runtime-files/.runtime-camp-files-root.json'))
      const loginBeforeExit = await fetch(`${first.origin()}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: token }) })
      assert.equal(loginBeforeExit.status, 200)
      const durableSession = await loginBeforeExit.json()
      const before = await call(first, token, 'navigation.snapshot')
      const second = start(args); assert.equal((await wait(second.closed)).code, 1); assert.match(second.output(), /owned_by_active_core/)
      first.child.kill('SIGTERM'); assert.deepEqual(await wait(first.closed), { code: 0, signal: null }, first.output())
      const reopened = start(args); await wait(reopened.ready)
      assert.equal(await readFile(join(data, 'server-token'), 'utf8'), token)
      assert.equal(execFileSync(installedBinary, [...args, 'token'], { env: isolatedEnvironment, encoding: 'utf8' }).trim(), token)
      const restoredSession = await fetch(`${reopened.origin()}/api/v1/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${durableSession.token}` }, body: JSON.stringify({ editor: { clientId: durableSession.clientId, proof: durableSession.editorProof } }) })
      assert.equal(restoredSession.status, 200)
      assert.equal((await restoredSession.json()).expiresAt, durableSession.expiresAt)
      assert.deepEqual(await call(reopened, token, 'navigation.snapshot'), before)
      assert.equal((await call(reopened, token, 'mcp.config.get')).configDigest, created.config.configDigest)
      assert.deepEqual(await call(reopened, token, 'skills.list'), skills)
      reopened.child.kill(name === 'default' ? 'SIGHUP' : 'SIGINT'); assert.deepEqual(await wait(reopened.closed), { code: 0, signal: null }, reopened.output())
      assert.match(await readFile(join(data, 'logs/server.log'), 'utf8'), /Host Core stopped after durable settlement/)
      assert.equal((await readFile(join(data, 'logs/server.log'), 'utf8')).includes(token), false)
      // A previously admitted instance with a lost DB must not become a fresh empty instance.
      await rm(join(data, 'rovai.sqlite'))
      const lostDatabase = start(args); assert.equal((await wait(lostDatabase.closed)).code, 1)
      await assert.rejects(access(join(data, 'rovai.sqlite')), { code: 'ENOENT' })
    }
    assert.equal(await readFile(join(desktop, 'mcp.json'), 'utf8'), desktopBaseline.mcp)
    assert.deepEqual(await desktopCall('skills.list'), desktopBaseline.skills)
    assert.deepEqual(await readdir(join(desktop, 'instances')), desktopBaseline.instances)
    const desktopRoot = start(['--data-dir', desktop]); assert.equal((await wait(desktopRoot.closed)).code, 1); assert.match(desktopRoot.output(), /server_legacy_layout/)
    assert.equal(await readFile(join(desktop, 'mcp.json'), 'utf8'), desktopBaseline.mcp)
    await assert.rejects(access(join(desktop, 'server-layout.json')), { code: 'ENOENT' })
    const legacy = join(fixture, 'legacy'); await mkdir(legacy); await writeFile(join(legacy, 'rovai.sqlite'), 'legacy sentinel')
    const refused = start(['--data-dir', legacy]); assert.equal((await wait(refused.closed)).code, 1); assert.match(refused.output(), /server_legacy_layout/)
    assert.equal(await readFile(join(legacy, 'rovai.sqlite'), 'utf8'), 'legacy sentinel')
    assert.deepEqual(await readdir(legacy), ['rovai.sqlite'])
    const outside = join(fixture, 'outside'); await mkdir(outside)
    const alias = join(fixture, 'alias'); await symlink(outside, alias)
    const throughAlias = start(['--data-dir', join(alias, 'new-root')])
    assert.equal((await wait(throughAlias.closed)).code, 1); assert.match(throughAlias.output(), /symlink component/)
    assert.deepEqual(await readdir(outside), [], 'path checks must precede preparation through a symlink ancestor')
    const oldDefault = join(desktop, 'server'); await mkdir(oldDefault); await writeFile(join(oldDefault, 'rovai.sqlite'), 'old preview')
    const oldDefaultHint = start([]); assert.equal((await wait(oldDefaultHint.closed)).code, 1); assert.match(oldDefaultHint.output(), /previous preview data exists/)
    assert.equal(await readFile(join(oldDefault, 'rovai.sqlite'), 'utf8'), 'old preview')
  } finally {
    await desktopHost.close()
    for (const host of processes) { if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL'); await wait(host.closed).catch(() => {}) }
    await rm(fixture, { recursive: true, force: true })
  }
})

// Uses real POSIX controlling terminals. Never prints the fixture credential,
// including on assertion failure; only boolean observations leave the child.
test('interactive Server shows the retained token outside diagnostics and settles terminal hangup', {
  timeout: 90_000,
  skip: process.platform === 'win32' ? 'POSIX PTY evidence; Windows console closure is qualified separately' : false
}, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-terminal-')))
  const ui = join(fixture, 'web-ui'); await mkdir(ui); await writeFile(join(ui, 'index.html'), '<!doctype html><title>Server terminal fixture</title>')
  try {
    for (const mode of ['quiet-hangup', 'verbose', 'redirected-output']) {
      const data = join(fixture, mode)
      console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir: data, skillLibraryRoot: join(data, 'skills'), mcpConfigPath: join(data, 'mcp.json'), runtime: false, terminal: mode }))
      const result = JSON.parse(execFileSync('python3', ['-c', String.raw`
import os, pty, select, signal, subprocess, sys, time, json
binary, data, ui, mode, version = sys.argv[1:]
args = [binary, '--data-dir', data, '--web-ui', ui, '--listen', '127.0.0.1:0']
if mode == 'verbose': args += ['--verbose']
output = bytearray()
if mode == 'redirected-output':
    master, slave = pty.openpty()
    child = subprocess.Popen(args, stdin=slave, stdout=subprocess.PIPE, stderr=slave)
    pid = child.pid
    stream = child.stdout.fileno()
    os.close(slave)
else:
    pid, master = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.environ.pop('NO_COLOR', None)
        os.execv(binary, args)
    stream = master
try:
    deadline = time.monotonic() + 25
    while b'Foreground' not in output:
        if time.monotonic() > deadline: raise RuntimeError('terminal startup timed out')
        if select.select([stream], [], [], .1)[0]:
            chunk = os.read(stream, 8192)
            if not chunk: raise RuntimeError('terminal closed before ready')
            output.extend(chunk)
    token = open(os.path.join(data, 'server-token'), 'rb').read()
    token_command = subprocess.check_output([binary, '--data-dir', data, 'token']).strip()
    if mode == 'quiet-hangup':
        os.close(master)
        master = None
    else:
        os.kill(pid, signal.SIGINT)
    status = None
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        waited, status = os.waitpid(pid, os.WNOHANG)
        if waited: break
        if master is not None and select.select([stream], [], [], .1)[0]:
            try: output.extend(os.read(stream, 8192))
            except OSError: pass
        time.sleep(.02)
    else: raise RuntimeError('terminal shutdown timed out')
    logs = open(os.path.join(data, 'logs', 'server.log'), 'rb').read()
    print(json.dumps({
        'tokenVisible': token in output,
        'tokenRetained': token == token_command,
        'tokenInLogs': token in logs,
        'color': b'\x1b[' in output,
        'mirrored': b'Host Core is ready' in output,
        'durableStop': b'Host Core stopped after durable settlement' in logs,
        'normalExit': os.waitstatus_to_exitcode(status) == 0,
        'realVersion': ('Rovai Server ' + version).encode() in output,
    }))
finally:
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    if master is not None: os.close(master)
`, binary, data, ui, mode, version], { encoding: 'utf8', timeout: 45_000 }))
      assert.deepEqual(result, {
        tokenVisible: mode !== 'redirected-output', tokenRetained: true, tokenInLogs: false,
        color: mode !== 'redirected-output', mirrored: mode === 'verbose', durableStop: true, normalExit: true, realVersion: true
      }, mode)
    }
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

// A real Windows console window is closed with WM_CLOSE. No JS platform
// override or simulated Ctrl-C is accepted as native console-close evidence.
test('Windows native console close completes the existing durable shutdown', {
  timeout: 90_000, skip: process.platform !== 'win32' ? 'Requires native Windows console' : false
}, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-console-')))
  const data = join(fixture, 'data'), metadata = join(fixture, 'console.json')
  const launch = join(fixture, 'launch.ps1'), close = join(fixture, 'close.ps1'), config = join(fixture, 'launch.json')
  let launcher, serverPid, closed = false
  try {
    await writeFile(config, JSON.stringify({ binary, args: ['--data-dir', data, '--web-ui', process.env.ROVAI_WEB_UI ?? join(root, 'out/web'), '--listen', '127.0.0.1:0'], metadata }))
    await writeFile(launch, String.raw`
param([string]$Config)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TestConsole {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AllocConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
'@
[void][TestConsole]::FreeConsole()
if (-not [TestConsole]::AllocConsole()) { throw 'Cannot allocate isolated console' }
$c = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json
$p = [System.Diagnostics.ProcessStartInfo]::new()
$p.FileName = $c.binary
$p.UseShellExecute = $false
$p.CreateNoWindow = $false
$p.RedirectStandardInput = $true
$p.RedirectStandardOutput = $true
$p.RedirectStandardError = $true
foreach ($argument in $c.args) { $p.ArgumentList.Add($argument) }
$server = [System.Diagnostics.Process]::Start($p)
$stdout = $server.StandardOutput.ReadToEndAsync()
$stderr = $server.StandardError.ReadToEndAsync()
[System.IO.File]::WriteAllText($c.metadata, (@{ serverPid=$server.Id; window=[TestConsole]::GetConsoleWindow().ToInt64() } | ConvertTo-Json -Compress))
$server.WaitForExit()
`)
    await writeFile(close, String.raw`
param([string]$Metadata)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloseTestConsole {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessageW(IntPtr window, uint message, UIntPtr w, IntPtr l);
}
'@
$c = Get-Content -Raw -LiteralPath $Metadata | ConvertFrom-Json
$server = [System.Diagnostics.Process]::GetProcessById($c.serverPid)
$handle = $server.Handle
if ($c.window -eq 0) { throw 'No native console window; cannot qualify console close' }
if (-not [CloseTestConsole]::PostMessageW([IntPtr]$c.window, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE was not delivered' }
if (-not $server.WaitForExit(20000)) { throw 'Server did not exit after native console close' }
@{ exited=$true; code=$server.ExitCode } | ConvertTo-Json -Compress
`)
    console.log(JSON.stringify({ channel: 'automatic_acceptance', nativePlatform: 'win32', dataDir: data, skillLibraryRoot: join(data, 'skills'), mcpConfigPath: join(data, 'mcp.json'), runtime: false, stop: 'native-console-WM_CLOSE' }))
    launcher = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', launch, '-Config', config], { stdio: ['ignore', 'pipe', 'pipe'] })
    let launcherError = ''; launcher.stderr.on('data', chunk => { launcherError += chunk })
    launcher.stdout.resume()
    const deadline = Date.now() + 35_000
    for (;;) {
      try {
        const current = JSON.parse(await readFile(metadata, 'utf8')); serverPid = current.serverPid
        if ((await readFile(join(data, 'logs/server.log'), 'utf8')).includes('Host Core is ready')) break
      } catch { /* Wait only for this fixture's metadata and readiness. */ }
      assert.ok(Date.now() < deadline, `Native console startup timed out: ${launcherError.slice(-1000)}`)
      await delay(100)
    }
    const result = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', close, '-Metadata', metadata], { encoding: 'utf8', timeout: 30_000 }))
    closed = result.exited
    assert.deepEqual(result, { exited: true, code: 0 })
    const log = await readFile(join(data, 'logs/server.log'), 'utf8')
    assert.match(log, /Host Core stopped after durable settlement/)
    assert.equal(log.includes(await readFile(join(data, 'server-token'), 'utf8')), false)
  } finally {
    if (!closed && serverPid) { try { process.kill(serverPid) } catch { /* Already exited. */ } }
    launcher?.kill()
    await rm(fixture, { recursive: true, force: true })
  }
})
