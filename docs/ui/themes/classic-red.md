---
document_type: ui-theme
authority: renderer-theme
status: accepted
theme_id: classic-red
mode: light
last_updated: 2026-10-30
---

# 朝霞

## Identity and mode

- 显示名称：朝霞 / Dawn Glow
- 稳定 `ThemeId` / `ThemePreference`：`classic-red`
- 明暗模式：`day`；`color-scheme: light`

## Design intent

纯白阅读区、浅灰气泡与轻红侧栏。通过区域底色表达红色主题；樱桃红用于实心主操作与选中控件的 action 色。
普通表面上的操作文字和选中勾使用中性深灰的 `--conversation-action-ink`；实心操作内的文字与图标使用
`--conversation-action-contrast`。导航文字保持中性深灰，Logo 使用既有 Steel 与 Ember 色。

## Surface hierarchy and color responsibilities

侧栏使用轻红底，选中区域使用低饱和灰红，避免大面积鲜红选中块。
会话、输入、执行台与队员浮层保持白色；滚动块使用独立中性灰。
控件、消息、品牌、状态、身份和 Memory 的规则继承 [DESIGN.md](../../../DESIGN.md#colors)。

## Complete semantic token assignments

以下为完整配色 Token；布局、阅读字号与尺寸继续继承共享生产规则。

| Token | Value |
|---|---|
| `--monitoring-input` | `#393b3d` |
| `--monitoring-output` | `#657f9b` |
| `--monitoring-read` | `#698273` |
| `--monitoring-write` | `#997b4d` |
| `--settings-choice-line` | `#e1e1e1` |
| `--settings-choice-selected-line` | `#c75b68` |
| `--settings-choice-hover` | `#fcf6f7` |
| `--settings-field-line` | `#cdcdcd` |
| `--settings-switch-off` | `#8c939a` |
| `--settings-switch-thumb` | `#fff` |
| `--settings-select-arrow` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4.5 6.25 3.5 3.5 3.5-3.5' fill='none' stroke='%23616b74' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")` |
| `--canvas` | `#f1f0f1` |
| `--surface` | `#fcfbfc` |
| `--surface-raised` | `#ffffff` |
| `--surface-subtle` | `#f7f6f6` |
| `--surface-muted` | `#f0ebec` |
| `--surface-selected` | `#eee4e6` |
| `--scrollbar-thumb` | `#dedede` |
| `--surface-hover` | `#f2ebed` |
| `--surface-sunken` | `#eae7e8` |
| `--workspace-surface-subtle` | `#f7f7f7` |
| `--workspace-surface-raised` | `#ffffff` |
| `--workspace-surface-hover` | `#f2f1f2` |
| `--workspace-surface-selected` | `#eceaeb` |
| `--workspace-line` | `#e6e4e5` |
| `--workspace-line-strong` | `#c8c4c6` |
| `--workspace-steel` | `#6c686a` |
| `--workspace-steel-ink` | `#3b383a` |
| `--workspace-attention-soft` | `#f4ecdf` |
| `--workspace-faint` | `#696567` |
| `--runtime-logo-surface` | `#ffffff` |
| `--conversation-surface` | `#ffffff` |
| `--conversation-user-message-surface` | `#f5f4f4` |
| `--conversation-user-message-line` | `#f5f4f4` |
| `--execution-running-surface` | `#f7f6f6` |
| `--execution-surface` | `#ffffff` |
| `--conversation-find-match` | `#f4e4c3` |
| `--conversation-find-current` | `#edc66f` |
| `--conversation-find-line` | `#bd8a38` |
| `--inspector-surface` | `#ffffff` |
| `--conversation-inspector-line` | `#d6d6d2` |
| `--home-surface` | `#ffffff` |
| `--settings-choice-selected-surface` | `#eee4e6` |
| `--topbar` | `#ffffff` |
| `--input` | `#ffffff` |
| `--ink` | `#2b292c` |
| `--muted` | `#656165` |
| `--faint` | `#696567` |
| `--line` | `#e7e3e5` |
| `--resize-line` | `#777777` |
| `--line-strong` | `#c8c4c6` |
| `--control-line` | `#948f92` |
| `--new-camp-picker-surface` | `#ffffff` |
| `--new-camp-picker-soft` | `#f4f4f4` |
| `--new-camp-picker-hover` | `#efefef` |
| `--new-camp-picker-line-strong` | `#909090` |
| `--brand` | `#ce3e4e` |
| `--brand-hover` | `#b83242` |
| `--brand-contrast` | `#ffffff` |
| `--brand-soft` | `#faedef` |
| `--brand-ink` | `#373437` |
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
| `--neutral-selected` | `#eee4e6` |
| `--neutral-hover` | `#f4edef` |
| `--conversation-action` | `#ce3e4e` |
| `--conversation-action-ink` | `#373437` |
| `--conversation-action-hover` | `#b83242` |
| `--conversation-action-contrast` | `#ffffff` |
| `--conversation-control-line` | `#948f92` |
| `--conversation-focus` | `#373437` |
| `--conversation-focus-soft` | `rgba(55,52,55,.12)` |
| `--conversation-route-accent` | `#8d8d8d` |
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
| `--rail` | `#f8f5f6` |
| `--rail-ink` | `#625e62` |
| `--rail-line` | `#e7e1e4` |
| `--rail-logo` | `#526f88` |
| `--ember` | `#d3a45f` |
| `--ember-soft` | `#f6eddf` |
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
| `--focus` | `#373437` |
| `--focus-soft` | `rgba(55,52,55,.12)` |
| `--overlay` | `rgba(28, 32, 43, 0.42)` |
| `--shadow-float` | `0 18px 56px rgba(38,30,28,.13)` |
| `--shadow-menu` | `var(--shadow-float)` |
| `--shadow-dialog` | `var(--shadow-float)` |
| `--shadow-card` | `none` |
| `--approval-line` | `#d8bd87` |
| `--inline-code-canvas` | `#f0f0f0` |
| `--conversation-inline-code-canvas` | `#f2f2f2` |
| `--dialog-field-label` | `#707070` |
| `--dialog-field-line` | `#dddddd` |
| `--dialog-field-line-hover` | `#b6b6b6` |
| `--conversation-code-block-canvas` | `#f7f7f7` |
| `--conversation-code-line` | `#e6e6e6` |
| `--shell-result-canvas` | `#f5f5f2` |
| `--code-block-canvas` | `#f7f7f7` |
| `--evidence-canvas` | `#f6f6f6` |
| `--evidence-surface` | `#ffffff` |
| `--evidence-ink` | `#303030` |
| `--evidence-muted` | `#686868` |
| `--evidence-line` | `#e3e3e3` |
| `--diff-add` | `#137333` |
| `--diff-add-soft` | `#d9f1e2` |
| `--diff-remove` | `#b3261e` |
| `--diff-remove-soft` | `#f5dede` |
| `--diff-hunk-soft` | `#f3f4f4` |
| `--file-change-surface` | `#ffffff` |
| `--file-change-hover` | `#f6f6f3` |
| `--file-change-selected` | `#efefef` |
| `--file-change-selected-line` | `#d7d7d7` |
| `--file-change-add-soft` | `#ecf7f0` |
| `--file-change-remove-soft` | `#fcf0ef` |
| `--file-change-hunk` | `#f5f5f4` |
| `--identity-1` | `#a65f4a` |
| `--identity-2` | `#39777a` |
| `--identity-3` | `#74628f` |
| `--identity-4` | `#9a6a32` |
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
