import { describe, expect, it } from 'vitest'
import type { ExecutionProgressItem } from './ui-model'
import {
  groupConsecutiveToolItems,
  toolActivityGroupHasActiveTool,
  toolActivityGroupPresentation,
  type ToolProgressItem
} from './execution-tool-grouping'

function tool(
  id: string,
  status: ToolProgressItem['step']['status'] = 'completed'
): ToolProgressItem {
  return {
    key: `tool:${id}`,
    kind: 'tool',
    step: {
      id,
      title: `指令 ${id}`,
      publicCommand: null,
      detail: `结果 ${id}`,
      status,
      activityDomain: 'shell',
      toolName: null,
      credibility: 'runtime_structured'
    }
  }
}

describe('execution Tool grouping', () => {
  it('groups only maximal consecutive Tool items and keeps a stable first-item key', () => {
    const items: ExecutionProgressItem[] = [
      tool('one'),
      tool('two'),
      { key: 'narration:one', kind: 'narration', body: '检查完成。' },
      tool('three'),
      {
        key: 'plan',
        kind: 'plan',
        explanation: '下一步',
        plan: [{ step: '验证', status: 'inProgress' }]
      },
      tool('four'),
      tool('five')
    ]

    const grouped = groupConsecutiveToolItems(items)
    expect(grouped.map((item) => item.kind)).toEqual([
      'toolGroup', 'narration', 'toolGroup', 'plan', 'toolGroup'
    ])
    expect(grouped[0]).toMatchObject({
      key: 'tool-group:tool:one',
      items: [{ step: { id: 'one' } }, { step: { id: 'two' } }]
    })
    expect(groupConsecutiveToolItems([tool('one')])[0].key).toBe(grouped[0].key)
  })

  it('keeps FileChange Activities inside the Tool group without counting presentation rows as operations', () => {
    const fileChange = tool('files')
    fileChange.step.fileChanges = [{
      path: 'src/app.ts',
      changeKind: 'update',
      additions: 2,
      deletions: 1,
      diff: '@@ -1 +1,2 @@\n-old\n+new\n+next\n'
    }, {
      path: 'src/styles.css',
      changeKind: 'update',
      additions: 1,
      deletions: 1,
      diff: '@@ -1 +1 @@\n-red\n+green\n'
    }]

    const grouped = groupConsecutiveToolItems([fileChange, tool('verify')])

    expect(grouped).toMatchObject([{
      kind: 'toolGroup',
      items: [
        { step: { id: 'files', fileChanges: [{ path: 'src/app.ts' }, { path: 'src/styles.css' }] } },
        { step: { id: 'verify' } }
      ]
    }])
    expect(toolActivityGroupPresentation(
      grouped[0].kind === 'toolGroup' ? grouped[0].items : [],
      'succeeded'
    )).toMatchObject({
      primary: '已执行 2 项操作',
      accessibleLabel: '已执行 2 项操作；状态：全部成功'
    })
  })

  it('shows only the last active Tool while an operation is in progress', () => {
    const presentation = toolActivityGroupPresentation([
      tool('one'),
      tool('two', 'running'),
      tool('three', 'waiting')
    ], 'waiting')

    expect(presentation).toEqual({
      status: 'waiting',
      statusLabel: '等待审批',
      primary: '等待审批',
      currentTitle: '指令 three',
      countLabel: null,
      accessibleLabel: '等待审批：指令 three'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'failed'),
      tool('two', 'running')
    ], 'running')).toMatchObject({
      status: 'running',
      statusLabel: '执行中',
      countLabel: null
    })

    expect(toolActivityGroupPresentation([
      tool('one'),
      tool('two'),
      tool('three'),
      tool('four', 'failed'),
      tool('five', 'running')
    ], 'running')).toMatchObject({
      primary: '执行中',
      currentTitle: '指令 five',
      countLabel: null,
      accessibleLabel: '执行中：指令 five'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'recorded'),
      tool('two', 'running')
    ], 'running')).toMatchObject({
      countLabel: null,
      accessibleLabel: '执行中：指令 two'
    })
  })

  it('uses a successful group result when any Tool succeeded and omits terminal outcome copy', () => {
    expect(toolActivityGroupPresentation([
      tool('one'),
      tool('two', 'failed'),
      tool('three', 'stopped')
    ], 'failed')).toMatchObject({
      status: 'completed',
      statusLabel: '含成功操作',
      primary: '已执行 3 项操作',
      countLabel: null,
      accessibleLabel: '已执行 3 项操作；状态：含成功操作'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'recorded')
    ], 'succeeded')).toMatchObject({
      status: 'recorded',
      statusLabel: '已记录',
      primary: '已汇总 1 项操作',
      countLabel: null
    })
  })

  it('keeps a settled trailing Tool group active until the running Run reaches a real boundary', () => {
    expect(toolActivityGroupPresentation([
      tool('one'),
      tool('two', 'failed'),
      tool('three')
    ], 'running', true)).toEqual({
      status: 'running',
      statusLabel: '执行中',
      primary: '执行中',
      currentTitle: '指令 three',
      countLabel: null,
      accessibleLabel: '执行中：指令 three'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'recorded')
    ], 'running', true)).toMatchObject({
      status: 'running',
      primary: '执行中',
      currentTitle: '指令 one',
      countLabel: null,
      accessibleLabel: '执行中：指令 one'
    })

    expect(toolActivityGroupPresentation([
      tool('one')
    ], 'succeeded', true)).toMatchObject({
      status: 'completed',
      primary: '已执行 1 项操作',
      countLabel: null
    })
  })

  it('uses danger only when every Tool failed and keeps other no-success outcomes neutral', () => {
    expect(toolActivityGroupPresentation([
      tool('one', 'failed'),
      tool('two', 'failed')
    ], 'failed')).toMatchObject({
      status: 'failed',
      statusLabel: '全部失败',
      primary: '已执行 2 项操作',
      countLabel: null
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'failed'),
      tool('two', 'stopped')
    ], 'failed')).toMatchObject({
      status: 'stopped',
      statusLabel: '已停止，含失败操作',
      primary: '已执行 2 项操作',
      countLabel: null
    })
  })

  it('does not keep an unfinished Tool active after its parent Run is cancelled', () => {
    const items = [tool('one', 'running')]
    expect(toolActivityGroupHasActiveTool(items, 'running')).toBe(true)
    expect(toolActivityGroupHasActiveTool(items, 'cancelled')).toBe(false)
    expect(toolActivityGroupPresentation(items, 'cancelled', true)).toMatchObject({
      status: 'stopped',
      statusLabel: '已停止',
      countLabel: null
    })
  })
})
