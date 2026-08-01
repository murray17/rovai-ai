export async function configureProductRuntime(request, adapterKind, agentProfileIds) {
  for (const agentProfileId of agentProfileIds) {
    let resolved = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const profile = await request('agents.get', { agentProfileId })
      const configured = await request('agents.runtime.set', {
        commandId: crypto.randomUUID(),
        command: {
          agentProfileId,
          expectedVersion: profile.version,
          adapterKind
        }
      })
      if (configured.status !== 'applied') {
        throw new Error(`Product Runtime was not selected: ${JSON.stringify({
          adapterKind,
          agentProfileId,
          configured
        })}`)
      }
      resolved = await request('agents.get', { agentProfileId })
      if (resolved.runtimeSelection?.adapterKind === adapterKind
          && resolved.runtimeReadiness?.status === 'ready') {
        break
      }
      await request('runtime.product.check', { runtimeKind: adapterKind })
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    if (resolved.runtimeSelection?.adapterKind !== adapterKind
        || resolved.runtimeReadiness?.status !== 'ready') {
      throw new Error(`Product Runtime was not resolved: ${JSON.stringify(resolved)}`)
    }
  }

  const installation = (await request('runtime.installations.list')).find((candidate) =>
    candidate.adapterKind === adapterKind
      && candidate.installationClass === 'managed_default'
      && candidate.authScope === 'default'
  )
  if (installation?.snapshot?.probeStatus !== 'ready') {
    throw new Error(`Managed Product Runtime is not ready: ${JSON.stringify({
      adapterKind,
      installation
    })}`)
  }
  return installation
}
