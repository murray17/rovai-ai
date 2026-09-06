import { expect, it } from 'vitest'
import type { AgentRunChangedFileDetailView } from '@contracts'
import { fileChangeFindLines } from './file-find-changes'

const file: AgentRunChangedFileDetailView = {
  evidenceFileId: 'history-1', path: 'src/a.ts', changeKind: 'update', presentationKind: 'full_net_diff', operationCount: 1,
  blocks: [{ sequence: 1, semantics: 'full_net_diff', changeKind: 'update', diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n context\n-before\n+after\n\\ No newline at end of file' }]
}
it('indexes evidence body without paths, hunk headers, signs or invented current-file text', () => {
  expect(fileChangeFindLines(file).map(line => [line.text, line.kind])).toEqual([
    ['context', 'context'], ['before', 'deletion'], ['after', 'addition']
  ])
  expect(fileChangeFindLines({ ...file, presentationKind: 'operation_only' })).toEqual([])
})
it('keeps exact mutation block order and stable file-local coordinates', () => {
  const lines = fileChangeFindLines({ ...file, presentationKind: 'exact_mutations', blocks: [
    { sequence: 2, semantics: 'exact_mutation', changeKind: 'update', diff: '-old two\n+new two' },
    { sequence: 1, semantics: 'operation_only', changeKind: 'update' },
    { sequence: 0, semantics: 'exact_mutation', changeKind: 'update', diff: '-old one\n+new one' }
  ] })
  expect(lines.map(line => line.text)).toEqual(['old one', 'new one', 'old two', 'new two'])
  expect(lines.map(line => line.id)).toEqual(['history-1:0:0', 'history-1:0:1', 'history-1:1:0', 'history-1:1:1'])
})
