---
document_type: ui-theme
authority: renderer-theme
status: accepted
theme_id: horizon
mode: light
last_updated: 2026-10-25
---

# 晨雾

## Identity and mode

- 显示名称：晨雾 / Morning Mist
- 稳定 `ThemeId` / `ThemePreference`：`horizon`
- 明暗模式：`day`；`color-scheme: light`

## Design intent

轻暖白阅读区、低饱和浅灰表面与灰绿强调色。暖意限定在会话、侧栏和气泡；执行台、队员浮层与表单保持中性白。

## Surface hierarchy and color responsibilities

会话、侧栏与气泡使用轻暖灰白；正文使用深灰，强调色使用灰绿。
`--execution-surface`、`--inspector-surface`、输入与通用浮层使用中性白；代码与 Evidence 使用近中性灰。
控件、消息、品牌、状态、身份和 Memory 的规则继承 [DESIGN.md](../../../DESIGN.md#colors)。

## Complete semantic token assignments

以下为完整配色 Token；布局、阅读字号与尺寸继续继承共享生产规则。

| Token | Value |
|---|---|
| `--monitoring-input` | `#393b3d` |
| `--monitoring-output` | `#657f9b` |
| `--monitoring-read` | `#698273` |
| `--monitoring-write` | `#997b4d` |
| `--settings-choice-line` | `#dedfd9` |
| `--settings-choice-selected-line` | `#8c9b7f` |
| `--settings-choice-hover` | `#f5f5f2` |
| `--settings-field-line` | `#c7cbc2` |
| `--settings-switch-off` | `#8c939a` |
| `--settings-switch-thumb` | `#fff` |
| `--settings-select-arrow` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4.5 6.25 3.5 3.5 3.5-3.5' fill='none' stroke='%23616b74' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")` |
| `--canvas` | `#f1f0ec` |
| `--surface` | `#fbfbfa` |
| `--surface-raised` | `#ffffff` |
| `--surface-subtle` | `#f4f4f2` |
| `--surface-muted` | `#eaeae7` |
| `--surface-selected` | `#e9e9e4` |
| `--scrollbar-thumb` | `#e9e9e4` |
| `--surface-hover` | `#eeeeea` |
| `--surface-sunken` | `#e9e9e6` |
| `--workspace-surface-subtle` | `#f5f5f3` |
| `--workspace-surface-raised` | `#ffffff` |
| `--workspace-surface-hover` | `#eeeeec` |
| `--workspace-surface-selected` | `#e9e9e4` |
| `--workspace-line` | `#e2e3df` |
| `--workspace-line-strong` | `#c7cac3` |
| `--workspace-steel` | `#586e67` |
| `--workspace-steel-ink` | `#435c52` |
| `--workspace-attention-soft` | `#f4ecdf` |
| `--workspace-faint` | `#6b6e67` |
| `--runtime-logo-surface` | `#ffffff` |
| `--conversation-surface` | `#fdfcf9` |
| `--conversation-user-message-surface` | `#f0efeb` |
| `--conversation-user-message-line` | `#f0efeb` |
| `--execution-running-surface` | `#f4f4f2` |
| `--execution-surface` | `#ffffff` |
| `--conversation-find-match` | `#f4e4c3` |
| `--conversation-find-current` | `#edc66f` |
| `--conversation-find-line` | `#bd8a38` |
| `--inspector-surface` | `#ffffff` |
| `--conversation-inspector-line` | `#d6d8d3` |
| `--home-surface` | `#fdfcf9` |
| `--settings-choice-selected-surface` | `#fdfcf9` |
| `--topbar` | `#fdfcf9` |
| `--input` | `#ffffff` |
| `--ink` | `#30322f` |
| `--muted` | `#666963` |
| `--faint` | `#6b6e67` |
| `--line` | `#e2e3de` |
| `--resize-line` | `#777777` |
| `--line-strong` | `#c6c9c2` |
| `--control-line` | `#8b9187` |
| `--new-camp-picker-surface` | `#ffffff` |
| `--new-camp-picker-soft` | `#f5f5f3` |
| `--new-camp-picker-hover` | `#efefec` |
| `--new-camp-picker-line-strong` | `#8f948a` |
| `--brand` | `#586e67` |
| `--brand-hover` | `#43574f` |
| `--brand-contrast` | `#ffffff` |
| `--brand-soft` | `#e9eeea` |
| `--brand-ink` | `#435c52` |
| `--memory-rail` | `#f3f3f3` |
| `--memory-overlay` | `rgba(24, 24, 24, .42)` |
| `--memory-canvas` | `#ffffff` |
| `--memory-surface` | `#f5f5f5` |
| `--memory-raised` | `#ffffff` |
| `--memory-selected` | `#ededed` |
| `--memory-hover` | `#f3f3f3` |
| `--memory-line` | `#e2e2e2` |
| `--memory-ink` | `#222222` |
| `--memory-muted` | `#626262` |
| `--memory-input-line` | `#dedede` |
| `--neutral-selected` | `#e9e9e4` |
| `--conversation-selection-surface` | `#e9e9e9` |
| `--neutral-hover` | `#eeeeea` |
| `--conversation-action` | `#303733` |
| `--conversation-action-ink` | `#303733` |
| `--conversation-action-hover` | `#212723` |
| `--conversation-action-contrast` | `#ffffff` |
| `--conversation-control-line` | `#90958c` |
| `--conversation-focus` | `#4f6256` |
| `--conversation-focus-soft` | `rgba(79,98,86,.12)` |
| `--conversation-route-accent` | `#8b918a` |
| `--conversation-unread` | `#1683ff` |
| `--update-progress-fill` | `#2879e8` |
| `--mission-unread-ink` | `#0967d2` |
| `--file-update-marker` | `#b7791f` |
| `--channel-feishu` | `#3370ff` |
| `--channel-dingtalk` | `#0b7cff` |
| `--qr-canvas` | `#ffffff` |
| `--resource-link` | `#2b66d9` |
| `--resource-link-hover` | `#1e4fb8` |
| `--mention-ink` | `#2f61c8` |
| `--mention-ink-hover` | `#244ea7` |
| `--mention-feedback` | `rgba(47, 97, 200, 0.08)` |
| `--mention-popover-portrait-scrim` | `rgba(32, 36, 56, 0.10)` |
| `--mention-popover-label-line` | `rgba(255, 255, 255, 0.45)` |
| `--mention-popover-label-surface` | `rgba(32, 36, 56, 0.34)` |
| `--mention-popover-accent` | `var(--brand)` |
| `--aurora` | `#719d94` |
| `--aurora-soft` | `#e7f0ec` |
| `--violet` | `#9082b4` |
| `--violet-soft` | `#efebf6` |
| `--rail` | `#f3f1ec` |
| `--rail-ink` | `#656962` |
| `--rail-line` | `#e0e1db` |
| `--rail-logo` | `#586e67` |
| `--ember` | `#b68c55` |
| `--ember-soft` | `#f6ecd9` |
| `--success` | `#3e775c` |
| `--success-soft` | `#e7f1ea` |
| `--success-contrast` | `#ffffff` |
| `--attention` | `#8a6226` |
| `--attention-soft` | `#f8edda` |
| `--attention-contrast` | `#ffffff` |
| `--danger` | `#a24c46` |
| `--danger-soft` | `#f7e6e3` |
| `--danger-contrast` | `#ffffff` |
| `--info` | `#416c86` |
| `--info-soft` | `#e5eef3` |
| `--info-contrast` | `#ffffff` |
| `--neutral` | `#5f6678` |
| `--neutral-soft` | `#ecefe9` |
| `--focus` | `#586e67` |
| `--focus-soft` | `rgba(88,110,103,.13)` |
| `--overlay` | `rgba(28, 32, 43, 0.42)` |
| `--shadow-float` | `0 18px 56px rgba(29,36,26,.14)` |
| `--shadow-menu` | `var(--shadow-float)` |
| `--shadow-dialog` | `var(--shadow-float)` |
| `--shadow-card` | `none` |
| `--approval-line` | `#d8bd87` |
| `--inline-code-canvas` | `#ebeeec` |
| `--conversation-inline-code-canvas` | `#ebeeec` |
| `--dialog-field-label` | `#686b65` |
| `--dialog-field-line` | `#d7d9d3` |
| `--dialog-field-line-hover` | `#afb5ac` |
| `--conversation-code-block-canvas` | `#f5f6f5` |
| `--conversation-code-line` | `#dfe3e0` |
| `--shell-result-canvas` | `#f0f2f0` |
| `--code-block-canvas` | `#f5f6f5` |
| `--evidence-canvas` | `#f4f5f4` |
| `--evidence-surface` | `#ffffff` |
| `--evidence-ink` | `#303532` |
| `--evidence-muted` | `#666d68` |
| `--evidence-line` | `#dce0dc` |
| `--diff-add` | `#137333` |
| `--diff-add-soft` | `#d9f1e2` |
| `--diff-remove` | `#b3261e` |
| `--diff-remove-soft` | `#f5dede` |
| `--diff-hunk-soft` | `#f3f4f4` |
| `--file-change-surface` | `#ffffff` |
| `--file-change-hover` | `#f5f6f4` |
| `--file-change-selected` | `#e9ede8` |
| `--file-change-selected-line` | `#cfd5ce` |
| `--file-change-add-soft` | `#ecf7f0` |
| `--file-change-remove-soft` | `#fcf0ef` |
| `--file-change-hunk` | `#f5f5f4` |
| `--identity-1` | `#a65f4a` |
| `--identity-2` | `#39777a` |
| `--identity-3` | `#74628f` |
| `--identity-4` | `#96662f` |
| `--identity-5` | `#4f729b` |
| `--identity-6` | `#8a5c75` |
| `--identity-7` | `#547245` |
| `--identity-8` | `#8c6146` |
| `--mission-label-1` | `#ae4e3e` |
| `--mission-label-2` | `#27777b` |
| `--mission-label-3` | `#71579a` |
| `--mission-label-4` | `#95610f` |
| `--mission-label-5` | `#3f6fa7` |
| `--mission-label-6` | `#914f78` |
| `--mission-label-7` | `#4d752f` |
| `--mission-label-8` | `#98542e` |
| `--attachment-web` | `#a65f4a` |
| `--attachment-code` | `#39777a` |
| `--attachment-notes` | `#5f6678` |
| `--attachment-pdf` | `#9a4b46` |
| `--attachment-word` | `#4e6ea8` |
| `--attachment-sheet` | `#3e775c` |
| `--attachment-slide` | `#9a6a32` |
| `--attachment-image` | `#74628f` |
| `--attachment-archive` | `#8c6146` |
| `--attachment-generic` | `#616a73` |
| `--lightbox-overlay` | `rgb(12 18 24 / 72%)` |
| `--lightbox-surface` | `#10171d` |
| `--lightbox-ink` | `#f7fafb` |
| `--lightbox-line` | `rgb(255 255 255 / 18%)` |
| `--lightbox-control` | `rgb(255 255 255 / 10%)` |
| `--lightbox-shadow` | `0 28px 80px rgb(0 0 0 / 42%)` |
| `--member-avatar-accent` | `var(--identity-1)` |

## Contrast requirements

共享主题测试验证普通正文、静音文字、状态标签、八种身份文字与消息气泡正文至少 4.5:1；
会话控件及选择器强边界至少 3:1。焦点行为遵循[无障碍基线](../qa/accessibility.md)。

## Prohibited substitutions

不自动反色、不分叉组件，不增加主题专属交互或聚焦装饰。

## Implementation and verification

真源：[共享 Token](../../../packages/ui/src/theme.css)、
[主题解析](../../../apps/desktop/src/shared/appearance.ts)、
[对比度测试](../../../apps/desktop/src/renderer/src/theme-tokens.test.ts)。
按[共享矩阵](../qa/theme-matrix.md)验证全部配色、状态、浮层与平台边界。
