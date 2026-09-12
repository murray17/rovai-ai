import { describe, expect, it, vi } from 'vitest'
import { DingTalkLoginProtocol, parseDingTalkAuthContext, readDingTalkLoginBootstrap } from './dingtalk-login-protocol'
import { DingTalkLoginTransport, type DingTalkLoginFetch } from './dingtalk-login-transport'

vi.mock('electron', () => ({ net: { request: vi.fn() } }))
const callback = 'https://open-dev.dingtalk.com/dingtalk_sso_call_back?continue=https%3A%2F%2Fopen-dev.dingtalk.com%2F'
const challengeUrl = `https://login.dingtalk.com/oauth2/challenge.htm?${new URLSearchParams({
  client_id: 'backend-client', redirect_uri: callback, response_type: 'code', scope: 'openid corpid', state: 'opaque-state'
})}`
const qrPayload = 'https://login.dingtalk.com/oauth2/qr_confirm.htm?code=qr%2Bticket'
const qr = { ticket: 'qr+ticket', qrPayload, expiresAt: null }
const authenticated = { secondaryValidationResult: '', chooseOrganization: false, needConsent: false }
const json = (body: unknown) => new Response(JSON.stringify(body))
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })
const signal = () => new AbortController().signal

describe('current DingTalk OAuth QR protocol', () => {
  it('derives authentication from the backend and uses its form context and complete scan URL', async () => {
    const fetch = vi.fn<DingTalkLoginFetch>()
      .mockResolvedValueOnce(redirect(challengeUrl))
      .mockResolvedValueOnce(new Response('<!-- window.__LOGIN_PAGE_VARS = evil() -->' +
        '<script>window.__LOGIN_PAGE_VARS = { needLogin: true, exclusiveCorpId: "" };</script>'))
      .mockResolvedValueOnce(json({ success: true, result: qrPayload }))
      .mockResolvedValueOnce(json({ success: false, errorCode: '11021' }))
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(fetch))
    const opened = await protocol.open(signal())
    expect(opened.kind).toBe('challenge')
    if (opened.kind !== 'challenge') throw new Error('Expected challenge')
    expect(await protocol.initialize(opened.context, signal())).toEqual(qr)
    expect(await protocol.poll(opened.context, qr, signal())).toEqual({ kind: 'waiting' })
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/', '/oauth2/challenge.htm', '/oauth2/generate_qrcode', '/oauth2/login_with_qr'
    ])
    for (const [, request] of fetch.mock.calls.slice(2)) {
      expect(request.method).toBe('POST')
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      const body = new URLSearchParams(request.body)
      expect(body.get('client_id')).toBe('backend-client')
      expect(body.get('redirect_uri')).toBe(callback)
      expect(body.get('state')).toBe('opaque-state')
      expect(body.has('pdmToken')).toBe(false)
    }
    const body = new URLSearchParams(fetch.mock.calls[3]![1].body)
    expect(body.get('code')).toBe(qr.ticket)
    expect(body.get('stayLogin')).toBe('false')
  })

  it.each([['11021', 'waiting'], ['11041', 'scanned'], ['11019', 'expired']])(
    'maps the observed business code %s to %s', async (errorCode, kind) => {
      const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(async () => json({ success: false, errorCode })))
      expect(await protocol.poll(parseDingTalkAuthContext(challengeUrl), qr, signal())).toEqual({ kind })
    }
  )

  it('accepts completion without a prior scanned response and preserves callback correlation during SSO', async () => {
    const next = new URL(callback)
    next.searchParams.set('code', 'authorization+code')
    const fetch = vi.fn<DingTalkLoginFetch>()
      .mockResolvedValueOnce(json({ success: true, result: authenticated }))
      .mockResolvedValueOnce(json({ success: true, result: { url: next.href } }))
      .mockResolvedValueOnce(redirect('https://open-dev.dingtalk.com/fe/app'))
      .mockResolvedValueOnce(new Response('console'))
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(fetch))
    const context = parseDingTalkAuthContext(challengeUrl)
    const state = await protocol.poll(context, qr, signal())
    if (state.kind !== 'authenticated') throw new Error('Expected authentication')
    expect(await protocol.complete(context, state, signal())).toEqual({ kind: 'console' })
    expect(new URLSearchParams(fetch.mock.calls[1]![1].body).get('corpId')).toBe('')
    expect(fetch.mock.calls[2]![0]).toBe(next.href)
    for (const [, request] of fetch.mock.calls.slice(2)) {
      expect(request.body).toBeUndefined()
      expect([...request.headers.keys()]).toEqual(['accept'])
    }
  })

  it.each(['chooseOrganization', 'needConsent', 'needBindMobile', 'needChangePwd'])('hands %s to the official page without selecting or consenting', async flag => {
    const fetch = vi.fn<DingTalkLoginFetch>(async () => json({ success: true, result: { ...authenticated, [flag]: true } }))
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(fetch))
    expect(await protocol.poll(parseDingTalkAuthContext(challengeUrl), qr, signal()))
      .toEqual({ kind: 'interaction', url: challengeUrl })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses the official empty secondary-result default when known login fields are present', async () => {
    const fetch = vi.fn<DingTalkLoginFetch>(async () => json({ success: true,
      result: { pass: true, chooseOrganization: false, needConsent: false } }))
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(fetch))
    expect(await protocol.poll(parseDingTalkAuthContext(challengeUrl), qr, signal()))
      .toEqual({ kind: 'authenticated', secondaryValidationResult: '' })
  })

  it('preserves the explicit account-confirmation step in an already authenticated bootstrap', async () => {
    const fetch = vi.fn<DingTalkLoginFetch>()
      .mockResolvedValueOnce(redirect(challengeUrl))
      .mockResolvedValueOnce(new Response('<script>window.__LOGIN_PAGE_VARS={needLogin:false,needConfirm:true,oauthLoginResult:{pass:true}};</script>'))
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(fetch))
    expect(await protocol.open(signal())).toMatchObject({ kind: 'challenge', next: { kind: 'interaction', url: challengeUrl } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([{ success: true }, { success: true, result: {} }, { success: false, errorCode: 2 },
    { success: false, errorCode: 'new-state', errorMsg: 'private-ticket' },
    { success: true, result: { ...authenticated, needUnknownFactor: true } },
    { success: true, result: { ...authenticated, secondaryValidationResult: null } },
    { success: true, result: { ...authenticated, pbcProtocolList: 'unrecognized' } }])('fails closed on unsupported response %j', async response => {
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(async () => json(response)))
    await expect(protocol.poll(parseDingTalkAuthContext(challengeUrl), qr, signal())).rejects.toThrow('dingtalk_login_protocol_incompatible')
  })

  it('rejects callback substitution before issuing the credential-bearing request', async () => {
    const fetch = vi.fn<DingTalkLoginFetch>(async () => json({ success: true,
      result: { url: 'https://open-dev.dingtalk.com/dingtalk_sso_call_back?continue=changed&code=private' } }))
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(fetch))
    await expect(protocol.complete(parseDingTalkAuthContext(challengeUrl), {
      kind: 'authenticated', secondaryValidationResult: ''
    }, signal())).rejects.toThrow('dingtalk_login_protocol_incompatible')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['arbitrary-ticket', 'https://evil.example/?code=private',
    'https://login.dingtalk.com/login/qrcode.htm?code=other-flow',
    'https://login.dingtalk.com/oauth2/qr_confirm.htm'])('rejects unsupported QR payload %s', async payload => {
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(async () => json({ success: true, result: payload })))
    await expect(protocol.initialize(parseDingTalkAuthContext(challengeUrl), signal())).rejects.toThrow('dingtalk_login_protocol_incompatible')
  })

  it('parses inert bootstrap values and rejects executable assignments or duplicate authority', () => {
    expect(readDingTalkLoginBootstrap('<script>window.__LOGIN_PAGE_VARS={needLogin:true, env:{name:"online"}};</script>'))
      .toMatchObject({ needLogin: true })
    for (const source of ['window.__LOGIN_PAGE_VARS=loadSecrets()',
      'window.__LOGIN_PAGE_VARS={needLogin:true};window.__LOGIN_PAGE_VARS={needLogin:false}',
      'window.__LOGIN_PAGE_VARS={needLogin:true, get ssoUrl(){return "evil"}}']) {
      expect(() => readDingTalkLoginBootstrap(`<script>${source}</script>`)).toThrow('dingtalk_login_protocol_incompatible')
    }
  })
})
