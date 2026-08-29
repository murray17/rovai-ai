import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildDingTalkGatewayInvocation,
  materializeDingTalkDwsBinary,
  resolveDingTalkDwsOptions
} from './dingtalk-developer-gateway'

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

  it('materializes the reviewed macOS helper from a non-executable packaged resource', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovai-dws-materialize-'))
    try {
      const archivePath = join(root, 'dws.gz')
      const binaryPath = join(root, 'runtime', 'dws')
      const binary = Buffer.from('reviewed-dws-binary')
      const expectedSha256 = createHash('sha256').update(binary).digest('hex')
      await writeFile(archivePath, gzipSync(binary))

      await materializeDingTalkDwsBinary({ archivePath, binaryPath, expectedSha256 })
      expect(await readFile(binaryPath)).toEqual(binary)
      expect((await stat(binaryPath)).mode & 0o100).toBe(0o100)

      await writeFile(binaryPath, 'tampered')
      await materializeDingTalkDwsBinary({ archivePath, binaryPath, expectedSha256 })
      expect(await readFile(binaryPath)).toEqual(binary)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses a content-addressed private executable for packaged macOS', () => {
    const options = resolveDingTalkDwsOptions({
      appRoot: '/app',
      resourcesPath: '/app/Contents/Resources',
      packaged: true,
      userDataPath: '/private/user-data',
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(options.archivePath).toBe('/app/Contents/Resources/bin/dws.gz')
    expect(options.binaryPath).toContain('/private/user-data/channel-runtime/dingtalk-dws/v1.0.60/')
    expect(options.binaryPath).toMatch(/\/dws$/u)
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
