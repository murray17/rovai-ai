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
  it('uses one master switch and groups the four categories by user scenario', () => {
    const markup = renderPreferenceEditor(preference())

    expect(markup.match(/role="switch"/g)).toHaveLength(5)
    expect(markup).toContain('class="notification-master-panel"')
    expect(markup).toContain('id="notification-scenario-response">需要响应</h3>')
    expect(markup).toContain('新的请求或明确提到你的消息')
    expect(markup).toContain('id="notification-scenario-outcome">本轮结果</h3>')
    expect(markup).toContain('协作完成或未完成的结果')
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
    expect(markup).toContain('1 / 2 项已保留')
    expect(markup).toContain('2 / 2 项已保留')
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
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
