import assert from 'node:assert/strict'
import test from 'node:test'
import { requestNormalApplicationQuit } from './planned-shutdown-app-quit.mjs'

test('planned shutdown requests a normal Windows Browser close without macOS automation', async () => {
  const calls = []
  await requestNormalApplicationQuit({
    platform: 'win32',
    app: {
      child: { pid: 42 },
      cdp: { send: async (method) => calls.push(['cdp', method]) }
    },
    runProcess: async (...args) => calls.push(['process', ...args]),
    wait: async () => undefined
  })

  assert.deepEqual(calls, [['cdp', 'Browser.close']])
})

test('planned shutdown accepts the expected CDP close race on Windows', async () => {
  await requestNormalApplicationQuit({
    platform: 'win32',
    app: {
      child: { pid: 42 },
      cdp: { send: async () => { throw new Error('CDP connection closed') } }
    },
    runProcess: async () => assert.fail('Windows must not invoke macOS automation'),
    wait: async () => undefined
  })
})

test('planned shutdown retains the native macOS termination request', async () => {
  const calls = []
  await requestNormalApplicationQuit({
    platform: 'darwin',
    app: { child: { pid: 73 }, cdp: { send: async () => assert.fail('macOS uses AppKit') } },
    runProcess: async (...args) => calls.push(args)
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/usr/bin/osascript')
  assert.deepEqual(calls[0][1].slice(0, 3), ['-l', 'JavaScript', '-e'])
  assert.match(calls[0][1][3], /73/)
})
