import { describe, expect, it } from 'vitest'
import {
  parseOpenFilePreviewRequest,
  parseRestoreFilePreviewRequest,
  parseRetentionState
} from './file-preview-ipc-input'

const missionAttachmentRequest = {
  kind: 'attachment' as const,
  campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
  locator: {
    owner: 'mission' as const,
    campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
    missionId: 'rvm_01m2wq5xn6eg8ama698dbgwyk8',
    attachmentRefId: '8b85752a-76a5-4b9d-92d8-a70b6285a0d0'
  }
}

describe('parseOpenFilePreviewRequest', () => {
  it('accepts a Mission attachment locator', () => {
    expect(parseOpenFilePreviewRequest(missionAttachmentRequest)).toEqual(missionAttachmentRequest)
  })

  it('accepts only the Skill entry file for a Skill reference', () => {
    const request = { kind: 'skill_reference', campId: missionAttachmentRequest.campId, skillId: 'native:abc', rawReference: 'SKILL.md' }
    expect(parseOpenFilePreviewRequest(request)).toEqual(request)
    expect(() => parseOpenFilePreviewRequest({ ...request, rawReference: '../private.txt' })).toThrow('Unsupported Skill entry')
  })
})

describe('parseRestoreFilePreviewRequest', () => {
  it.each([
    {
      kind: 'message_reference',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      messageId: 'message-1',
      rawReference: 'docs/README.md'
    },
    {
      kind: 'skill_reference',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      skillId: 'native:abc',
      rawReference: 'SKILL.md'
    },
    {
      kind: 'camp_workspace',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      rawReference: 'README.md'
    },
    {
      kind: 'attachment',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      locator: {
        owner: 'message',
        campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
        messageId: 'message-1',
        attachmentRefId: '8b85752a-76a5-4b9d-92d8-a70b6285a0d0'
      }
    },
    missionAttachmentRequest,
    {
      kind: 'run_evidence',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      agentRunId: 'run-1',
      executionEpoch: 1,
      evidenceFileId: 'file-1',
      action: 'open_current'
    },
    {
      kind: 'run_activity_file',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      agentRunId: 'run-1',
      executionEpoch: 1,
      evidenceId: 'evidence-1',
      rawReference: 'src/generated.ts'
    }
  ])('accepts a revalidatable $kind source', (request) => {
    expect(parseRestoreFilePreviewRequest(request)).toEqual(request)
  })

  it.each([
    {
      kind: 'child_of_handle',
      parentHandleId: 'handle-1',
      rawReference: 'child.md'
    },
    {
      kind: 'authorized_root',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      rootGrantId: 'grant-1',
      rawReference: 'child.md'
    }
  ])('rejects transient $kind capabilities', (request) => {
    expect(() => parseRestoreFilePreviewRequest(request)).toThrow(
      'Unsupported file preview restore source'
    )
  })
})


it('rejects unbounded or malformed retention hints before reaching the window ledger', () => {
  const session = { campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3', previewSessionId: 'session' }
  const handle = { handleId: 'handle', previewSessionId: 'session', tabId: 'tab', lastUsed: 1, visible: true, busy: false, recoverable: true }
  expect(parseRetentionState({ sessions: [session], handles: [handle] })).toEqual({ sessions: [session], handles: [handle] })
  expect(() => parseRetentionState({ sessions: Array(25).fill(session), handles: [] })).toThrow()
  expect(() => parseRetentionState({ sessions: [session], handles: [{ ...handle, lastUsed: Infinity }] })).toThrow()
  expect(() => parseRetentionState({ sessions: [session], handles: [{ ...handle, visible: 'false' }] })).toThrow()
})
