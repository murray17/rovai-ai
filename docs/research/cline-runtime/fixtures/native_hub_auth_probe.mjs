// macOS research probe: caller must first establish the daemon path from the
// same installation selected by Rovai. No runtime or model code is imported.
import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'
import { NativeHubClient, openHubSocket, readOwnedDiscovery } from './native_hub_client.mjs'

if (process.argv.length !== 4) throw new Error('Usage: node native_hub_auth_probe.mjs <owned-root> <verified-daemon-path>')
const root = realpathSync(resolve(process.argv[2]))
const expected = realpathSync(process.argv[3])
const record = await readOwnedDiscovery(join(root, 'host-temp/hub-owner.json'), root)
const executable = execFileSync('/bin/ps', ['-p', String(record.pid), '-o', 'comm='], { encoding: 'utf8' }).trim()
if (executable !== expected) throw new Error('Daemon does not match the selected installation')
for (const item of ['native-home', 'persistent/config', 'persistent/data', 'host-temp', 'workspace']) {
  const path = relative(root, realpathSync(join(root, item)))
  if (path === '..' || path.startsWith(`..${sep}`)) throw new Error('Private path escapes owned root')
}
const listener = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(record.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' })
const addresses = listener.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1))
if (addresses.length !== 1 || addresses[0] !== `127.0.0.1:${record.port}`) throw new Error('Unexpected Hub listener')
const endpoint = new URL(record.url)
endpoint.protocol = 'http:'
endpoint.pathname = '/health'
const health = await (await fetch(endpoint, { redirect: 'error' })).json()
if (health.pid !== record.pid || health.hubId !== record.hubId) throw new Error('Discovery and health disagree')
const report = {
  observedAt: new Date().toISOString(), daemonPid: record.pid, daemonExecutable: executable,
  executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
  hubId: record.hubId, protocolVersion: record.protocolVersion, buildId: record.buildId,
  discoveryMode: (statSync(join(root, 'host-temp/hub-owner.json')).mode & 0o777).toString(8),
  addresses, auth: [], unauthorizedShutdownStatuses: [], privateRootSymlinkEscape: false
}
for (const [label, token] of [['missing', undefined], ['wrong', randomBytes(32).toString('hex')], ['correct', record.authToken]]) {
  try {
    const socket = await openHubSocket(record.url, token)
    report.auth.push({ label, connected: true })
    socket.close()
  } catch { report.auth.push({ label, connected: false }) }
}
if (report.auth.some(item => item.connected !== (item.label === 'correct'))) throw new Error('Authentication boundary failed')
endpoint.pathname = '/shutdown'
for (const headers of [{}, { Authorization: 'Bearer wrong-probe-token' }]) {
  const result = await fetch(endpoint, { method: 'POST', headers, redirect: 'error' })
  report.unauthorizedShutdownStatuses.push(result.status)
  if (result.status !== 401) throw new Error('Unauthenticated shutdown was accepted')
}
const client = await NativeHubClient.connect(record)
try {
  report.registration = await client.register()
  report.settingsRead = await client.command('settings.get')
  if (!report.registration.ok) throw new Error('Native client registration failed')
} finally { await client.close() }
writeFileSync(join(root, 'auth-recheck.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
