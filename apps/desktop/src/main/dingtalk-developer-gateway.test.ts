import { nativeImage, type NativeImage } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DingTalkDeveloperApiError, DingTalkDeveloperGateway, dingTalkApplicationPresentation,
  type DingTalkDeveloperOperation, type DingTalkDeveloperRequest } from './dingtalk-developer-gateway'
import { DingTalkConsoleError, type DingTalkWebSession } from './dingtalk-web-session'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(), session: { fromPartition: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() }
}))

beforeEach(() => { vi.mocked(nativeImage.createFromBuffer).mockReset() })

const owner = { corpId: 'corp-fixture', userId: 'staff-fixture' }

describe('DingTalk Web Session developer gateway', () => {
  it('creates one ordinary internal app through the console, with a frozen Owner identity', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'u-app' })
    expect(await f.gateway.execute({ operation: 'app.create', expectedIdentity: owner,
      values: { appName: '测试队员', description: '测试用应用说明' } })).toEqual({ unifiedAppId: 'u-app' })
    expect(f.session.withConsoleSession).toHaveBeenCalledWith(owner, undefined, expect.any(Function))
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.request).toHaveBeenCalledWith('/openapp/unifiedapp/create', {
      signal: undefined, timeoutMs: undefined, method: 'POST',
      body: { appType: 2, appName: '测试队员', appDesc: '测试用应用说明' }
    })
  })

  it('requires read-back identity to match the frozen app', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'another-app' })
    await expect(f.gateway.execute({ operation: 'app.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } })).rejects.toThrow('dingtalk_app_identity_mismatch')
  })

  it('reads the enabled secret from the exact unified app credential endpoint', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app())
      .mockResolvedValueOnce(credentials())
    expect(await f.gateway.execute({ operation: 'app.credentials.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } })).toEqual({ appKey: 'ding-key', appSecret: 'private-secret' })
    expect(f.request.mock.calls[1]).toEqual(['/openapp/unifiedapp/u-app/getClientCredentials', {
      signal: undefined, timeoutMs: undefined
    }])
  })

  it.each([
    { clientId: 'another-app-key' },
    { currentSecrets: { clientSecret: 'private-secret', secretStatus: 'DISABLED' } },
    { currentSecrets: { clientSecret: 'partially***masked', secretStatus: 'ENABLED' } },
    { currentSecrets: [] }, { currentSecrets: null }
  ])('rejects untrusted or masked credentials without reading legacy secrets: %j', async (change) => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce({ ...credentials(), ...change })
    await expect(f.gateway.execute({ operation: 'app.credentials.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } })).rejects.toThrow('dingtalk_app_credentials_invalid')
    expect(f.request.mock.calls.map(([path]) => path)).not.toContain('/innerApp/getAppAccount')
  })

  it('normalizes names/descriptions before the single create, including Rovai middle dots and Chinese semicolons', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'u-app' })
    await f.gateway.execute({ operation: 'app.create', expectedIdentity: owner,
      values: { appName: '芝士 🧀', description: 'Rovai AI Teammate · 鉴定士；开发测试。' } })
    expect(f.request.mock.calls[0]![1]?.body).toEqual({
      appType: 2, appName: '芝士', appDesc: 'Rovai AI Teammate 鉴定士 开发测试。'
    })
    expect(dingTalkApplicationPresentation('惠', 'x')).toEqual({ name: '惠Bot', description: 'Rovai AI Member' })
    expect(dingTalkApplicationPresentation('a'.repeat(25), 'b'.repeat(205)))
      .toEqual({ name: 'a'.repeat(20), description: 'b'.repeat(200) })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('does not turn an unidentifiable create success into permission to recreate', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: '../other' })
    const error = await f.gateway.execute({ operation: 'app.create', expectedIdentity: owner,
      values: { appName: '芝士', description: '测试说明' } }).catch(error => error)
    expect(error).toMatchObject({ message: 'dingtalk_app_create_response_invalid', definitelyRejected: false })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('resizes the 192px member PNG before upload and updates the same frozen app', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce({ logoImg: 'new-media', logoImgUrl: iconUrl })
    const image = png()
    const original = image.slice()
    const uploadImage = png(240)
    const resize = vi.fn(() => ({
      isEmpty: () => false, getSize: () => ({ width: 240, height: 240 }),
      toPNG: () => Buffer.from(uploadImage)
    }))
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue({
      isEmpty: () => false, getSize: () => ({ width: 192, height: 192 }), resize
    } as unknown as NativeImage)
    expect(await run(f, 'app.avatar.upload', {}, image)).toEqual({ iconMediaId: 'new-media', iconUrl })
    expect(f.request.mock.calls[1]).toEqual(['/microapp/uploadPic/logo.json', {
      method: 'POST', signal: undefined, timeoutMs: undefined, image: uploadImage
    }])
    expect(resize).toHaveBeenCalledExactlyOnceWith({ width: 240, height: 240, quality: 'best' })
    expect(image).toEqual(original)
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(app({ appIcon: 'new-media', iconUrl }))
    await run(f, 'app.update', { iconMediaId: 'new-media', iconUrl })
    expect(f.request.mock.calls[3]![1]?.body).toEqual({
      unifiedAppId: 'u-app', appName: '芝士', appDesc: 'Rovai AI 鉴定士', appIcon: 'new-media', iconUrl
    })
    expect(posts(f).map(([path]) => path)).toEqual([
      '/microapp/uploadPic/logo.json', '/openapp/unifiedapp/u-app/update'
    ])
  })

  it('rejects an undecodable avatar locally without uploading or recreating the frozen app', async () => {
    const f = fixture()
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue({
      isEmpty: () => true
    } as unknown as NativeImage)
    await expect(run(f, 'app.avatar.upload', {}, png())).rejects.toMatchObject({
      message: 'dingtalk_member_bot_avatar_unavailable', definitelyRejected: true
    })
    expect(f.request).not.toHaveBeenCalled()
  })

  it('does not accept a silent avatar no-op or a missing readback', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(app()).mockResolvedValueOnce(app())
    await expect(run(f, 'app.update', { iconMediaId: 'new-media', iconUrl }))
      .rejects.toThrow('dingtalk_app_avatar_verification_failed')
  })

  it('enables only the bot capability and verifies it before robot configuration', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce([{ code: 'bot', enabled: false }, { code: 'h5', enabled: false }])
      .mockResolvedValueOnce(true).mockResolvedValueOnce([{ code: 'bot', enabled: true }])
    await run(f, 'app.robot.enable')
    expect(f.request.mock.calls[2]).toEqual(['/openapp/unifiedapp/u-app/ability/enable', {
      method: 'POST', signal: undefined, timeoutMs: undefined,
      body: { unifiedAppId: 'u-app', abilityTypes: ['bot'] }
    }])
  })

  it('does not re-enable an already enabled bot', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce([{ code: 'bot', enabled: true }])
    await run(f, 'app.robot.enable')
    expect(f.request).toHaveBeenCalledTimes(2)
    expect(posts(f)).toEqual([])
  })

  it('creates the robot on the proven legacy provider ID, with numeric Stream mode and member avatar', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(inner({ robotCode: undefined })).mockResolvedValueOnce({})
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(app()).mockResolvedValueOnce(inner()).mockResolvedValueOnce(robot())
    await run(f, 'app.robot.config', { iconMediaId: 'media-1', mode: 'STREAM' })
    expect(posts(f)).toEqual([['/openapp/inner/robot/create', expect.objectContaining({ body: {
      appId: '12345', appKey: 'ding-key', name: '芝士', brief: '芝士', description: 'Rovai AI 鉴定士',
      iconMediaId: 'media-1', previewMediaId: 'media-1', mode: 1, requestType: 'json',
      i18nName: {}, i18nBrief: {}, i18nDescription: {}
    } })]])
    expect(f.request.mock.calls[1]![1]?.query).toEqual({ id: '12345' })
  })

  it('reconciles an existing robot read-only when a previous create response was lost', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(inner()).mockResolvedValueOnce(robot())
    await run(f, 'app.robot.config', { iconMediaId: 'media-1', mode: 'STREAM' })
    expect(posts(f)).toEqual([])
  })

  it('updates the same robot when its saved mode is HTTPS, never creates a replacement', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(inner()).mockResolvedValueOnce(robot({ mode: 0 }))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(app()).mockResolvedValueOnce(inner()).mockResolvedValueOnce(robot())
    await run(f, 'app.robot.config', { iconMediaId: 'media-1', mode: 'STREAM' })
    expect(posts(f).map(([path]) => path)).toEqual(['/openapp/inner/robot/update'])
  })

  it.each([
    { id: 54321 }, { unifiedAppId: 'other' }, { appKey: 'wrong-key' }
  ])('rejects a mismatched inner app before touching robot state: %j', async (change) => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(inner(change))
    await expect(run(f, 'app.robot.config', { iconMediaId: 'media-1', mode: 'STREAM' }))
      .rejects.toThrow('dingtalk_app_identity_mismatch')
    expect(posts(f)).toEqual([])
  })

  it('normalizes numeric robot mode/status at the gateway rather than in the provisioner', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(inner()).mockResolvedValueOnce(robot())
    expect(await run(f, 'app.robot.get')).toEqual({
      robotCode: 'ding-key', name: '芝士', iconMediaId: 'media-1', mode: 'STREAM', status: 'ONLINE'
    })
  })

  it('grants only missing requested scopes using JSON encoded scopeValue, and accepts void success', async () => {
    const f = fixture()
    const required = ['Card.Instance.Write', 'Card.Streaming.Write', 'qyapi_chat_manage', 'qyapi_robot_sendmsg']
    f.request.mockResolvedValueOnce(scopes(required, [required[0]!]))
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(scopes(required, required))
    await run(f, 'app.permission.add', { scopeValues: required })
    expect(posts(f)).toEqual([['/openapp/unifiedapp/u-app/scope/authScope', expect.objectContaining({
      body: { scopeValue: JSON.stringify(required.slice(1)), isIsvScope: false, from: '' }
    })]])
    f.request.mockResolvedValueOnce(scopes(required, required))
    const result = await run(f, 'app.permission.list', { scopeValue: required[0]! })
    expect(result).toMatchObject({ items: [{ scopeValue: required[0], authed: true }] })
  })

  it.each(['missing', 'sensitive', 'locked', 'no_readback'])('fails closed for scope grant %s', async (failure) => {
    const f = fixture()
    const catalog = scopes(['scope.robot'], [], failure === 'sensitive' ? { sensitivityInvolved: 1 }
      : failure === 'locked' ? { canEdit: false } : {})
    f.request.mockResolvedValueOnce(failure === 'missing' ? [] : catalog)
    if (failure === 'no_readback') f.request.mockResolvedValueOnce(undefined).mockResolvedValueOnce(catalog)
    await expect(run(f, 'app.permission.add', { scopeValues: ['scope.robot'] })).rejects.toThrow()
    expect(posts(f)).toHaveLength(failure === 'no_readback' ? 1 : 0)
  })

  it('reserves the existing initial draft without a remote version mutation', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(app()).mockResolvedValueOnce(draft())
    expect(await run(f, 'app.version.create', { versionDescription: '测试说明' })).toEqual({ versionId: 'version-1' })
    expect(posts(f)).toEqual([])
    expect(f.request.mock.calls[1]![1]?.query).toEqual({ unifiedAppId: 'u-app', versionId: 'version-1' })
  })

  it('commits only the frozen version, with an explicit Owner-only visible scope', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(draft()).mockResolvedValueOnce({ requiredApproval: false, approvalMode: 'DING_BPMS' })
      .mockResolvedValueOnce(prepared())
    await run(f, 'app.version.configure', { versionId: 'version-1', versionDescription: 'Rovai AI 鉴定士' })
    expect(posts(f)).toEqual([['/openapp/unifiedapp/u-app/commitVersion', expect.objectContaining({ body: {
      unifiedAppId: 'u-app', versionId: 'version-1', version: '1.0.0', description: 'Rovai AI 鉴定士',
      scopeVO: { deptId: '', uid: '67890', roleId: '', dynamicGroup: '', isHidden: false },
      scopeSelf: true, relatedAbility: {}
    } })]])
  })

  it('does not recommit an already prepared frozen draft after a lost response', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared())
    await run(f, 'app.version.configure', { versionId: 'version-1', versionDescription: 'Rovai AI 鉴定士' })
    expect(posts(f)).toEqual([])
  })

  it.each([
    { scopeSelf: false }, { visibleScopes: [{ deptId: -1 }] },
    { visibleScopes: [{ uid: 67890, staffId: owner.userId }, { uid: 54321, staffId: 'other' }] },
    { version: '2.0.0' }, { description: 'manually changed' }
  ])('does not overwrite a divergent prepared draft: %j', async (change) => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared(change))
    await expect(run(f, 'app.version.configure', { versionId: 'version-1', versionDescription: 'Rovai AI 鉴定士' }))
      .rejects.toThrow()
    expect(posts(f)).toEqual([])
  })

  it('treats DING_BPMS plus requiredApproval=false as no approval, not an invalid mode', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared())
    expect(await run(f, 'app.version.checkApproval', { versionId: 'version-1' })).toEqual({ approvalMode: 'NO_APPROVAL' })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('returns bounded approver choices and validates an explicit selection against current staff IDs', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared({ requiredApproval: true }))
      .mockResolvedValueOnce([{ staffId: 'admin-1', name: '管理员' }])
    expect(await run(f, 'app.version.checkApproval', { versionId: 'version-1' }))
      .toEqual({ approvalMode: 'SELECT_APPROVER', approvalCandidates: [{ userId: 'admin-1', displayName: '管理员' }] })
    f.request.mockResolvedValueOnce(prepared({ requiredApproval: true }))
      .mockResolvedValueOnce([{ staffId: 'admin-1', name: '管理员' }]).mockResolvedValueOnce(undefined)
    await run(f, 'app.version.publish', { versionId: 'version-1', approverUserId: 'admin-1', confirmedSensitive: false })
    expect(posts(f)[0]![1]?.body).toEqual({
      unifiedAppId: 'u-app', versionId: 'version-1', confirmedSensitive: false, approvers: ['admin-1']
    })
  })

  it.each(['unselected', 'not_candidate', 'sensitive', 'unknown_mode'])('never auto-selects or bypasses approval: %s', async (failure) => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared({ requiredApproval: true,
      ...(failure === 'sensitive' ? { sensitiveScopeList: ['sensitive'] } : {}),
      ...(failure === 'unknown_mode' ? { approvalMode: 'UNKNOWN' } : {}) }))
      .mockResolvedValueOnce([{ staffId: 'admin-1', name: '管理员' }])
    await expect(run(f, 'app.version.publish', { versionId: 'version-1', confirmedSensitive: false,
      ...(failure === 'not_candidate' ? { approverUserId: 'not-admin' } : {}) })).rejects.toThrow()
    expect(posts(f)).toEqual([])
  })

  it('publishes with confirmedSensitive=false and accepts success with no data', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(undefined)
    expect(await run(f, 'app.version.publish', { versionId: 'version-1', confirmedSensitive: false }))
      .toEqual({ success: true })
    expect(posts(f)[0]![1]?.body).toEqual({ unifiedAppId: 'u-app', versionId: 'version-1', confirmedSensitive: false })
  })

  it.each(['RELEASE', 'AUDIT'])('never republishes a frozen version in %s', async (status) => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared({ status }))
    expect(await run(f, 'app.version.publish', { versionId: 'version-1', confirmedSensitive: false }))
      .toMatchObject({ versionId: 'version-1', status })
    expect(posts(f)).toEqual([])
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/openapp/unifiedapp/u-app/getVersion'])
  })

  it('reads the supplied frozen version even if the app current draft changed', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared({ status: 'RELEASE' }))
    expect(await run(f, 'app.version.status', { versionId: 'version-1' })).toMatchObject({ status: 'RELEASE' })
    expect(f.request.mock.calls[0]![1]?.query).toEqual({ unifiedAppId: 'u-app', versionId: 'version-1' })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('rejects a version readback for a different app or draft', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce(prepared({ versionId: 'another-version' }))
    await expect(run(f, 'app.version.status', { versionId: 'version-1' })).rejects.toThrow('dingtalk_version_identity_mismatch')
  })

  it('keeps unverified business-event subscriptions closed instead of inventing an API', async () => {
    const f = fixture()
    await expect(run(f, 'app.event.subscribe', { eventCodes: ['unverified.event'] }))
      .rejects.toThrow('dingtalk_console_protocol_unverified')
    expect(f.request).not.toHaveBeenCalled()
  })

  it.each([true, false])('preserves definite-rejection evidence (%s) and never retries app creation', async (definite) => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new DingTalkConsoleError('dingtalk_open_platform_unavailable', definite))
    const error = await f.gateway.execute({ operation: 'app.create', expectedIdentity: owner,
      values: { appName: '队员', description: '测试说明' } }).catch((error) => error)
    expect(error).toBeInstanceOf(DingTalkDeveloperApiError)
    if (!(error instanceof DingTalkDeveloperApiError)) throw error
    expect(error.definitelyRejected).toBe(definite)
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('sanitizes unknown errors that might contain credential-bearing URLs', async () => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new Error('https://open-dev.dingtalk.com/?access_token=secret-fixture'))
    const error = await f.gateway.execute({ operation: 'app.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } }).catch((error) => error)
    if (!(error instanceof DingTalkDeveloperApiError)) throw error
    expect(error.message).toBe('dingtalk_open_platform_unavailable')
    expect(error.definitelyRejected).toBe(false)
  })

  it.each([
    { operation: 'shell.exec', values: {} },
    { operation: 'app.get', values: { unifiedAppId: 'u-app', endpoint: 'https://evil.example' } },
    { operation: 'app.get', values: { unifiedAppId: 'a\0b' } },
    { operation: 'app.get', values: { unifiedAppId: 'u-app', appSecret: 'secret' } },
    { operation: 'app.get', values: { unifiedAppId: '../other' } },
    { operation: 'app.update', values: { unifiedAppId: 'u-app', iconMediaId: 'x', iconUrl: 'https://evil.example/image.png' } },
    { operation: 'app.avatar.upload', values: { unifiedAppId: 'u-app' } },
    { operation: 'app.version.publish', values: { unifiedAppId: 'u-app' } },
    { operation: 'app.get', values: {} }
  ])('rejects unreviewed operations or arguments before accessing credentials: %j', async (request) => {
    const f = fixture()
    await expect(f.gateway.execute({ expectedIdentity: owner, ...request } as DingTalkDeveloperRequest))
      .rejects.toThrow('dingtalk_developer_argument_rejected')
    expect(f.session.withConsoleSession).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })

  it('requires an explicit frozen Owner before any request', async () => {
    const f = fixture()
    await expect(f.gateway.execute({ operation: 'app.get', values: { unifiedAppId: 'u-app' } } as unknown as DingTalkDeveloperRequest))
      .rejects.toThrow('dingtalk_developer_argument_rejected')
    expect(f.request).not.toHaveBeenCalled()
  })
})

const iconUrl = 'https://i01.lw.aliimg.com/media/member.png'
function app(change: Record<string, unknown> = {}) {
  return { unifiedAppId: 'u-app', appType: 2, appName: '芝士', appDesc: 'Rovai AI 鉴定士',
    providerAppId: '12345', clientId: 'ding-key', appIcon: 'media-1', iconUrl, versionId: 'version-1', ...change }
}
function credentials() {
  return { clientId: 'ding-key', currentSecrets: { clientSecret: 'private-secret', secretStatus: 'ENABLED' } }
}
function inner(change: Record<string, unknown> = {}) {
  return { id: 12345, unifiedAppId: 'u-app', appKey: 'ding-key', robotCode: 'ding-key', ...change }
}
function robot(change: Record<string, unknown> = {}) {
  return { appId: 12345, appKey: 'ding-key', robotCode: 'ding-key', mode: 1, status: 2,
    name: '芝士', iconMediaId: 'media-1', ...change }
}
function draft(change: Record<string, unknown> = {}) {
  return { unifiedAppId: 'u-app', versionId: 'version-1', version: '', status: 'INIT',
    scopeSelf: false, visibleScopes: [{ uid: 67890, staffId: owner.userId, name: 'Owner' }, { isHidden: false }],
    approvalMode: 'DING_BPMS', requiredApproval: false, enterpriseSelfBuiltAudit: false, sensitiveScopeList: [], ...change }
}
function prepared(change: Record<string, unknown> = {}) {
  return draft({ version: '1.0.0', description: 'Rovai AI 鉴定士', scopeSelf: true,
    visibleScopes: [{ uid: 67890, staffId: owner.userId, name: 'Owner' }], ...change })
}
function scopes(names: string[], authed: string[], change: Record<string, unknown> = {}) {
  return [{ title: 'Fixture permissions', scopeList: names.map(value => ({
    openApiScopeVO: { value }, authed: authed.includes(value), status: 0,
    requiredApproval: false, sensitivityInvolved: 0, canEdit: true, freeApproval: false, ...change
  })) }]
}
// Structurally valid headers for the stubbed native codec; no real pixel data.
function png(edge = 192) {
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 0, 0, 0, 0, 0,
    8, 6, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0
  ])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, edge)
  view.setUint32(20, edge)
  return bytes
}
function run(f: ReturnType<typeof fixture>, operation: DingTalkDeveloperOperation,
  values: DingTalkDeveloperRequest['values'] = {}, image?: Uint8Array) {
  return f.gateway.execute({ operation, expectedIdentity: owner, values: { unifiedAppId: 'u-app', ...values }, image })
}
function posts(f: ReturnType<typeof fixture>) {
  return f.request.mock.calls.filter(([, options]) => options?.method === 'POST')
}

function fixture() {
  const request = vi.fn<DingTalkWebSession['request']>()
  const session = {
    async withConsoleSession<T>(
      _owner: typeof owner, _signal: AbortSignal | undefined,
      operation: (web: Pick<DingTalkWebSession, 'request'>) => Promise<T>
    ): Promise<T> { return operation({ request }) }
  }
  vi.spyOn(session, 'withConsoleSession')
  return { request, session, gateway: new DingTalkDeveloperGateway({ session }) }
}
