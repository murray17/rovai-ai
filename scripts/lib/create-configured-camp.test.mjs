import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composerDocumentForAddress,
  createConfiguredCampAndSend
} from './create-configured-camp.mjs'

test('configured Camp helper sends an explicit recipient as ComposerDocument V2', async () => {
  const calls = []
  const request = async (method, params = {}) => {
    calls.push({ method, params })
    switch (method) {
      case 'threads.creationPreflight':
        return {
          admissible: true,
          initialLeadAgentId: 'agent_2',
          presentMembers: [{ agentId: 'agent_2' }]
        }
      case 'threads.create':
        return { status: 'applied', payload: { threadId: 'camp_test' } }
      case 'thread.messages.send':
        assert.equal(params.commandId, 'command_test')
        assert.equal(params.threadId, 'camp_test')
        assert.deepEqual(params.content, {
          version: 2,
          segments: [
            { kind: 'atom', atom: { type: 'member', agentId: 'agent_2' } },
            { kind: 'text', text: ' Run the acceptance case' }
          ]
        })
        assert.deepEqual(params.sourceAttachments, [])
        assert.deepEqual(params.quotes, [])
        assert.equal(params.replyToThreadMessageId, null)
        return {
          commandResult: {
            status: 'accepted',
            payload: { threadMessageId: 'message_test' }
          }
        }
      default:
        throw new Error(`Unexpected request: ${method}`)
    }
  }

  const result = await createConfiguredCampAndSend(request, {
    commandId: 'command_test',
    body: 'Run the acceptance case',
    address: { mode: 'explicit', agentIds: ['agent_2'] },
    purpose: 'Verify the configured Camp helper'
  })

  assert.equal(result.payload.campId, 'camp_test')
  assert.equal(result.payload.threadId, 'camp_test')
  assert.equal(result.payload.threadMessageId, 'message_test')
  assert.deepEqual(calls.map(({ method }) => method), [
    'threads.creationPreflight',
    'threads.create',
    'thread.messages.send'
  ])
})

test('configured Camp helper emits normalized V2 documents for every address mode', () => {
  assert.deepEqual(
    composerDocumentForAddress({ mode: 'default' }, 'Default body'),
    { version: 2, segments: [{ kind: 'text', text: 'Default body' }] }
  )
  assert.deepEqual(
    composerDocumentForAddress({ mode: 'broadcast' }, 'Broadcast body'),
    {
      version: 2,
      segments: [
        { kind: 'atom', atom: { type: 'all_members' } },
        { kind: 'text', text: ' Broadcast body' }
      ]
    }
  )
  assert.deepEqual(
    composerDocumentForAddress(
      { mode: 'explicit', agentIds: ['agent_2', 'agent_3'] },
      'Explicit body'
    ),
    {
      version: 2,
      segments: [
        { kind: 'atom', atom: { type: 'member', agentId: 'agent_2' } },
        { kind: 'text', text: ' ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent_3' } },
        { kind: 'text', text: ' Explicit body' }
      ]
    }
  )
})
