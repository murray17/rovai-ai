/** Acceptance-only delivery control. Reads reach the real Host; an unexpected send in a no-send test is recorded and blocked. */
export async function installProjectFileReferenceNetworkControl(browser) {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = window.fetch.bind(window)
    window.fileReferenceNetwork = { rule: null, held: [], released: 0, blockSends: false, sendAttempts: [] }
    window.fetch = async (input, init) => {
      let request
      try { request = JSON.parse(init?.body) } catch {}
      const state = window.fileReferenceNetwork, rule = state.rule
      if (state.blockSends && request?.operation === 'thread.messages.send') {
        state.sendAttempts.push(request.params)
        return new Response(JSON.stringify({ error: { code: 'acceptance_unexpected_send' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      const matches = rule && request?.operation === rule.operation && (!rule.action || request.params?.action === rule.action)
      if (matches) state.rule = null
      const response = await original(input, init)
      if (!matches) return response
      const body = await response.clone().json()
      return new Promise(resolve => state.held.push({ request, body, release() {
        state.released++
        this.released = true
        if (rule.result) {
          const headers = new Headers(response.headers); headers.delete('Content-Length')
          resolve(new Response(JSON.stringify({ ...body, result: rule.result }), { status: response.status, headers }))
        } else resolve(response)
      } }))
    }
  })()` })
}

export async function holdProjectFileRequest(browser, operation, action, result) {
  const before = await browser.evaluate('window.fileReferenceNetwork.held.length')
  await browser.evaluate(`window.fileReferenceNetwork.rule=${JSON.stringify({ operation, action, result })}`)
  return async () => {
    await browser.wait(`window.fileReferenceNetwork.held.length > ${before}`)
    return before
  }
}

export async function releaseProjectFileRequest(browser, index) {
  await browser.evaluate(`window.fileReferenceNetwork.held[${index}].release()`)
  await browser.wait(`window.fileReferenceNetwork.held[${index}].released === true`)
}
