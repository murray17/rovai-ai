---
document_type: ui-theme
authority: renderer-theme
status: accepted
theme_id: ember
mode: dark
last_updated: 2026-10-25
---

# 绯夜

## Identity and mode

- 显示名称：绯夜 / Crimson Night
- 稳定 `ThemeId` / `ThemePreference`：`ember`
- 明暗模式：`night`；`color-scheme: dark`

## Design intent

石墨黑、灰阶与正红主调，配中性深灰气泡；不扩展为棕铜色系。

## Surface hierarchy and color responsibilities

Canvas、rail、conversation、raised/input 通过明度建立深色层级。
红色用于主题强调和实心操作；正文、气泡与过程阅读区保持灰阶。
控件、消息、品牌、状态、身份和 Memory 的规则继承 [DESIGN.md](../../../DESIGN.md#colors)。

## Complete semantic token assignments

以下为完整配色 Token；布局、阅读字号与尺寸继续继承共享生产规则。

| Token | Value |
|---|---|
| `--monitoring-input` | `#d5d6d8` |
| `--monitoring-output` | `#8ca7c6` |
| `--monitoring-read` | `#86b098` |
| `--monitoring-write` | `#c9aa75` |
| `--settings-choice-line` | `#4a4a4a` |
| `--settings-choice-selected-line` | `#ed6868` |
| `--settings-choice-hover` | `#333333` |
| `--settings-field-line` | `#666666` |
| `--settings-switch-off` | `#666666` |
| `--settings-switch-thumb` | `#ffffff` |
| `--settings-select-arrow` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4.5 6.25 3.5 3.5 3.5-3.5' fill='none' stroke='%23b8b8b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")` |
| `--canvas` | `#171717` |
| `--surface` | `#202020` |
| `--surface-raised` | `#2b2b2b` |
| `--surface-subtle` | `#252525` |
| `--surface-muted` | `#333333` |
| `--surface-selected` | `#373737` |
| `--scrollbar-thumb` | `#373737` |
| `--surface-hover` | `#303030` |
| `--surface-sunken` | `#191919` |
| `--workspace-surface-subtle` | `#222222` |
| `--workspace-surface-raised` | `#2c2c2c` |
| `--workspace-surface-hover` | `#323232` |
| `--workspace-surface-selected` | `#3a3030` |
| `--workspace-line` | `#3b3b3b` |
| `--workspace-line-strong` | `#5c5c5c` |
| `--workspace-steel` | `#bdbdbd` |
| `--workspace-steel-ink` | `#e1e1e1` |
| `--workspace-attention-soft` | `#392e21` |
| `--workspace-faint` | `#a8a8a8` |
| `--runtime-logo-surface` | `#ffffff` |
| `--conversation-surface` | `#1b1b1b` |
| `--conversation-user-message-surface` | `#282828` |
| `--conversation-user-message-line` | `#282828` |
| `--execution-running-surface` | `#242424` |
| `--execution-surface` | `#1b1b1b` |
| `--conversation-find-match` | `#5a4725` |
| `--conversation-find-current` | `#845f23` |
| `--conversation-find-line` | `#d2ac70` |
| `--inspector-surface` | `#242424` |
| `--conversation-inspector-line` | `#5b5b5b` |
| `--home-surface` | `#1b1b1b` |
| `--settings-choice-selected-surface` | `#1b1b1b` |
| `--topbar` | `#292929` |
| `--input` | `#232323` |
| `--ink` | `#e6e6e6` |
| `--muted` | `#b8b8b8` |
| `--faint` | `#a7a7a7` |
| `--line` | `#373737` |
| `--resize-line` | `#777777` |
| `--line-strong` | `#595959` |
| `--control-line` | `#737373` |
| `--new-camp-picker-surface` | `#2b2b2b` |
| `--new-camp-picker-soft` | `#3a2929` |
| `--new-camp-picker-hover` | `#353535` |
| `--new-camp-picker-line-strong` | `#757575` |
| `--brand` | `#cd3434` |
| `--brand-hover` | `#d53a3a` |
| `--brand-contrast` | `#ffffff` |
| `--brand-soft` | `#3b2626` |
| `--brand-ink` | `#ff8a8a` |
| `--memory-rail` | `#151515` |
| `--memory-overlay` | `rgba(0, 0, 0, .58)` |
| `--memory-canvas` | `#1b1b1b` |
| `--memory-surface` | `#202020` |
| `--memory-raised` | `#242424` |
| `--memory-selected` | `#303030` |
| `--memory-hover` | `#262626` |
| `--memory-line` | `#383838` |
| `--memory-ink` | `#ededed` |
| `--memory-muted` | `#b6b6b6` |
| `--memory-input-line` | `#444444` |
| `--neutral-selected` | `#352728` |
| `--conversation-selection-surface` | `#2a2a2a` |
| `--neutral-hover` | `#303030` |
| `--conversation-action` | `#cd3434` |
| `--conversation-action-ink` | `#e6e6e6` |
| `--conversation-action-hover` | `#d53a3a` |
| `--conversation-action-contrast` | `#ffffff` |
| `--conversation-control-line` | `#6e6e6e` |
| `--conversation-focus` | `#f17777` |
| `--conversation-focus-soft` | `rgba(205,52,52,.20)` |
| `--conversation-route-accent` | `#cc8d8d` |
| `--conversation-unread` | `#ef5555` |
| `--update-progress-fill` | `#df4141` |
| `--mission-unread-ink` | `#ff9292` |
| `--file-update-marker` | `#d2ac70` |
| `--channel-feishu` | `#7fa2ff` |
| `--channel-dingtalk` | `#62a8ff` |
| `--qr-canvas` | `#ffffff` |
| `--resource-link` | `#9dc2f5` |
| `--resource-link-hover` | `#c1dafd` |
| `--mention-ink` | `#f1b2b2` |
| `--mention-ink-hover` | `#ffd0d0` |
| `--mention-feedback` | `rgba(241,178,178,.09)` |
| `--mention-popover-portrait-scrim` | `rgba(0, 0, 0, 0.15)` |
| `--mention-popover-label-line` | `rgba(255, 255, 255, 0.34)` |
| `--mention-popover-label-surface` | `rgba(9, 17, 22, 0.72)` |
| `--mention-popover-accent` | `var(--brand)` |
| `--aurora` | `#7eaea2` |
| `--aurora-soft` | `#1c2c29` |
| `--violet` | `#aa9bc6` |
| `--violet-soft` | `#272431` |
| `--rail` | `#242424` |
| `--rail-ink` | `#c2c2c2` |
| `--rail-line` | `#111111` |
| `--rail-logo` | `#f0f0f0` |
| `--ember` | `#e33838` |
| `--ember-soft` | `#3b2727` |
| `--success` | `#82b695` |
| `--success-soft` | `#1a2b22` |
| `--success-contrast` | `#0a140e` |
| `--attention` | `#d2ac70` |
| `--attention-soft` | `#302719` |
| `--attention-contrast` | `#160f08` |
| `--danger` | `#d6857f` |
| `--danger-soft` | `#321e1d` |
| `--danger-contrast` | `#160d0c` |
| `--info` | `#83afc9` |
| `--info-soft` | `#182832` |
| `--info-contrast` | `#071319` |
| `--neutral` | `#abb5bc` |
| `--neutral-soft` | `#242d33` |
| `--focus` | `#f17777` |
| `--focus-soft` | `rgba(241,119,119,.16)` |
| `--overlay` | `rgba(0,0,0,.64)` |
| `--shadow-float` | `0 14px 40px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.04)` |
| `--shadow-menu` | `var(--shadow-float)` |
| `--shadow-dialog` | `var(--shadow-float)` |
| `--shadow-card` | `none` |
| `--approval-line` | `#8f7447` |
| `--inline-code-canvas` | `#363636` |
| `--conversation-inline-code-canvas` | `#363232` |
| `--dialog-field-label` | `#b9b9b9` |
| `--dialog-field-line` | `#555555` |
| `--dialog-field-line-hover` | `#828282` |
| `--conversation-code-block-canvas` | `#222222` |
| `--conversation-code-line` | `#383838` |
| `--shell-result-canvas` | `#292929` |
| `--code-block-canvas` | `#242424` |
| `--evidence-canvas` | `#1b1b1b` |
| `--evidence-surface` | `#262626` |
| `--evidence-ink` | `#e1e1e1` |
| `--evidence-muted` | `#b3b3b3` |
| `--evidence-line` | `#444444` |
| `--diff-add` | `#92c7a5` |
| `--diff-add-soft` | `#21412e` |
| `--diff-remove` | `#e09a94` |
| `--diff-remove-soft` | `#4c2221` |
| `--diff-hunk-soft` | `#292929` |
| `--file-change-surface` | `#222222` |
| `--file-change-hover` | `#2c2c2c` |
| `--file-change-selected` | `#393232` |
| `--file-change-selected-line` | `#695151` |
| `--file-change-add-soft` | `#223029` |
| `--file-change-remove-soft` | `#342626` |
| `--file-change-hunk` | `#2b2b2b` |
| `--identity-1` | `#c98572` |
| `--identity-2` | `#70b0ae` |
| `--identity-3` | `#a89ac8` |
| `--identity-4` | `#d0a46c` |
| `--identity-5` | `#80abd1` |
| `--identity-6` | `#b37d9a` |
| `--identity-7` | `#89a878` |
| `--identity-8` | `#b58b68` |
| `--mission-label-1` | `#e28f7b` |
| `--mission-label-2` | `#72c5c1` |
| `--mission-label-3` | `#b7a6e0` |
| `--mission-label-4` | `#deb26b` |
| `--mission-label-5` | `#81b8e8` |
| `--mission-label-6` | `#d18cac` |
| `--mission-label-7` | `#93bb77` |
| `--mission-label-8` | `#d79b6c` |
| `--attachment-web` | `#c98572` |
| `--attachment-code` | `#70b0ae` |
| `--attachment-notes` | `#abb5bc` |
| `--attachment-pdf` | `#d6857f` |
| `--attachment-word` | `#80abd1` |
| `--attachment-sheet` | `#82b695` |
| `--attachment-slide` | `#d0a46c` |
| `--attachment-image` | `#a89ac8` |
| `--attachment-archive` | `#b58b68` |
| `--attachment-generic` | `#abb5bc` |
| `--lightbox-overlay` | `rgb(3 7 10 / 84%)` |
| `--lightbox-surface` | `#10171d` |
| `--lightbox-ink` | `#f7fafb` |
| `--lightbox-line` | `rgb(255 255 255 / 18%)` |
| `--lightbox-control` | `rgb(255 255 255 / 10%)` |
| `--lightbox-shadow` | `0 28px 80px rgb(0 0 0 / 52%)` |
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
