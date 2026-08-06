export async function configureProductRuntime(request, adapterKind, agentIds) {
  for (const agentId of agentIds) {
    let resolved = null
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const profile = await request('agents.get', { agentId })
      const configured = await request('agents.runtime.set', {
        commandId: crypto.randomUUID(),
        command: {
          agentId,
          expectedVersion: profile.version,
          adapterKind
        }
      })
      if (configured.status !== 'applied') {
        throw new Error(`Product Runtime was not selected: ${JSON.stringify({
          adapterKind,
          agentId,
          configured
        })}`)
      }
      resolved = await request('agents.get', { agentId })
      if (resolved.runtimeSelection?.adapterKind === adapterKind
          && resolved.runtimeReadiness?.status === 'ready') {
        break
      }
      await request('runtime.product.check', { runtimeKind: adapterKind })
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
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
