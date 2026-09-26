import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NotificationPreference } from '@contracts'
import { describe, expect, it } from 'vitest'
import { NotificationPreferenceEditor } from './NotificationSettings'

function preference(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    headsUpEnabled: true,
    approvalHeadsUpEnabled: true,
    userMentionHeadsUpEnabled: true,
    turnCompletedHeadsUpEnabled: true,
    turnIncompleteHeadsUpEnabled: true,
    singleChatHeadsUpEnabled: true, missionNeedsYouHeadsUpEnabled: true,
    missionStatusHeadsUpEnabled: true, taskStatusHeadsUpEnabled: false,
    missionStatuses: ['completed'], taskStatuses: ['completed', 'blocked', 'cancelled'],
    version: 4,
    updatedAt: '2026-08-13T00:00:00Z',
    ...overrides
  }
}

function renderPreferenceEditor(
  value: NotificationPreference,
  overrides: Partial<Parameters<typeof NotificationPreferenceEditor>[0]> = {}
): string {
  return renderToStaticMarkup(createElement(NotificationPreferenceEditor, {
    preference: value,
    savingKey: null,
    saveStatus: 'idle',
    error: null,
    onChange: () => undefined,
    onRetry: () => undefined,
    ...overrides
  }))
}

describe('notification settings', () => {
  it('uses one master switch and groups eight categories by conversation, mission and task', () => {
    const markup = renderPreferenceEditor(preference())

    expect(markup.match(/role="switch"/g)).toHaveLength(9)
    expect(markup).toContain('class="notification-master-panel"')
    for (const [id, title] of [['conversation', '会话'], ['mission', '使命'], ['task', '任务']]) {
      expect(markup).toContain(`id="notification-scenario-${id}">${title}</h3>`)
    }
    expect(markup).toContain('单聊回复')
    expect(markup).toContain('使命需要你')
    expect(markup).toContain('任务状态变更')
    expect(markup).toContain('已完成、受阻、已取消')
    expect(markup).toContain('aria-label="待审批"')
    expect(markup).toContain('aria-label="提到你"')
    expect(markup).toContain('aria-label="本轮完成"')
    expect(markup).toContain('aria-label="执行未完成"')
    expect(markup).not.toContain('普通队员消息')
    expect(markup).not.toContain('持久边界')
  })

  it('preserves category choices while the master switch disables heads-up delivery', () => {
    const markup = renderPreferenceEditor(preference({
      headsUpEnabled: false,
      userMentionHeadsUpEnabled: false
    }))

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('4 / 5 项已保留')
    expect(markup).toContain('2 / 2 项已保留')
    expect(markup.match(/disabled=""/g)).toHaveLength(10)
    expect(markup).not.toContain('关闭主开关时会保留四类选择')
  })

  it('keeps the active preference focusable while exposing save and recovery states', () => {
    const savingMarkup = renderPreferenceEditor(preference(), {
      savingKey: 'userMentionHeadsUpEnabled'
    })
    const failedMarkup = renderPreferenceEditor(preference(), {
      error: '保存失败，已恢复之前的设置。'
    })

    expect(savingMarkup).toContain('保存中…')
    const activeInput = savingMarkup.match(
      /<input[^>]+data-notification-preference="userMentionHeadsUpEnabled"[^>]*>/
    )?.[0]
    expect(activeInput).toContain('aria-disabled="true"')
    expect(activeInput).toContain('checked=""')
    expect(activeInput).not.toMatch(/\sdisabled=/)
    expect(failedMarkup).toContain('role="alert"')
    expect(failedMarkup).toContain('保存失败，已恢复之前的设置。')
    expect(failedMarkup).toContain('>重试</button>')
  })
})
