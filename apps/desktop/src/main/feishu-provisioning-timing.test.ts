import { describe, expect, it } from 'vitest'
import { ProvisioningTimingRecorder } from './feishu-provisioning-timing'

describe('ProvisioningTimingRecorder', () => {
  it('records successful and failed monotonic phases without exposing App or secret values', async () => {
    let monotonicMs = 10
    const lines: string[] = []
    const recorder = new ProvisioningTimingRecorder({
      publicationIntentId: 'rvfpi_timing',
      agentId: 'agent-a',
      appId: 'cli_sensitive_app',
      creationMode: 'template',
      recovering: false
    }, {
      now: () => monotonicMs,
      write: (line) => lines.push(line)
    })
    recorder.setMutations({
      scopesChanged: true,
      eventsChanged: false,
      callbacksChanged: true,
      manifestChanged: true
    })

    await recorder.measure('session_open_ms', async () => { monotonicMs += 12 })
    await expect(recorder.measure('owner_identity_ms', async () => {
      monotonicMs += 7
      throw new Error('app-secret-should-never-appear')
    })).rejects.toThrow('app-secret-should-never-appear')
    monotonicMs += 3
    recorder.recordTotal('failed', new Error('app-secret-should-never-appear'))
    recorder.recordTotal('ok')

    const samples = lines.map(parseTimingLine)
    expect(samples.map((sample) => sample.phase)).toEqual([
      'session_open_ms',
      'owner_identity_ms',
      'total_ms'
    ])
    expect(samples[0]).toMatchObject({
      event: 'feishu.provision.timing',
      durationMs: 12,
      outcome: 'ok',
      creationMode: 'template',
      scopesChanged: true,
      callbacksChanged: true,
      manifestChanged: true
    })
    expect(samples[1]).toMatchObject({ outcome: 'failed', failureCode: 'unknown' })
    expect(samples[2]).toMatchObject({ durationMs: 22, outcome: 'failed' })
    expect(samples[0].appIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(lines.join('\n')).not.toMatch(/cli_sensitive_app|app-secret-should-never-appear/)
  })
})

function parseTimingLine(line: string): Record<string, unknown> {
  const prefix = '[feishu.provision.timing] '
  expect(line.startsWith(prefix)).toBe(true)
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>
}
