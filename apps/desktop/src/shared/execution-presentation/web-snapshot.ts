import type { ActivityIconKind, ActivityStatus } from './index'

export type PublicExecutionRunStatus =
  | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

export type PublicExecutionActivity = {
  iconKind: ActivityIconKind
  title: string
  status: ActivityStatus
  statusLabel: string
  result: string | null
  files: Array<{ path: string; additions: number | null; deletions: number | null }>
}

export type PublicExecutionItem =
  | { kind: 'narration'; body: string }
  | {
    kind: 'activityGroup'
    status: ActivityStatus
    statusLabel: string
    primary: string
    currentTitle: string | null
    accessibleLabel: string
    activities: PublicExecutionActivity[]
  }

export type PublicExecutionRun = {
  id: string
  status: PublicExecutionRunStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  purpose: string
  trigger: {
    authorKind: 'user' | 'agent'
    summary: string
    authorDisplayName: string
    channelLabel: string
    createdAt: string
  }
  items: PublicExecutionItem[]
}

export type PublicExecutionSnapshot = {
  schemaVersion: 1
  focusRunId: string
  terminal: boolean
  thread: { id: string; title: string }
  agent: { id: string; displayName: string }
  runs: PublicExecutionRun[]
}
