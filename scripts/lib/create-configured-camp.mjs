export async function createConfiguredCampAndSend(request, input) {
  const preflight = await request('camps.creationPreflight')
  if (!preflight.admissible || !preflight.initialLeadAgentId) {
    throw new Error(`Camp creation preflight failed: ${JSON.stringify(preflight)}`)
  }

  const memberAgentIds = input.memberAgentIds
    ?? preflight.presentMembers.map((member) => member.agentId)
  const defaultLeadAgentId = input.defaultLeadAgentId
    ?? preflight.initialLeadAgentId
  const createResult = await request('camps.create', {
    commandId: `${input.commandId}:camp`,
    name: input.name ?? null,
    workspace: input.workspace
      ? { projectPath: input.workspace.projectPath }
      : null,
    memberAgentIds,
    defaultLeadAgentId,
    collaborationMode: 'peer'
  })
  const campId = createResult.payload?.campId
  if (createResult.status !== 'applied' || !campId) {
    throw new Error(`Configured Camp creation failed: ${JSON.stringify(createResult)}`)
  }

  const currentDraft = await request('camp.composerDraft.get', { campId })
  const content = composerContent(input.address ?? { mode: 'default' }, input.body)
  const savedDraft = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: currentDraft.revision,
    content
  })
  const sent = await request('camp.messages.send', {
    commandId: input.commandId,
    campId,
    draftRevision: savedDraft.revision,
    replyToCampMessageId: null,
    execution: {
      taskId: null,
      purpose: input.purpose,
      completionRole: 'required'
    }
  })
  if (!sent.commandResult) return sent
  return {
    ...sent.commandResult,
    payload: {
      ...sent.commandResult.payload,
      campId
    }
  }
}

function composerContent(address, body) {
  if (address.mode === 'broadcast') {
    return [{ kind: 'all_members_mention' }, { kind: 'text', text: ` ${body}` }]
  }
  if (address.mode === 'explicit') {
    return [
      ...address.agentIds.flatMap((agentId) => [
        { kind: 'member_mention', agentId },
        { kind: 'text', text: ' ' }
      ]),
      { kind: 'text', text: body }
    ]
  }
  return [{ kind: 'text', text: body }]
}
