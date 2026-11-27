import { describe, expect, it } from 'vitest'
import type { SkillDeliveryGroupView, SkillView } from '@contracts'
import { availableComposerSkillsForLead } from './composer-skill-picker'

function skill(
  name: string,
  overrides: Partial<SkillView> = {}
): SkillView {
  const id = `skill-${name}`
  const revisionId = `revision-${name}`
  return {
    id,
    name,
    origin: 'official',
    managementPolicy: 'user_managed',
    enabled: true,
    lifecycleStatus: 'active',
    currentRevision: {
      id: revisionId,
      skillId: id,
      revision: 1,
      name,
      description: `${name} description`,
      sourceType: 'bundled',
      contentDigest: `sha256:${name}`,
      sourceMetadata: {},
      riskSummary: {
        executableFileCount: 0,
        scriptFileCount: 0,
        binaryCandidateCount: 0,
        declaredTools: []
      },
      fileCount: 1,
      totalBytes: 100,
      installedAt: '2026-08-11T00:00:00Z'
    },
    groupAssignments: [{
      groupKey: 'codex',
      revisionId,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z'
    }],
    version: 1,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    deletionRequestedAt: null,
    ...overrides
  }
}

const groups: SkillDeliveryGroupView[] = [{
  key: 'codex',
  label: 'Codex',
  relativePath: '.codex/skills',
  adapterKinds: ['codex-cli'],
  verification: 'verified',
  members: [{
    agentId: 'lead-agent',
    displayName: 'Lead',
    avatarRef: null,
    accent: null
  }]
}, {
  key: 'opencode',
  label: 'OpenCode',
  relativePath: '.config/opencode/skills',
  adapterKinds: ['opencode-cli'],
  verification: 'verified',
  members: []
}]

describe('Composer Skill picker catalog', () => {
  it('only exposes active current-revision Skills delivered to the current Lead group', () => {
    const available = skill('available')
    const disabled = skill('disabled', { enabled: false })
    const deleting = skill('deleting', { lifecycleStatus: 'deleting' })
    const otherGroup = skill('other-group')
    otherGroup.groupAssignments = [{
      ...otherGroup.groupAssignments[0],
      groupKey: 'opencode'
    }]
    const staleRevision = skill('stale-revision')
    staleRevision.groupAssignments = [{
      ...staleRevision.groupAssignments[0],
      revisionId: 'revision-before-current'
    }]

    expect(availableComposerSkillsForLead(
      [available, disabled, deleting, otherGroup, staleRevision],
      groups,
      'lead-agent'
    )).toEqual([{
      id: available.id,
      name: 'available',
      description: 'available description',
      origin: 'official'
    }])
  })

  it('returns no candidates without an exact current Lead identity', () => {
    expect(availableComposerSkillsForLead([skill('available')], groups, null)).toEqual([])
    expect(availableComposerSkillsForLead([skill('available')], groups, 'other-agent')).toEqual([])
  })
})

describe('independent Chat skill candidates', () => {
  it('offers the toolbox for one-off selection and only user skills from the selected Runtime', async () => {
    const calls: unknown[] = []
    const client = { request: async (method: string, params?: Record<string, unknown>) => {
      calls.push([method,params])
      if (method === 'toolbox.list') return [{name:'review-duo',description:'Review',memberIds:[],sourceError:null}]
      const native = (name:string, scope:string, runtime:string) => ({
        id: 'native:'+name,name,sourceScope:scope,adapterKind:runtime,entryPath:'/fixture/'+name+'/SKILL.md',description:name
      })
      return {skills:[native('mine','user','codex-cli'),native('project-only','project','codex-cli'),
        native('another-runtime','user','hermes-cli')],diagnostics:[]}
    }} as import('./camp-client').ThreadClient
    const { chatSkillOptions } = await import('./useChatSkills')
    const catalog = await chatSkillOptions(client,'codex-cli',false)
    expect(catalog.skills.map(item => item.id)).toEqual(['rovai:review-duo','native:mine'])
    expect(calls).toEqual([['toolbox.list',undefined],['nativeSkills.list',{adapterKind:'codex-cli',refresh:false}]])
    calls.length = 0
    expect((await chatSkillOptions(client,null,false)).skills.map(item => item.id)).toEqual(['rovai:review-duo'])
    expect(calls).toEqual([['toolbox.list',undefined]])
  })
})

it('moves a queued selection back to its original position next to identical typed text', async () => {
  const {chatInputFromDocument,chatDocumentFromInput} = await import('./chat-draft')
  const document = {version:2,segments:[
    {kind:'text',text:'🌿 /review-duo 在这里只是文字。用 '},
    {kind:'atom',atom:{type:'skill',skillId:'rovai:review-duo',nameAtSend:'review-duo'}},
    {kind:'text',text:' 评审'}
  ]} satisfies import('@contracts').ComposerDocument
  const input = chatInputFromDocument(document)
  expect(chatDocumentFromInput(input.body,input.skills)).toEqual(document)
})
