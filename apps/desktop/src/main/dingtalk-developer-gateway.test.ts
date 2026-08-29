import { describe, expect, it } from 'vitest'
import { buildDingTalkGatewayInvocation } from './dingtalk-developer-gateway'

describe('DingTalk Developer Gateway command boundary', () => {
  it('uses reviewed full commands for writes missing from the shortcut catalog', () => {
    expect(buildDingTalkGatewayInvocation({
      operation: 'app.permission.add',
      values: {
        unifiedAppId: 'u-app',
        scopeValues: ['scope.one', 'scope.two']
      }
    }).args).toEqual([
      'dev', 'app', 'permission', 'add',
      '--unified-app-id', 'u-app',
      '--scope-values', 'scope.one,scope.two',
      '--yes', '--format', 'json'
    ])

    expect(buildDingTalkGatewayInvocation({
      operation: 'app.version.publish',
      values: {
        unifiedAppId: 'u-app',
        versionId: 'version-1',
        confirmedSensitive: true
      }
    }).args).toContain('publish')
  })

  it('emits Cobra boolean flags without a string value', () => {
    const invocation = buildDingTalkGatewayInvocation({
      operation: 'app.robot.config',
      values: {
        unifiedAppId: 'u-app',
        mode: 'STREAM',
        addScope: true
      }
    })
    expect(invocation.args).toContain('--add-scope')
    expect(invocation.args).not.toContain('true')
  })

  it('requires the Rovai OAuth Client and keeps its secret out of argv', () => {
    expect(() => buildDingTalkGatewayInvocation({ operation: 'auth.login' }))
      .toThrow('dingtalk_oauth_client_unconfigured')

    const invocation = buildDingTalkGatewayInvocation({
      operation: 'auth.login',
      values: { device: true }
    }, {
      oauthClientId: 'oauth-client',
      oauthClientSecret: 'oauth-secret'
    })
    expect(invocation.args).toEqual(['auth', 'login', '--device'])
    expect(invocation.args.join(' ')).not.toContain('oauth-secret')
    expect(invocation.env).toMatchObject({
      DWS_CLIENT_ID: 'oauth-client',
      DWS_CLIENT_SECRET: 'oauth-secret'
    })
  })

  it('rejects unknown argument names and unsafe empty values', () => {
    expect(() => buildDingTalkGatewayInvocation({
      operation: 'app.get',
      values: { unexpected: 'value' }
    })).toThrow('dingtalk_gateway_argument_rejected:unexpected')
    expect(() => buildDingTalkGatewayInvocation({
      operation: 'app.get',
      values: { unifiedAppId: ' ' }
    })).toThrow('dingtalk_gateway_argument_invalid:unifiedAppId')
  })

  it('allows only a canonical positional selector when switching profiles', () => {
    expect(buildDingTalkGatewayInvocation({
      operation: 'profile.switch',
      values: { profileSelector: 'corp-1:owner-1' }
    }).args).toEqual([
      'profile', 'switch', 'corp-1:owner-1', '--format', 'json'
    ])
    expect(() => buildDingTalkGatewayInvocation({
      operation: 'profile.switch',
      values: { profileSelector: ' ' }
    })).toThrow('dingtalk_gateway_argument_invalid:profileSelector')
  })
})
