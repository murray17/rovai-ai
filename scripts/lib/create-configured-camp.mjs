export async function createConfiguredCampAndSend(request, input) {
  const preflight = await request('camps.creationPreflight')
  if (!preflight.admissible || !preflight.initialLeadAgentProfileId) {
    throw new Error(`Camp creation preflight failed: ${JSON.stringify(preflight)}`)
  }

  const memberAgentProfileIds = input.memberAgentProfileIds
    ?? preflight.presentMembers.map((member) => member.agentProfileId)
  const defaultLeadAgentProfileId = input.defaultLeadAgentProfileId
    ?? preflight.initialLeadAgentProfileId
  const createResult = await request('camps.create', {
    commandId: `${input.commandId}:camp`,
    name: input.name ?? null,
    workspace: input.workspace
      ? { projectPath: input.workspace.projectPath }
      : null,
    memberAgentProfileIds,
    defaultLeadAgentProfileId,
    collaborationMode: 'peer'
  })
  const campId = createResult.payload?.campId
  if (createResult.status !== 'applied' || !campId) {
    throw new Error(`Configured Camp creation failed: ${JSON.stringify(createResult)}`)
  }

  const sent = await request('camp.messages.send', {
    commandId: input.commandId,
    campId,
    body: input.body,
    address: input.address ?? { mode: 'default' },
    replyToCampMessageId: null,
    execution: {
      taskId: null,
      purpose: input.purpose,
      expectedOutput: input.expectedOutput,
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
