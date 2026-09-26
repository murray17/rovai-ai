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

  const content = composerDocumentForAddress(input.address ?? { mode: 'default' }, input.body)
  const sent = await request('camp.messages.send', {
    commandId: input.commandId,
    campId,
    content,
    sourceAttachments: [],
    quotes: [],
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

export function composerDocumentForAddress(address, body) {
  if (address.mode === 'broadcast') {
    return {
      version: 2,
      segments: [
        { kind: 'atom', atom: { type: 'all_members' } },
        { kind: 'text', text: ` ${body}` }
      ]
    }
  }
  if (address.mode === 'explicit') {
    return {
      version: 2,
      segments: [
        ...address.agentIds.flatMap((agentId, index) => [
          { kind: 'atom', atom: { type: 'member', agentId } },
          { kind: 'text', text: index === address.agentIds.length - 1 ? ` ${body}` : ' ' }
        ])
      ]
    }
  }
  return { version: 2, segments: [{ kind: 'text', text: body }] }
}
