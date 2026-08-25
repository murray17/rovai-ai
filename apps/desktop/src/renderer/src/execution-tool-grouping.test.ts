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
      primary: '等待审批',
      currentTitle: '指令 three',
      countLabel: '1 项已完成',
      countTone: 'neutral',
      accessibleLabel: '等待审批：指令 three；1 项已完成'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'failed'),
      tool('two', 'running')
    ], 'running')).toMatchObject({
      status: 'running',
      countLabel: '1 项失败',
      countTone: 'danger'
    })
  })

  it('summarizes failure, stop and not-executed outcomes without calling them successful', () => {
    expect(toolActivityGroupPresentation([
      tool('one'),
      tool('two', 'failed'),
      tool('three', 'stopped')
    ], 'failed')).toMatchObject({
      status: 'failed',
      primary: '已执行 3 项操作',
      countLabel: '1 项失败 · 1 项已停止'
    })

    expect(toolActivityGroupPresentation([
      tool('one', 'recorded')
    ], 'succeeded')).toMatchObject({
      status: 'recorded',
      primary: '已汇总 1 项操作',
      countLabel: '1 项仅记录'
    })
  })

  it('does not keep an unfinished Tool active after its parent Run is cancelled', () => {
    const items = [tool('one', 'running')]
    expect(toolActivityGroupHasActiveTool(items, 'running')).toBe(true)
    expect(toolActivityGroupHasActiveTool(items, 'cancelled')).toBe(false)
    expect(toolActivityGroupPresentation(items, 'cancelled')).toMatchObject({
      status: 'stopped',
      countLabel: '1 项已停止'
    })
  })
})
