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

  it('shows the last active Tool and keeps the settled count in the running summary', () => {
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
      countLabel: '已执行 1 项操作',
      accessibleLabel: '等待审批：指令 three；已执行 1 项操作'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'failed'),
      tool('two', 'running')
    ], 'running')).toMatchObject({
      status: 'running',
      statusLabel: '执行中',
      countLabel: '已执行 1 项操作'
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
      countLabel: '已执行 4 项操作',
      accessibleLabel: '执行中：指令 five；已执行 4 项操作'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'recorded'),
      tool('two', 'running')
    ], 'running')).toMatchObject({
      countLabel: '已汇总 1 项操作',
      accessibleLabel: '执行中：指令 two；已汇总 1 项操作'
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
    expect(toolActivityGroupPresentation(items, 'cancelled')).toMatchObject({
      status: 'stopped',
      statusLabel: '已停止',
      countLabel: null
    })
  })
})
