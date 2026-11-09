import { join } from 'node:path'

export function isolatedKiloEnvironment(root) {
  const environment = Object.fromEntries(
    ['PATH', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot', 'COMSPEC', 'PATHEXT']
      .filter(key => process.env[key])
      .map(key => [key, process.env[key]])
  )
  return { ...environment, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state') }
}
