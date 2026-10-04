import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitMemberRuntimeConfiguration } from './member-runtime-commands'

describe('member Runtime save catalog recovery', () => {
  afterEach(() => vi.unstubAllGlobals())
  const command = {
    agentId: 'agent_6', expectedVersion: 25, adapterKind: 'codex-cli' as const,
    model: { mode: 'explicit', modelId: 'gpt-test', options: { reasoning_effort: 'high' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { approval_policy: 'never' } }
  }
  const rejected = { status: 'rejected', code: 'runtime_model_catalog_refresh_required', payload: {} }
  const applied = { status: 'applied', code: 'agent_profile.runtime_configured', payload: { version: 26 } }
  const catalog = { cache: { status: 'fresh' }, refreshStatus: 'completed' }

  it('waits for the shared refresh, then retries the identical draft and version with a new command ID', async () => {
    let complete!: (value: unknown) => void
    const refresh = new Promise(resolve => { complete = resolve })
    const request = vi.fn().mockResolvedValueOnce(rejected).mockReturnValueOnce(refresh).mockResolvedValueOnce(applied)
    vi.stubGlobal('window', { rovai: { request } })
    const saving = submitMemberRuntimeConfiguration(command)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(request.mock.calls[1]).toEqual(['runtime.modelCatalog.open', { runtimeKind: 'codex-cli', waitForRefresh: true }])
    complete(catalog)
    await expect(saving).resolves.toEqual(applied)
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[0][1].command).toEqual(command)
    expect(request.mock.calls[2][1].command).toEqual(command)
    expect(request.mock.calls[2][1].commandId).not.toBe(request.mock.calls[0][1].commandId)
  })

  it.each(['scheduled', 'joined', 'failed', 'deferred'])('does not treat %s as a committed refresh', async (refreshStatus) => {
    const request = vi.fn().mockResolvedValueOnce(rejected).mockResolvedValueOnce({ ...catalog, refreshStatus })
    vi.stubGlobal('window', { rovai: { request } })
    await expect(submitMemberRuntimeConfiguration(command)).rejects.toMatchObject({
      code: rejected.code, message: '暂时无法验证所选模型，本次修改尚未保存，填写内容已保留。'
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['version_conflict', 'runtime_configuration_unavailable', 'runtime_model_option_invalid'])('does not refresh or retry %s', async (code) => {
    const result = { ...rejected, code }
    const request = vi.fn().mockResolvedValue(result)
    vi.stubGlobal('window', { rovai: { request } })
    await expect(submitMemberRuntimeConfiguration(command)).resolves.toEqual(result)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['runtime_model_catalog_refresh_required', 'version_conflict', 'runtime_model_unavailable'])('stops after the second submission returns %s', async (code) => {
    const result = { ...rejected, code }
    const request = vi.fn().mockResolvedValueOnce(rejected).mockResolvedValueOnce(catalog).mockResolvedValueOnce(result)
    vi.stubGlobal('window', { rovai: { request } })
    await expect(submitMemberRuntimeConfiguration(command)).resolves.toEqual(result)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('never resubmits an unknown transport outcome', async () => {
    const request = vi.fn().mockRejectedValue(new Error('transport lost'))
    vi.stubGlobal('window', { rovai: { request } })
    await expect(submitMemberRuntimeConfiguration(command)).rejects.toMatchObject({ code: 'runtime_save_outcome_unknown', message: '暂时无法确认保存结果，请重新载入后核对配置。填写内容已保留。' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
