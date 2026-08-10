export function applyPatchPlan(tree, operations) {
  const original = cloneTree(tree)
  if (!Array.isArray(operations)) return { committed: false, tree: original, error: 'operations must be an array' }
  const seen = new Set()
  for (const operation of operations) {
    if (!operation || !['set', 'delete'].includes(operation.type)) {
      return { committed: false, tree: original, error: 'unsupported operation' }
    }
    if (!safePath(operation.path) || seen.has(operation.path)) {
      return { committed: false, tree: original, error: 'invalid or duplicate path' }
    }
    if (operation.type === 'set' && typeof operation.content !== 'string') {
      return { committed: false, tree: original, error: 'set content must be a string' }
    }
    seen.add(operation.path)
  }
  const next = { ...original }
  for (const operation of operations) {
    if (operation.type === 'set') next[operation.path] = operation.content
    else delete next[operation.path]
  }
  return { committed: true, tree: Object.fromEntries(Object.entries(next).sort(([left], [right]) => left.localeCompare(right))), error: null }
}

function safePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.split('/').some((part) => part === '..' || part === '')
}

function cloneTree(tree) {
  return tree && typeof tree === 'object' && !Array.isArray(tree) ? { ...tree } : {}
}
