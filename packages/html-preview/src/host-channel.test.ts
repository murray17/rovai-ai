import { webcrypto } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { HtmlPreviewHostChannel } from './host-channel'
import { parseHtmlPreviewDiagnostic, validPreviewOrigin } from './protocol'

it('rejects foreign windows, origins, generations, malformed envelopes and stale document challenges', () => {
  vi.stubGlobal('crypto', webcrypto)
  const preview = { previewId:'p1',generation:'g1',origin:'http://preview.localhost:9000',entryUrl:'http://preview.localhost:9000/start',documentUrl:'http://preview.localhost:9000/index.html' }
  const host = new EventTarget() as EventTarget & {location:{origin:string}}; host.location={origin:'http://localhost:5000'}
  const sent: Record<string,unknown>[]=[]
  const frame={postMessage:(data:Record<string,unknown>)=>sent.push(data)} as unknown as Window
  const channel=new HtmlPreviewHostChannel(preview,()=>frame)
  const messages:Record<string,unknown>[]=[];channel.subscribe(message=>messages.push(message))
  const detach=channel.attach(host as unknown as Window)
  const receive=(data:Record<string,unknown>, origin=preview.origin, source=frame):void=>{
    const event=new Event('message');Object.assign(event,{data:{protocol:'rovai-html-preview-v1',previewId:'p1',generation:'g1',documentId:'d1',...data},origin,source});host.dispatchEvent(event)
  }
  receive({type:'hello'},'http://attacker.localhost');receive({type:'hello'},preview.origin,{} as Window);receive({type:'hello',generation:'old'})
  expect(sent).toHaveLength(0)
  receive({type:'hello'});const old=sent.at(-1)!.connectionId
  receive({type:'connected',connectionId:old});expect(channel.connected).toBe(true)
  receive({type:'diagnostic',connectionId:old});expect(messages.at(-1)!.type).toBe('diagnostic')
  receive({type:'hello',documentId:'new'});const current=sent.at(-1)!.connectionId
  expect(current).not.toBe(old);expect(channel.connected).toBe(false)
  const count=messages.length
  receive({type:'connected',connectionId:old});receive({type:'diagnostic',connectionId:old})
  expect(messages).toHaveLength(count)
  receive({type:'connected',connectionId:current,documentId:'new'})
  receive({type:'diagnostic',connectionId:current,documentId:'d1'});expect(messages.at(-1)!.type).toBe('connected')
  channel.send('find-clear');expect(sent.at(-1)).toMatchObject({connectionId:current,documentId:'new'})
  detach();receive({type:'hello'});expect(channel.connected).toBe(false)
  expect(validPreviewOrigin({...preview,origin:host.location.origin},host.location.origin)).toBe(false)
  vi.unstubAllGlobals()
})

it('accepts only bounded diagnostic fields and leaves unavailable details unknown', () => {
  const diagnostic={previewId:'p',generation:'g',kind:'script',message:'Error',resourceUrl:null,line:null,column:null,stack:null,timestamp:new Date().toISOString()}
  expect(parseHtmlPreviewDiagnostic(diagnostic,diagnostic)).toEqual(diagnostic)
  expect(parseHtmlPreviewDiagnostic({...diagnostic,kind:'layout'},diagnostic)).toMatchObject({kind:'layout'})
  expect(parseHtmlPreviewDiagnostic({...diagnostic,status:404},diagnostic)).toMatchObject({status:404})
  for(const patch of [{status:0},{status:'404'},{status:600},{kind:'execute'},{line:0},{line:'2'},{column:-1},{timestamp:'invalid'},{message:'x'.repeat(2001)},{stack:'x'.repeat(8001)},{previewId:'other'},{generation:'old'}]) expect(parseHtmlPreviewDiagnostic({...diagnostic,...patch},diagnostic)).toBeNull()
})


it('binds trusted Web preview initialization and messages to the actual origin, frame and generation', () => {
  vi.stubGlobal('crypto', webcrypto)
  const host = new EventTarget() as EventTarget & { location: { origin: string } }
  host.location = { origin: 'http://localhost:8766' }
  const entryUrl = host.location.origin + '/preview.html#p.g'
  const preview = { previewId: 'p', generation: 'g', origin: host.location.origin, entryUrl, documentUrl: entryUrl, sandboxedDocument: '<h1>Allowed document</h1>' }
  const sent = vi.fn(), frame = { postMessage: sent } as unknown as Window
  const channel = new HtmlPreviewHostChannel(preview, () => frame)
  const detach = channel.attach(host as unknown as Window)
  const receive = (patch = {}, source = frame, origin = host.location.origin): void => {
    const event = new Event('message')
    Object.assign(event, { origin, source, data: { protocol: 'rovai-html-preview-v1', previewId: 'p', generation: 'g', documentId: 'bootstrap', type: 'bootstrap-ready', ...patch } })
    host.dispatchEvent(event)
  }
  receive({}, {} as Window); receive({}, frame, 'null'); receive({}, frame, 'https://elsewhere'); receive({ previewId: 'other' }); receive({ generation: 'old' })
  expect(sent).not.toHaveBeenCalled()
  receive()
  expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'initialize', html: preview.sandboxedDocument }), host.location.origin)
  receive(); expect(sent).toHaveBeenCalledTimes(1) // Author scripts cannot request repeated copies of the whole document.
  channel.connect()
  expect(sent.mock.calls.at(-1)![1]).toBe(host.location.origin)
  const challenge = sent.mock.calls.at(-1)![0].connectionId
  receive({ type: 'connected', documentId: 'loaded', connectionId: 'old' }); expect(channel.connected).toBe(false)
  receive({ type: 'connected', documentId: 'loaded', connectionId: challenge }); expect(channel.connected).toBe(true)
  channel.send('find-clear')
  expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'find-clear', documentId: 'loaded', connectionId: challenge }), host.location.origin)
  for (const patch of [{ origin: 'null' }, { origin: 'https://elsewhere' }, { entryUrl: host.location.origin + '/index.html' }, { entryUrl: 'https://elsewhere/preview.html#p.g' }, { documentUrl: 'about:blank' }, { sandboxedDocument: undefined }]) {
    expect(validPreviewOrigin({ ...preview, ...patch }, host.location.origin)).toBe(false)
  }
  detach(); vi.unstubAllGlobals()
})
