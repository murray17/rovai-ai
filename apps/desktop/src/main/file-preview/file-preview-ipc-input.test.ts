import { describe, expect, it } from 'vitest'
import { parseRestoreFilePreviewRequest } from './file-preview-ipc-input'

describe('parseRestoreFilePreviewRequest', () => {
  it.each([
    {
      kind: 'message_reference',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      messageId: 'message-1',
      rawReference: 'docs/README.md'
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
    {
      kind: 'run_evidence',
      campId: 'rvcamp_01m1s4cranehs9cdc9r7ayj5d3',
      agentRunId: 'run-1',
      executionEpoch: 1,
      evidenceFileId: 'file-1',
      action: 'open_current'
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
