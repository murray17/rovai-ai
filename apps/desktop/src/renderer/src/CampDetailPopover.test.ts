import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CampDetailEntries, CampDetailPopover, type RunningCampMember } from './CampDetailPopover'
import { MobileLayoutProvider } from './MobileLayout'

const source = readFileSync(new URL('./CampDetailPopover.tsx', import.meta.url), 'utf8')

describe('Camp detail popover dismissal', () => {
  it('stays open when pointer or focus moves outside', () => {
    expect(source).not.toContain("addEventListener('pointerdown'")
    expect(source).not.toContain("addEventListener('focusin'")
  })

  it('keeps Escape and the explicit close control available', () => {
    expect(source).toContain("addEventListener('keydown', dismissOnEscape)")

    const markup = renderToStaticMarkup(createElement(CampDetailPopover, {
      activeTab: 'tasks',
      visible: true,
      showExecution: true,
      runningMembers: [],
      executionCount: 2,
      taskCount: 2,
      memberCount: 3,
      onOpen: () => undefined,
      onClose: () => undefined,
      children: createElement('div', null, '详情')
    }))

    expect(markup).toContain('aria-label="收起会话详情"')
    expect(markup).toContain('<kbd>Esc</kbd> 收起')
  })
})

describe('Camp execution entry', () => {
  const members: RunningCampMember[] = ['叮叮', '咕咕', '小兔', '小鹿', '小熊'].map((displayName, index) => ({
    agentId: `agent-${index}`, displayName, avatarRef: null
  }))
  const render = (count: number, visible = false): string => renderToStaticMarkup(createElement(CampDetailEntries, {
    activeTab: 'execution', visible, panelId: 'details', showExecution: true,
    runningMembers: members.slice(0, count), executionCount: 2, taskCount: 4, memberCount: members.length,
    onSelect: () => undefined
  })).split('</button>')[0]

  it.each([1, 2, 3, 5])('shows at most three stationary member avatars for %i running members even when collapsed', count => {
    const markup = render(count)
    expect(markup.match(/class="member-avatar"/g)).toHaveLength(Math.min(count, 3))
    expect(markup).toContain(`执行，${count} 位队员正在执行：${members.slice(0, count).map(member => member.displayName).join('、')}`)
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('camp-loading-spinner')
    expect(markup).not.toContain('<small>')
    expect(markup.match(/pathLength="100"/g)).toHaveLength(2)
    expect(markup.includes('camp-execution-overflow')).toBe(count > 3)
    if (count > 3) expect(markup).toContain(`+${count - 3}</span>`)
  })

  it('restores the executed-member count when execution is idle while keeping history available', () => {
    const markup = render(0, true)
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('执行，共 2 位队员有执行记录，当前没有队员正在执行')
    expect(markup).toContain('<span class="camp-detail-entry-copy"><span>执行</span><small>2</small></span>')
    expect(markup).not.toContain('camp-execution-members')
    expect(markup).not.toContain('camp-execution-orbits')
    expect(markup).not.toContain('disabled')
  })

  it.each([0, 1, 2, 3, 5])('limits the phone execution entry to two avatars for %i running members', count => {
    const markup = renderToStaticMarkup(createElement(MobileLayoutProvider, { value: true, children:
      createElement(CampDetailPopover, {
        activeTab: 'execution', visible: false, showExecution: true, runningMembers: members.slice(0, count),
        executionCount: 2, taskCount: 4, memberCount: 5,
        onOpen: () => undefined, onClose: () => undefined, children: null
      })
    }))
    const entry = markup.split('data-detail="execution"')[1].split('</button>')[0]
    expect(entry.match(/class="member-avatar"/g) ?? []).toHaveLength(Math.min(count, 2))
    expect(entry.match(/pathLength="100"/g) ?? []).toHaveLength(count ? 2 : 0)
    expect(entry).not.toContain('<small>')
    if (count > 2) expect(entry).toContain(`+${count - 2}</span>`)
    expect(markup).toContain('aria-label="会话更多操作"')
    expect(markup).not.toContain('mobile-camp-members')
  })
})
