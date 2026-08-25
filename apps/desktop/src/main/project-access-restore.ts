export interface ProjectAccessRestoreOperations<Snapshot> {
  previousSnapshot: Snapshot
  restorationRequired: boolean
  persistRestoredPreference: () => Promise<Snapshot>
  activateExecutionRoot: () => Promise<void>
  suspendExecutionRoot: () => Promise<void>
  persistPreviousPreference: () => Promise<Snapshot>
  publishRemovedRoots: (snapshot: Snapshot) => void
}

export async function restoreProjectAccessFailClosed<Snapshot>({
  previousSnapshot,
  restorationRequired,
  persistRestoredPreference,
  activateExecutionRoot,
  suspendExecutionRoot,
  persistPreviousPreference,
  publishRemovedRoots
}: ProjectAccessRestoreOperations<Snapshot>): Promise<Snapshot> {
  if (!restorationRequired) return previousSnapshot

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

    let recoveredSnapshot: Snapshot | null = null
    try {
      recoveredSnapshot = await persistPreviousPreference()
    } catch (error) {
      rollbackErrors.push(error)
    }
    if (recoveredSnapshot) publishRemovedRoots(recoveredSnapshot)

    if (rollbackErrors.length === 0) throw activationError
    throw new AggregateError(
      [activationError, ...rollbackErrors],
      `Project access activation failed and rollback was incomplete: ${errorMessage(activationError)}`
    )
  }

  publishRemovedRoots(restoredSnapshot)
  return restoredSnapshot
}

export class ProjectAccessTransactionCoordinator {
  #tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation)
    this.#tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export function removedProjectRootsFromSnapshot<Snapshot extends {
  removedProjects: ReadonlyArray<{ targetKey: string }>
}>(snapshot: Snapshot): string[] {
  return snapshot.removedProjects
    .filter((project) => project.targetKey.startsWith('directory:'))
    .map((project) => project.targetKey.slice('directory:'.length))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
