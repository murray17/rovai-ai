import assert from 'node:assert/strict'
import test from 'node:test'
import { createEvidenceCamp } from './camp-import.mjs'
import { parseProtocolProjectArguments } from './project-pipeline.mjs'

test('Camp import uses a user-authored message with execution null and rejects generated execution', async () => {
  const calls = []
  const core = {
    async request(method, params) {
      calls.push({ method, params })
      if (method === 'camps.create') return { status: 'applied', payload: { campId: 'camp-1' } }
      if (method === 'camp.composerDraft.get') return { revision: 0 }
      if (method === 'camp.composerDraft.save') return { revision: 1 }
      if (method === 'camp.messages.send') return { commandResult: { status: 'applied' } }
      if (method === 'camps.snapshot') return {
        camp: { title: 'Review' }, messages: [{}], turns: [], agentRuns: []
      }
      throw new Error(`unexpected ${method}`)
    }
  }
  const result = await createEvidenceCamp({
    core,
    commandPrefix: 'fixture',
    name: 'Review',
    body: 'review',
    projectPath: '/tmp/project',
    members: ['agent_1'],
    defaultLead: 'agent_1'
  })
  assert.equal(result.campId, 'camp-1')
  const send = calls.find((entry) => entry.method === 'camp.messages.send')
  assert.equal(send.params.execution, null)
  assert.equal(calls.some((entry) => entry.method === 'agent.message.send'), false)
})

test('Protocol project defaults to a single Review Camp and only enables trial Camps explicitly', () => {
  const options = parseProtocolProjectArguments(['--run', 'run.json', '--project-path', 'project', '--no-import'])
  assert.equal(options.legacyTrialCamps, false)
})
