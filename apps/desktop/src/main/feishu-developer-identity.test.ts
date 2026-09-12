import { describe, expect, it } from 'vitest'
import { normalizeFeishuIdentity, readOpenPlatformBootstrap } from './feishu-developer-identity'

const origin = 'https://open.feishu.cn'
const identity = { id: 'u1', name: '张三', tenantId: 't1', tenantName: '示例团队' }
const html = (user: string, csrf = '"csrf-fixture"') => `<script>(()=>{window.user=${user};window.csrfToken=${csrf};window.outDomain={larkOpen:'${origin}'};})()</script>`

describe('Feishu identity normalization and passive HTML bootstrap', () => {
  it('chooses the first nonblank typed alias without requiring email or unrelated fields', () => {
    expect(normalizeFeishuIdentity({
      id: false, userId: '  ', user_id: ' u_123 ', name: {}, userName: '', user_name: '\t',
      displayName: { value: ' 张三 🌼 ' }, tenantId: null, tenant_id: ' t_456 ',
      tenantName: 'fallback', tenantDisplayName: { value: ' 示例团队 ' },
      email: 42, unrelated: ['anything']
    }, origin)).toEqual({ brand: 'feishu', userId: 'u_123', userName: '张三 🌼', tenantId: 't_456', tenantName: '示例团队' })
    expect(normalizeFeishuIdentity({
      ...identity, userId: 'ignored', user_id: 'ignored', userName: 'ignored',
      tenantDisplayName: { value: ' ' }, tenant_name: 'ignored', email: ' x@example.org '
    }, origin)).toEqual({ brand: 'feishu', userId: 'u1', userName: '张三', tenantId: 't1', tenantName: '示例团队', email: 'x@example.org' })
  })

  it.each(['id', 'name', 'tenantId', 'tenantName'] as const)('rejects missing %s without substituting other identity fields', (field) => {
    expect(() => normalizeFeishuIdentity({ ...identity, [field]: '   ', email: 'id@example.org' }, origin))
      .toThrow('feishu_developer_identity_incomplete')
  })

  it('decodes only data literals and a literal JSON.parse, including escaped braces and display names', () => {
    const user = { user_id: 'u1', displayName: { value: '名"{}\\称' }, tenant_id: 't1', tenantDisplayName: { value: '团队' } }
    const result = readOpenPlatformBootstrap(html(`JSON.parse(${JSON.stringify(JSON.stringify(user))})`), `${origin}/app`)
    expect(result.identity).toMatchObject({ userId: 'u1', userName: '名"{}\\称', tenantName: '团队' })
    expect(result.csrfToken).toBe('csrf-fixture')
  })

  it('ignores HTML comments, non-script text, deferred functions and conditional assignments', () => {
    const valid = html(JSON.stringify(identity))
    const fake = html(JSON.stringify({ ...identity, id: 'attacker' }))
    const result = readOpenPlatformBootstrap(`<!--${fake}--><div>window.user={id:'fake'}</div>${valid}<script>
      function neverCalled(){window.user={id:'other'}}
      if(false){window.user={id:'other'}}
    </script>`, origin)
    expect(result.identity.userId).toBe('u1')
  })

  it('never executes arbitrary calls or accessors in the remote page', () => {
    const source = html(`{...${JSON.stringify(identity)}, id:(globalThis.__feishuFixtureExecuted = true), get name(){throw 1}}`)
    expect(() => readOpenPlatformBootstrap(source, origin)).toThrow('feishu_developer_identity_incomplete')
    expect((globalThis as Record<string, unknown>).__feishuFixtureExecuted).toBeUndefined()
    expect(() => readOpenPlatformBootstrap(html('loadUser()'), origin)).toThrow('feishu_developer_identity_incomplete')
    expect(() => readOpenPlatformBootstrap(html(JSON.stringify(identity), 'fetch("/csrf")'), origin)).toThrow('feishu_open_platform_bootstrap_incomplete')
  })

  it('rejects a declared API origin that differs from the final trusted site', () => {
    const source = html(JSON.stringify(identity)).replace("larkOpen:'https://open.feishu.cn'", "larkOpen:'https://open.feishu.cn.evil.example'")
    expect(() => readOpenPlatformBootstrap(source, origin)).toThrow('feishu_open_platform_origin_rejected')
  })

  it('reports only missing field names, never raw user or CSRF data', () => {
    try { readOpenPlatformBootstrap(html('{id:"secret-id",email:"private-email"}'), origin); throw new Error('expected failure') }
    catch (error) {
      expect(error).toMatchObject({ message: 'feishu_developer_identity_incomplete', details: { missingFields: ['userName', 'tenantId', 'tenantName'] } })
      expect(JSON.stringify(error)).not.toMatch(/secret-id|private-email|csrf-fixture/)
    }
  })
})
