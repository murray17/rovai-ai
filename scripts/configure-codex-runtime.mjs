export async function configureCodexRuntime(request, health, agentProfileIds, options = {}) {
  const executablePath = health.codex?.executablePath
  if (!executablePath) throw new Error(`Codex health did not report an executable: ${JSON.stringify(health.codex)}`)

  let installations = await request('runtime.installations.list')
  let installation = installations.find((candidate) =>
    candidate.adapterKind === 'codex-cli'
      && candidate.executablePath === executablePath
      && candidate.authScope === 'local-user'
  )
  if (!installation) {
    const created = await request('runtime.installations.create', {
      commandId: crypto.randomUUID(),
      command: {
        adapterKind: 'codex-cli',
        executablePath,
        source: 'discovered',
        authScope: 'local-user'
      }
    })
    if (created.status !== 'applied') {
      throw new Error(`Codex installation was not created: ${JSON.stringify(created)}`)
    }
    installation = { id: created.resultEntity.entityId }
  }
  const refreshed = await request('runtime.installations.refresh', {
    commandId: crypto.randomUUID(),
    installationId: installation.id
  })
  if (refreshed.status !== 'applied') {
    throw new Error(`Codex installation was not refreshed: ${JSON.stringify(refreshed)}`)
  }
  installations = await request('runtime.installations.list')
  installation = installations.find((candidate) => candidate.id === installation.id)
  if (installation?.snapshot?.probeStatus !== 'ready') {
    throw new Error(`Codex installation is not ready: ${JSON.stringify(installation)}`)
  }

  const defaultModel = installation.snapshot.models.find((model) =>
    model.isDefault && !model.hidden && !model.deprecated
  )
  if (!defaultModel) throw new Error('Codex model/list returned no available default model')
  const explicitIds = new Set(options.explicitAgentProfileIds ?? [])
  for (const agentProfileId of agentProfileIds) {
    const profile = await request('agents.get', { agentProfileId })
    const model = explicitIds.has(agentProfileId)
      ? {
          mode: 'explicit',
          modelId: defaultModel.id,
          options: Object.fromEntries(defaultModel.options
            .filter((option) => option.defaultValue !== null)
            .map((option) => [option.key, option.defaultValue]))
        }
      : { mode: 'runtime_default' }
    const configured = await request('agents.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentProfileId,
        expectedVersion: profile.version,
        runtime: {
          installationId: installation.id,
          model,
          permissions: {
            adapterKind: 'codex-cli',
            schemaVersion: installation.snapshot.permissionSchemaVersion,
            values: {
              sandbox_mode: 'workspace-write',
              approval_policy: 'on-request'
            }
          }
        }
      }
    })
    if (configured.status !== 'applied') {
      throw new Error(`Agent Runtime was not configured: ${JSON.stringify({ agentProfileId, configured })}`)
    }
  }
  return installation
}
