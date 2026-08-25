export interface ProjectAccessRestoreOperations<Snapshot> {
  persistRestoredPreference: () => Promise<Snapshot>
  activateExecutionRoot: () => Promise<void>
  suspendExecutionRoot: () => Promise<void>
  persistRemovedPreference: () => Promise<Snapshot>
  publishRemovedRoots: (snapshot: Snapshot) => void
}

export async function restoreProjectAccessFailClosed<Snapshot>({
  persistRestoredPreference,
  activateExecutionRoot,
  suspendExecutionRoot,
  persistRemovedPreference,
  publishRemovedRoots
}: ProjectAccessRestoreOperations<Snapshot>): Promise<Snapshot> {
  const restoredSnapshot = await persistRestoredPreference()
  try {
    await activateExecutionRoot()
  } catch (activationError) {
    const rollbackErrors: unknown[] = []
    try {
      await suspendExecutionRoot()
    } catch (error) {
      rollbackErrors.push(error)
    }

    let removedSnapshot: Snapshot | null = null
    try {
      removedSnapshot = await persistRemovedPreference()
    } catch (error) {
      rollbackErrors.push(error)
    }
    if (removedSnapshot) publishRemovedRoots(removedSnapshot)

    if (rollbackErrors.length === 0) throw activationError
    throw new AggregateError(
      [activationError, ...rollbackErrors],
      `Project access activation failed and rollback was incomplete: ${errorMessage(activationError)}`
    )
  }

  publishRemovedRoots(restoredSnapshot)
  return restoredSnapshot
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
