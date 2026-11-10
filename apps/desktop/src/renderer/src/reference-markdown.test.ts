import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Link, Root, RootContent } from 'mdast'
import cases from '../../../../../packages/contracts/fixtures/reference-link-labels.json'
import { escapeReferenceLinkLabel } from './reference-markdown'
import { projectFileLink } from './project-file-reference'
import { projectReference } from './thread-reference'

const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false })
function links(node: Root | RootContent): Link[] {
  return node.type === 'link' ? [node] : 'children' in node ? node.children.flatMap(child => links(child)) : []
}
describe('literal reference link labels shared with Core', () => {
  it.each(cases)('preserves $label as exactly one link with its original target', ({ label, escaped }) => {
    expect(escapeReferenceLinkLabel(label)).toBe(escaped)
    const projected = [
      [projectReference({ kind: 'thread_reference', threadId: 'rvth_01k5c9m7x2q4r6s8t0v2w4y6z8', titleAtSend: label }), 'rovai://thread/rvth_01k5c9m7x2q4r6s8t0v2w4y6z8'],
      [projectReference({ kind: 'mission_reference', missionId: 'rvm_019f1ca71172772e89ab0b4c104b9a10', titleAtSend: label }), 'rovai://mission/rvm_019f1ca71172772e89ab0b4c104b9a10']
    ]
    if (!label.includes('/')) {
      for (const targetKind of ['file', 'directory'] as const) projected.push([
        projectFileLink({ kind: 'project_file_reference', threadId: 'thread', rawReference: 'identity', pathAtSend: '/project/target', labelAtSend: `deep/${label}`, targetKind }),
        `file:///project/target${targetKind === 'directory' ? '/' : ''}`
      ])
    }
    for (const [markdown, target] of projected) {
      for (const source of [markdown!, ...(label.includes('|') ? [`| reference |\n| --- |\n| ${markdown} |`] : [])]) {
        const result = links(parser.parse(source))
        expect(result).toHaveLength(1)
        expect(result[0]!.url).toBe(target)
        expect(result[0]!.children.every(child => child.type === 'text')).toBe(true)
        expect(result[0]!.children.map(child => child.type === 'text' ? child.value : '').join('')).toBe(label)
      }
    }
  })
})
