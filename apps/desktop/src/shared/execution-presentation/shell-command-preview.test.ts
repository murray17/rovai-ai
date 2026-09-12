import { describe, expect, it } from 'vitest'
import type { CanonicalRuntimeActivityView } from '@contracts'
import { executionActivityTitle, executionEvidenceResultText } from './index'

const shell: CanonicalRuntimeActivityView = {
  operationId: 'powershell-command', classifierVersion: 'test', activityDomain: 'shell',
  semanticKind: 'shell.execute', toolName: 'exec_command', presentationHint: '执行 Shell 命令',
  phase: 'terminal', outcome: 'succeeded', credibility: 'provider_reported',
  coverageLevel: 'fine_grained', sourceAuthority: 'runtime', sourceEvidenceIds: [],
  firstEvidenceSequence: 1, lastEvidenceSequence: 2, revision: 1
}

const command = 'cargo fmt --all -- --check; cargo check -p rovai-core'
const displayed = 'cargo fmt --all -- --check ; cargo check -p rovai-core'
const runtimePath = String.raw`C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`

describe('PowerShell command presentation', () => {
  it.each([
    `"${runtimePath}" -Command '${command}'`,
    `"${runtimePath.replaceAll('\\', '\\\\')}" -Command '${command}'`,
    `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command '${command}'`,
    `powershell.exe -COMMAND '${command}'`,
    `powershell -c '${command}'`,
    `pwsh -command '${command}'`,
    `pwsh.exe -C '${command}'`
  ])('shows the command without the PowerShell wrapper: %s', (wrapped) => {
    const payload = { item: {
      type: 'commandExecution', command: wrapped,
      commandActions: [{ type: 'unknown' }], aggregatedOutput: 'checks passed'
    } }
    expect(executionActivityTitle(shell, payload)).toBe(displayed)
    expect(executionEvidenceResultText('activity.completed', payload)).toBe(`$ ${command}\nchecks passed`)
    expect(executionActivityTitle(shell, { input: { command: wrapped } })).toBe(displayed)
  })

  it.each([
    `pwsh -File script.ps1`,
    `pwsh -EncodedCommand Z2l0IHN0YXR1cw==`,
    `custom.exe -Command 'git status'`,
    `pwsh -Command 'git status' && git diff`,
    `pwsh -Command 'git status' extra`
  ])('preserves commands outside the bounded wrapper shape: %s', (wrapped) => {
    expect(executionActivityTitle(shell, { item: { command: wrapped } })).toBe(wrapped)
  })
})
