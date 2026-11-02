import { describe, expect, it, vi } from 'vitest'
import { ContactSearchError, searchContacts } from './feishu-contact-search'

const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, data }), { status })
const person = (id = 'ou_target', name = '李嘉华.agent') => ({ open_id: id, name })
function fixture(route: (url: URL) => Response, tokenCode = 0) {
  return vi.fn(async (url: string | URL | Request) => {
    const parsed = new URL(String(url))
    if (parsed.pathname.endsWith('tenant_access_token/internal')) {
      return new Response(JSON.stringify({ code: tokenCode, tenant_access_token: tokenCode ? undefined : 'private-token' }))
    }
    if (parsed.pathname.endsWith('/children')) return response({ has_more: false })
    return route(parsed)
  }) as unknown as typeof fetch
}
const request = (fetchImpl: typeof fetch) => ({ appId: 'cli_test', appSecret: 'secret', query: '李嘉华', fetchImpl })

describe('Feishu contact search', () => {
  it('finds a colleague in an explicitly authorized non-root department', async () => {
    const fetchImpl = fixture(url => {
      if (url.pathname.endsWith('/scopes')) return response({ department_ids: ['od_a', 'od_b'], has_more: false })
      if (url.pathname.endsWith('/find_by_department')) {
        expect(url.searchParams.get('department_id')).not.toBe('0')
        return response({ items: url.searchParams.get('department_id') === 'od_b' ? [person()] : [], has_more: false })
      }
      throw new Error('unexpected endpoint')
    })
    await expect(searchContacts(request(fetchImpl))).resolves.toEqual([{ openId: 'ou_target', name: '李嘉华.agent' }])
    expect(vi.mocked(fetchImpl).mock.calls.some(([url]) => String(url).includes('/search/v1/user'))).toBe(false)
  })

  it('reads a user-only scope without requiring department 0 authority', async () => {
    const fetchImpl = fixture(url => url.pathname.endsWith('/scopes')
      ? response({ user_ids: ['ou_target'], has_more: false })
      : response({ user: person() }))
    await expect(searchContacts(request(fetchImpl))).resolves.toHaveLength(1)
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(3)
  })

  it('paginates effective scope and user lists and deduplicates matching users', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.includes('tenant_access_token')) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token' }))
      if (url.pathname.endsWith('/scopes')) return response(url.searchParams.has('page_token')
        ? { department_ids: ['od_b'], has_more: false }
        : { department_ids: ['od_a'], page_token: 'scope-next', has_more: true })
      if (url.pathname.endsWith('/children')) return response({ items: [{ open_department_id: 'od_child' }], has_more: false })
      return response(url.searchParams.has('page_token')
        ? { items: [person()], has_more: false }
        : { items: [person()], has_more: true, page_token: 'users-next' })
    }) as unknown as typeof fetch
    await expect(searchContacts(request(fetchImpl))).resolves.toHaveLength(1)
    const departmentReads = vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).includes('department_id=od_child'))
    expect(departmentReads).toHaveLength(2)
  })

  it('uses Lark domain, limits matching candidates and does not return private fields', async () => {
    const fetchImpl = fixture(url => url.pathname.endsWith('/scopes')
      ? response({ department_ids: ['od_team'], has_more: false })
      : response({ items: Array.from({ length: 30 }, (_, i) => ({ ...person('ou_' + i), token: 'private' })), has_more: false }))
    const result = await searchContacts({ ...request(fetchImpl), domain: 'lark' })
    expect(result).toHaveLength(20)
    expect(JSON.stringify(result)).not.toMatch(/private|secret|token/)
    for (const [url] of vi.mocked(fetchImpl).mock.calls) expect(new URL(String(url)).origin).toBe('https://open.larksuite.com')
  })

  it('reports an incomplete scan instead of an empty definitive result', async () => {
    let page = 0
    const fetchImpl = fixture(url => url.pathname.endsWith('/scopes')
      ? response({ department_ids: ['od_team'], has_more: false })
      : response({ items: [], has_more: true, page_token: String(++page) }))
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'unavailable' })
    expect(page).toBe(12)
  })

  it.each([{ user_ids: {} }, { department_ids: [123] }])('rejects malformed scope instead of assuming root access', async data => {
    await expect(searchContacts(request(fixture(() => response(data))))).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('does not treat missing name visibility as no match', async () => {
    const fetchImpl = fixture(url => url.pathname.endsWith('/scopes')
      ? response({ user_ids: ['ou_target'], has_more: false }) : response({ user: { open_id: 'ou_target' } }))
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reports scope refusal safely without exposing provider messages', async () => {
    const fetchImpl = fixture(() => new Response(JSON.stringify({ code: 99991672, msg: 'private token secret' }), { status: 403 }))
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'permission_denied', message: 'contact search failed' })
    await expect(searchContacts(request(fetchImpl))).rejects.toBeInstanceOf(ContactSearchError)
  })

  it('does not issue directory queries after a server failure', async () => {
    const fetchImpl = fixture(() => response({}, 999, 500))
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'unavailable' })
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(2)
  })

  it('honors cancellation before requesting an access token', async () => {
    const fetchImpl = fixture(() => response({}))
    const controller = new AbortController(); controller.abort()
    await expect(searchContacts({ ...request(fetchImpl), signal: controller.signal })).rejects.toMatchObject({ code: 'unavailable' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
