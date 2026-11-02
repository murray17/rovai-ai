export type ChatContact = { openId: string; name: string; department?: string }

export type ContactSearchErrorCode = 'permission_denied' | 'unavailable' | 'invalid_response'

export class ContactSearchError extends Error {
  constructor(readonly code: ContactSearchErrorCode, message = 'contact search failed') {
    super(message)
    this.name = 'ContactSearchError'
  }
}

export type ContactSearchRequest = {
  appId: string
  appSecret: string
  domain?: 'feishu' | 'lark'
  query: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

const PERMISSION_CODES = new Set([99991672, 99991663, 41050, 40004])
const SEARCH_TIMEOUT_MS = 15_000

function contact(value: unknown): ChatContact | null {
  if (!value || typeof value !== 'object') return null
  const user = value as Record<string, unknown>
  if (typeof user.open_id !== 'string' || !user.open_id.startsWith('ou_')
    || user.open_id.length > 128 || typeof user.name !== 'string' || !user.name.trim()) return null
  const department = typeof user.department === 'string' ? user.department
    : Array.isArray(user.department_names) ? user.department_names.filter((name) => typeof name === 'string').join(' / ')
      : undefined
  return { openId: user.open_id, name: user.name.slice(0, 200), ...(department ? { department: department.slice(0, 300) } : {}) }
}

/** Bounded live queries use only the Bot's granted scope; no directory is cached. */
export async function searchContacts(request: ContactSearchRequest): Promise<ChatContact[]> {
  const query = request.query.trim()
  if (!query) return []
  if (query.length > 200) throw new ContactSearchError('invalid_response')
  const fetchImpl = request.fetchImpl ?? fetch
  const root = request.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  const read = async (url: string, init: RequestInit = {}) => {
    let response: Response
    try {
      signal.throwIfAborted()
      response = await fetchImpl(url, { ...init, signal })
    } catch {
      throw new ContactSearchError('unavailable')
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ContactSearchError('invalid_response')
    }
    return { response, payload: payload as Record<string, any> }
  }
  const tokenResult = await read(root + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: request.appId, app_secret: request.appSecret })
  })
  if (!tokenResult.response.ok || tokenResult.payload.code !== 0) {
    throw new ContactSearchError(PERMISSION_CODES.has(tokenResult.payload.code) ? 'permission_denied' : 'unavailable')
  }
  const token = tokenResult.payload.tenant_access_token
  if (typeof token !== 'string' || !token) throw new ContactSearchError('invalid_response')
  const headers = { authorization: 'Bearer ' + token }
  // This is an application token. Search/v1/user only accepts user tokens.
  // Follow the app's effective scope rather than assuming access to department 0.
  let requests = 0
  const get = async (path: string, params: Record<string, string> = {}) => {
    if (++requests > 60) throw new ContactSearchError('unavailable')
    const { response, payload } = await read(root + '/open-apis/contact/v3/' + path
      + '?' + new URLSearchParams({ user_id_type: 'open_id', department_id_type: 'open_department_id', ...params }), { headers })
    if (!response.ok || payload.code !== 0) {
      throw new ContactSearchError(PERMISSION_CODES.has(payload.code) ? 'permission_denied' : 'unavailable')
    }
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new ContactSearchError('invalid_response')
    }
    return payload.data as Record<string, any>
  }
  async function* pages(path: string, params: Record<string, string> = {}) {
    let pageToken = ''
    const tokens = new Set<string>()
    for (let page = 0; page < 12; page += 1) {
      const data = await get(path, { page_size: '50', ...params, ...(pageToken ? { page_token: pageToken } : {}) })
      yield data
      if (!data.has_more) return
      if (typeof data.page_token !== 'string' || !data.page_token || tokens.has(data.page_token)) {
        throw new ContactSearchError('invalid_response')
      }
      tokens.add(data.page_token)
      pageToken = data.page_token
    }
    throw new ContactSearchError('unavailable')
  }
  const users = new Set<string>()
  const departments = new Set<string>()
  let unsupportedGroups = false
  for await (const scope of pages('scopes')) {
    for (const [field, target] of [['user_ids', users], ['department_ids', departments]] as const) {
      const ids = scope[field] ?? []
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 128)) {
        throw new ContactSearchError('invalid_response')
      }
      for (const id of ids) target.add(id)
    }
    if (scope.group_ids !== undefined && !Array.isArray(scope.group_ids)) throw new ContactSearchError('invalid_response')
    unsupportedGroups ||= (scope.group_ids?.length ?? 0) > 0
    if (users.size + departments.size > 600) throw new ContactSearchError('unavailable')
  }
  const matches: ChatContact[] = []
  const seenIds = new Set<string>()
  let examined = 0
  const collect = (raw: unknown): void => {
    if (++examined > 600) throw new ContactSearchError('unavailable')
    const user = contact(raw)
    // Missing name visibility is not evidence that the searched person is absent.
    if (!user) throw new ContactSearchError('invalid_response')
    if (user.name.includes(query) && !seenIds.has(user.openId)) {
      matches.push(user)
      seenIds.add(user.openId)
    }
  }
  for (const id of users) {
    if (!/^ou_[A-Za-z0-9_]+$/.test(id)) throw new ContactSearchError('invalid_response')
    const detail = await get('users/' + encodeURIComponent(id))
    collect(detail.user)
    if (matches.length === 20) return matches
  }
  const roots = [...departments]
  const visited = new Set<string>()
  const scan = async (id: string): Promise<void> => {
    if (visited.has(id)) return
    visited.add(id)
    for await (const data of pages('users/find_by_department', { department_id: id })) {
      const items = data.items ?? (data.has_more === false ? [] : undefined)
      if (!Array.isArray(items)) throw new ContactSearchError('invalid_response')
      for (const raw of items) {
        collect(raw)
        if (matches.length === 20) return
      }
    }
  }
  for (const id of roots) {
    await scan(id)
    if (matches.length === 20) return matches
    for await (const data of pages('departments/' + encodeURIComponent(id) + '/children', { fetch_child: 'true' })) {
      const items = data.items ?? (data.has_more === false ? [] : undefined)
      if (!Array.isArray(items)) throw new ContactSearchError('invalid_response')
      for (const department of items) {
        if (typeof department?.open_department_id !== 'string' || !department.open_department_id) {
          throw new ContactSearchError('invalid_response')
        }
        await scan(department.open_department_id)
        if (matches.length === 20) return matches
      }
    }
  }
  if (unsupportedGroups) throw new ContactSearchError('unavailable')
  return matches
}
