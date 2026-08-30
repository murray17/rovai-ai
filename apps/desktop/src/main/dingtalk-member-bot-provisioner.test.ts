import { describe, expect, it, vi } from 'vitest'
import {
  DingTalkDeveloperApiError,
  type DingTalkDeveloperBackend,
  type DingTalkDeveloperOperation,
  type DingTalkDeveloperRequest
} from './dingtalk-developer-gateway'
/*
 * Keep these tests on the raw Open Platform response fields. The direct
 * provisioner no longer receives DWS's projected output aliases.
 */
import type { DingTalkDeveloperSessionService } from './dingtalk-developer-session'
import {
  DingTalkApprovalPending,
  DingTalkApproverSelectionRequired,
  DingTalkOpenPlatformMemberBotProvisioner,
  DingTalkProvisioningError,
  type DingTalkProvisioningInput
} from './dingtalk-member-bot-provisioner'

describe('direct DingTalk Open Platform member Bot provisioning', () => {
  it('recovers completed application credentials with read-only console calls and no new app or version', async () => {
    const gateway = resumeGateway({ initialStatus: { versionStatus: 'RELEASE' } })
    const resolveIconMediaId = vi.fn(async () => 'unused')
    const onStep = vi.fn<DingTalkProvisioningInput['onStep']>(async () => undefined)

    const result = await provisioner(gateway).create(input({
      frozen: frozen(), resumeState: 'completed', resolveIconMediaId, onStep
    }))

    expect(result).toMatchObject({
      unifiedAppId: 'u-app-1', appKey: 'ding-app-1', appSecret: 'secret-1',
      robotCode: 'ding-app-1', versionId: 'version-1'
    })
    expect(gateway.operations).toEqual([
      'app.get', 'app.credentials.get', 'app.robot.get', 'app.version.status'
    ])
    expect(resolveIconMediaId).not.toHaveBeenCalled()
    expect(onStep).toHaveBeenCalledWith('credentials_read', expect.objectContaining({
      unifiedAppId: 'u-app-1', appKey: 'ding-app-1'
    }))
  })

  it('creates, configures, verifies, and releases one frozen app', async () => {
    const gateway = new ScriptedGateway({
      'app.create': [{ unifiedAppId: 'u-app-1' }],
      'app.get': [
        { unifiedAppId: 'u-app-1' },
        { unifiedAppId: 'u-app-1', iconMediaId: 'media-1' }
      ],
      'app.credentials.get': [{ appKey: 'ding-app-1', appSecret: 'secret-1' }],
      'app.update': [{}],
      'app.robot.config': [{}],
      'app.robot.enable': [{}],
      'app.robot.get': [{
        mode: 'STREAM', name: '芝士', iconMediaId: 'media-1', robotStatus: 'ONLINE'
      }],
      'app.permission.add': [{}],
      'app.permission.list': [{
        items: [{ permissionCode: 'scope.robot', auth_status: 'AUTHED' }]
      }],
      'app.event.subscribe': [{}],
      'app.event.list': [{
        events: [{ event_code: 'event.robot', subscribe_status: 'ON' }]
      }],
      'app.version.create': [{ versionId: 'version-1' }],
      'app.version.status': [{ status: 'DEVELOPMENT' }, { versionStatus: 'RELEASE' }],
      'app.version.checkApproval': [{ approvalMode: 'NO_APPROVAL' }],
      'app.version.publish': [{ published: true }]
    })
    const steps: string[] = []
    const resolveIcon = vi.fn(async () => 'media-1')
    const result = await provisioner(gateway).create(input({
      resolveIconMediaId: resolveIcon,
      requiredScopeValues: ['scope.robot'],
      requiredEventCodes: ['event.robot'],
      onStep: async (step) => { steps.push(step) }
    }))

    expect(result).toEqual({
      unifiedAppId: 'u-app-1',
      appKey: 'ding-app-1',
      appSecret: 'secret-1',
      robotCode: 'ding-app-1',
      versionId: 'version-1'
    })
    expect(resolveIcon).toHaveBeenCalledTimes(1)
    expect(steps).toEqual([
      'account_verified', 'app_created', 'credentials_read', 'avatar_configured',
      'robot_configured', 'permissions_configured', 'version_created', 'version_released'
    ])
    expect(gateway.operations).toEqual([
      'app.create', 'app.get', 'app.credentials.get',
      'app.update', 'app.get', 'app.robot.config', 'app.robot.enable',
      'app.robot.get', 'app.permission.add', 'app.permission.list',
      'app.event.subscribe', 'app.event.list', 'app.version.create',
      'app.version.status', 'app.version.checkApproval', 'app.version.publish',
      'app.version.status'
    ])
    expect(gateway.requests.find((request) => request.operation === 'app.permission.list')?.values)
      .toEqual({
        unifiedAppId: 'u-app-1',
        scopeValue: 'scope.robot',
        authStatus: 'AUTHED',
        pageSize: '1'
      })
    expect(gateway.requests.find((request) => request.operation === 'app.event.list')?.values)
      .toEqual({
        unifiedAppId: 'u-app-1',
        keyword: 'event.robot',
        pageSize: '50'
      })
  })

  it('locks an app create whose remote result is unknown', async () => {
    const gateway = new ScriptedGateway({
      'app.create': [new Error('transport_lost')]
    })

    await expect(provisioner(gateway).create(input()))
      .rejects.toMatchObject({
        message: 'dingtalk_app_create_unknown_remote_state',
        unknownRemoteState: true
      } satisfies Partial<DingTalkProvisioningError>)
    expect(gateway.operations).toEqual(['app.create'])
  })

  it('locks a create whose successful HTTP response cannot identify the app', async () => {
    const gateway = new ScriptedGateway({
      'app.create': ['not-an-object']
    })

    await expect(provisioner(gateway).create(input()))
      .rejects.toMatchObject({
        message: 'dingtalk_app_create_unknown_remote_state',
        unknownRemoteState: true
      } satisfies Partial<DingTalkProvisioningError>)
  })

  it('keeps an explicit remote create rejection recoverable', async () => {
    const gateway = new ScriptedGateway({
      'app.create': [new DingTalkDeveloperApiError('dingtalk_open_platform_access_denied', {
        definitelyRejected: true
      })]
    })

    await expect(provisioner(gateway).create(input()))
      .rejects.toMatchObject({
        message: 'dingtalk_open_platform_access_denied',
        definitelyRejected: true
      })
  })

  it('fails closed when the developer service reports a nested business failure', async () => {
    const gateway = new ScriptedGateway({
      'app.create': [{ result: { success: false, errorCode: 'Forbidden' } }]
    })

    await expect(provisioner(gateway).create(input()))
      .rejects.toMatchObject({ message: 'dingtalk_open_platform_operation_failed' })
    expect(gateway.operations).toEqual(['app.create'])
  })

  it('does not accept a permission row that is present but not authorized', async () => {
    const gateway = new ScriptedGateway({
      'app.get': [{ unifiedAppId: 'u-app-1' }],
      'app.credentials.get': [{ appKey: 'ding-app-1', appSecret: 'secret-1' }],
      'app.robot.get': [{
        robotCode: 'ding-app-1', mode: 'STREAM', name: '芝士',
        robotStatus: 'ONLINE'
      }],
      'app.permission.add': [{}],
      'app.permission.list': [{
        items: [{ permissionCode: 'scope.robot', auth_status: 'UNAUTHED' }]
      }]
    })

    await expect(provisioner(gateway).create(input({
      frozen: frozen(),
      resumeState: 'robot_configured',
      requiredScopeValues: ['scope.robot']
    }))).rejects.toMatchObject({ message: 'dingtalk_permission_verification_failed' })
    expect(gateway.operations).not.toContain('app.version.publish')
  })

  it('waits for explicit Owner approver selection before publishing', async () => {
    const gateway = resumeGateway({
      checkApproval: {
        approvalMode: 'SELECT_APPROVER',
        approvalCandidates: [{ userId: 'approver-1', name: '管理员甲' }]
      }
    })
    const memberBotProvisioner = provisioner(gateway)

    await expect(memberBotProvisioner.create(input({
      frozen: frozen(),
      resumeState: 'version_created'
    }))).rejects.toMatchObject({
      message: 'dingtalk_approver_selection_required',
      candidates: [{ userId: 'approver-1', displayName: '管理员甲' }]
    } satisfies Partial<DingTalkApproverSelectionRequired>)
    expect(gateway.operations).not.toContain('app.version.publish')
  })

  it('fails closed on an unknown approval mode', async () => {
    const gateway = resumeGateway({
      checkApproval: { approvalMode: 'FUTURE_MODE' }
    })

    await expect(provisioner(gateway).create(input({
      frozen: frozen(),
      resumeState: 'version_created'
    }))).rejects.toMatchObject({ message: 'dingtalk_approval_mode_invalid' })
    expect(gateway.operations).not.toContain('app.version.publish')
  })

  it('bounds and deduplicates remote approver candidates before exposing them', async () => {
    const approvalCandidates = Array.from({ length: 60 }, (_, index) => ({
      userId: `approver-${index}`,
      name: `管理员 ${index}`
    }))
    approvalCandidates.push({ userId: 'approver-0', name: '重复管理员' })
    const gateway = resumeGateway({
      checkApproval: { approvalMode: 'SELECT_APPROVER', approvalCandidates }
    })

    const error = await provisioner(gateway).create(input({
      frozen: frozen(),
      resumeState: 'version_created'
    })).catch((caught) => caught)

    expect(error).toBeInstanceOf(DingTalkApproverSelectionRequired)
    expect((error as DingTalkApproverSelectionRequired).candidates).toHaveLength(50)
    expect((error as DingTalkApproverSelectionRequired).candidates[0]).toEqual({
      userId: 'approver-0',
      displayName: '管理员 0'
    })
  })

  it('submits the selected approver once and resumes by read-back without republishing', async () => {
    const pendingGateway = resumeGateway({
      checkApproval: { approvalMode: 'SELECT_APPROVER' },
      publish: { approvalSubmitted: true },
      afterPublishStatus: { versionStatus: 'AUDIT' }
    })
    const memberBotProvisioner = provisioner(pendingGateway)
    await expect(memberBotProvisioner.create(input({
      frozen: frozen(),
      resumeState: 'awaiting_approver_selection',
      selectedApproverUserId: 'approver-1'
    }))).rejects.toBeInstanceOf(DingTalkApprovalPending)
    expect(pendingGateway.requests.find((request) => request.operation === 'app.version.publish')?.values)
      .toMatchObject({ approverUserId: 'approver-1' })

    const releasedGateway = resumeGateway({
      initialStatus: { versionStatus: 'RELEASE' }
    })
    const result = await provisioner(releasedGateway).create(input({
      frozen: frozen(),
      resumeState: 'awaiting_approval',
      frozenApprovalMode: 'SELECT_APPROVER'
    }))
    expect(result.unifiedAppId).toBe('u-app-1')
    expect(releasedGateway.operations).not.toContain('app.version.publish')
  })

  it('converges from release status when the publish response is lost', async () => {
    const gateway = resumeGateway({
      publish: new Error('transport_lost'),
      afterPublishStatus: { versionStatus: 'RELEASE' }
    })

    const result = await provisioner(gateway).create(input({
      frozen: frozen(),
      resumeState: 'version_created'
    }))

    expect(result.unifiedAppId).toBe('u-app-1')
    expect(gateway.operations.filter((operation) => operation === 'app.version.publish'))
      .toHaveLength(1)
    expect(gateway.operations.filter((operation) => operation === 'app.version.status'))
      .toHaveLength(2)
  })
})

function input(overrides: Partial<DingTalkProvisioningInput> = {}): DingTalkProvisioningInput {
  return {
    appName: '芝士',
    description: 'Rovai AI 队员 · 鉴定士',
    resolveIconMediaId: async () => 'media-1',
    expectedCorpId: 'corp-1',
    expectedUserId: 'owner-1',
    requiredScopeValues: [],
    requiredEventCodes: [],
    signal: new AbortController().signal,
    onStep: async () => undefined,
    ...overrides
  }
}

function frozen(): NonNullable<DingTalkProvisioningInput['frozen']> {
  return {
    unifiedAppId: 'u-app-1',
    appKey: 'ding-app-1',
    robotCode: 'ding-app-1',
    versionId: 'version-1'
  }
}

function resumeGateway(options: {
  initialStatus?: Record<string, unknown>
  checkApproval?: Record<string, unknown>
  publish?: Record<string, unknown> | Error
  afterPublishStatus?: Record<string, unknown>
}): ScriptedGateway {
  return new ScriptedGateway({
    'app.get': [{ unifiedAppId: 'u-app-1' }],
    'app.credentials.get': [{ appKey: 'ding-app-1', appSecret: 'secret-1' }],
    'app.robot.get': [{
      robotCode: 'ding-app-1', mode: 'STREAM', name: '芝士',
      robotStatus: 'ONLINE'
    }],
    'app.version.status': [
      options.initialStatus ?? { status: 'DEVELOPMENT' },
      options.afterPublishStatus ?? { versionStatus: 'RELEASE' }
    ],
    'app.version.checkApproval': [options.checkApproval ?? { approvalMode: 'NO_APPROVAL' }],
    'app.version.publish': [options.publish ?? { published: true }]
  })
}

function provisioner(gateway: DingTalkDeveloperBackend): DingTalkOpenPlatformMemberBotProvisioner {
  const developerSession: DingTalkDeveloperSessionService = {
    inspect: async () => ({
      accountId: 'account-1',
      userIdDigest: `sha256:${'a'.repeat(64)}`,
      corpId: 'corp-1',
      userId: 'owner-1',
      userName: 'Owner',
      corpName: 'Corp',
      oauthProfileRef: 'dingtalk-oauth:profile-1',
      expiresAt: '2026-08-30T00:00:00Z'
    }),
    beginLogin: async () => { throw new Error('unused') },
    accessToken: async () => 'access-token',
    activate: async () => undefined,
    disconnect: async () => undefined
  }
  return new DingTalkOpenPlatformMemberBotProvisioner({
    developerApi: gateway,
    developerSession
  })
}

class ScriptedGateway implements DingTalkDeveloperBackend {
  readonly requests: DingTalkDeveloperRequest[] = []
  readonly #responses: Partial<Record<DingTalkDeveloperOperation, unknown[]>>

  constructor(responses: Partial<Record<DingTalkDeveloperOperation, unknown[]>>) {
    this.#responses = Object.fromEntries(
      Object.entries(responses).map(([operation, values]) => [operation, [...values]])
    )
  }

  get operations(): DingTalkDeveloperOperation[] {
    return this.requests.map((request) => request.operation)
  }

  async execute(request: DingTalkDeveloperRequest): Promise<unknown> {
    this.requests.push(request)
    const response = this.#responses[request.operation]?.shift()
    if (response instanceof Error) throw response
    if (response === undefined) throw new Error(`missing scripted response:${request.operation}`)
    return response
  }
}
