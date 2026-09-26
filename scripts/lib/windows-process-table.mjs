import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const exec = promisify(execFile)

export async function windowsProcessTable() {
  const windowsRoot = process.env.SystemRoot?.trim()
  const executable = windowsRoot
    ? join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const script = [
    "$ProgressPreference = 'SilentlyContinue';",
    'Get-CimInstance Win32_Process',
    '| Where-Object { $_.ProcessId -ne $PID }',
    '| Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath',
    '| ConvertTo-Json -Compress'
  ].join(' ')
  const result = await exec(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
  ], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  const trimmed = result.stdout.replace(/^\uFEFF/u, '').trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => {
    const pid = Number(entry.ProcessId)
    const ppid = Number(entry.ParentProcessId)
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) return []
    return [{
      pid,
      ppid,
      command: typeof entry.CommandLine === 'string'
        ? entry.CommandLine
        : typeof entry.ExecutablePath === 'string' ? entry.ExecutablePath : '',
      executable: typeof entry.ExecutablePath === 'string' ? entry.ExecutablePath : null,
      startedAt: typeof entry.CreationDate === 'string' ? entry.CreationDate : null
    }]
  })
}
