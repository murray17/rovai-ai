---
document_type: ui-theme
authority: renderer-theme
status: accepted
theme_id: steel-night
mode: dark
last_updated: 2026-10-30
---

# Steel Night

## Identity

- `theme_id`: `steel-night`
- Display name: `Steel Night`
- Runtime mapping: `ThemeId = "night"`, `ResolvedTheme = "night"`

## Mode

Dark. `color-scheme: dark`.

## Design intent

冷石墨表面与低饱和 Steel 品牌色；普通操作使用浅色动作 Token。深色层级独立配色，不自动反色。

## Surface hierarchy

最深 Canvas 承载 rail 和主 surface，raised/input 再上提一级。会话与 Inspector 使用相邻但可辨的
石墨表面及强分隔线。普通内容保持平面，只有真正浮层使用更深阴影。

色彩职责、控件边界与共享交互继承 [DESIGN.md](../../../DESIGN.md)。

## Complete semantic token assignments

### Surfaces, text and structure

| Token | Value |
|---|---:|
| `--canvas` | `#0d1114` |
| `--surface` | `#151a1e` |
| `--surface-raised` | `#1b2227` |
| `--surface-subtle` | `#1a2024` |
| `--surface-muted` | `#242d33` |
| `--surface-selected` | `#222c33` |
| `--scrollbar-thumb` | `#222c33` |
| `--surface-hover` | `#1d252b` |
| `--surface-sunken` | `#10161a` |
| `--workspace-surface-subtle` | `#11171b` |
| `--workspace-surface-raised` | `#1c2328` |
| `--workspace-surface-hover` | `#1d252a` |
| `--workspace-surface-selected` | `#22303a` |
| `--workspace-line` / `--workspace-line-strong` | `#2b353b` / `#3d4950` |
| `--workspace-steel` / `--workspace-steel-ink` | `#8fadc0` / `#b8d0df` |
| `--workspace-attention-soft` | `#302617` |
| `--workspace-faint` | `#8998a1` |
| `--conversation-surface` | `#181d21` |
| `--conversation-user-message-surface` | `#24282b` |
| `--conversation-user-message-line` | `#24282b` |
| `--execution-running-surface` | `#1b2024` |
| `--conversation-find-match` | `#5a4725` |
| `--conversation-find-current` | `#845f23` |
| `--conversation-find-line` | `#d2ac70` |
| `--inspector-surface` | `#171d21` |
| `--conversation-inspector-line` | `#53616b` |
| `--home-surface` | `#181d21` |
| `--settings-choice-selected-surface` | `#181d21` |
| `--topbar` | `#151a1e` |
| `--input` | `#1b2227` |
| `--ink` | `#e7ecef` |
| `--muted` | `#abb5bc` |
| `--faint` | `#919da6` |
| `--line` | `#333e46` |
| `--resize-line` | `#777777` |
| `--line-strong` | `#53616b` |
| `--control-line` | `#687b88` |
| `--new-camp-picker-surface` | `#1b2227` |
| `--new-camp-picker-soft` | `#22303a` |
| `--new-camp-picker-hover` | `#24323b` |
| `--new-camp-picker-line-strong` | `#6a8190` |
| `--rail` | `#11161a` |
| `--rail-ink` | `#a6b1b8` |
| `--rail-line` | `#313b43` |
| `--rail-logo` | `#b1c8d8` |

### Settings controls and usage series

| Token | Value |
|---|---:|
| `--settings-choice-line` | `#343e45` |
| `--settings-choice-selected-line` | `#778188` |
| `--settings-choice-hover` | `#1c2429` |
| `--settings-field-line` | `#465159` |
| `--settings-switch-off` | `#535f68` |
| `--settings-switch-thumb` | `#ffffff` |
| `--settings-select-arrow` | SVG chevron stroke `#aeb9c1` |
| `--monitoring-input` | `#d5d6d8` |
| `--monitoring-output` | `#8ca7c6` |
| `--monitoring-read` | `#86b098` |
| `--monitoring-write` | `#c9aa75` |

### Brand, mention and supporting accents

| Token | Value |
|---|---:|
| `--brand` | `#7897ae` |
| `--brand-hover` | `#b1c8d8` |
| `--brand-contrast` | `#091116` |
| `--brand-soft` | `#22303a` |
| `--brand-ink` | `#c0d4e1` |
| `--resource-link` | `#84b0ff` |
| `--resource-link-hover` | `#b3d0ff` |
| `--mention-ink` | `#9cc7e2` |
| `--mention-ink-hover` | `#c2ddeb` |
| `--mention-feedback` | `rgba(156, 199, 226, 0.08)` |
| `--mention-popover-portrait-scrim` | `rgba(0, 0, 0, 0.15)` |
| `--mention-popover-label-line` | `rgba(255, 255, 255, 0.34)` |
| `--mention-popover-label-surface` | `rgba(9, 17, 22, 0.72)` |
| `--aurora` | `#7eaea2` |
| `--aurora-soft` | `#1c2c29` |
| `--violet` | `#aa9bc6` |
| `--violet-soft` | `#272431` |
| `--ember` | `#d2aa72` |
| `--ember-soft` | `#302719` |

### Conversation controls

Action tokens serve shared controls across the App; the `conversation-` prefix does not limit their scope.

| Token | Value |
|---|---:|
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
| `--neutral-selected` | `#292e32` |
| `--neutral-hover` | `#23292e` |
| `--conversation-action` | `#e5e5e7` |
| `--conversation-action-ink` | `#e5e5e7` |
| `--conversation-action-hover` | `#ffffff` |
| `--conversation-action-contrast` | `#171719` |
| `--conversation-control-line` | `#767a7e` |
| `--conversation-focus` | `#d4d4d8` |
| `--conversation-focus-soft` | `rgba(212, 212, 216, 0.16)` |
| `--conversation-route-accent` | `#a2a6aa` |
| `--conversation-unread` | `#5aa7ff` |
| `--update-progress-fill` | `#60a5fa` |
| `--mission-unread-ink` | `#79b8ff` |
| `--file-update-marker` | `#d2ac70` |

### Semantic state

| Role | Foreground | Soft | Contrast |
|---|---:|---:|---:|
| success | `#82b695` | `#1a2b22` | `#0a140e` |
| attention | `#d2ac70` | `#302719` | `#160f08` |
| danger | `#d6857f` | `#321e1d` | `#160d0c` |
| info | `#83afc9` | `#182832` | `#071319` |
| neutral | `#abb5bc` | `#242d33` | — |

`--approval-line` is `#8f7447`; `--focus` is `#8fb3cb`; `--focus-soft` is
`rgba(143, 179, 203, 0.18)`.

### Identity

| Token | Value | Token | Value |
|---|---:|---|---:|
| `--identity-1` | `#c98572` | `--identity-5` | `#80abd1` |
| `--identity-2` | `#70b0ae` | `--identity-6` | `#b37d9a` |
| `--identity-3` | `#a89ac8` | `--identity-7` | `#89a878` |
| `--identity-4` | `#d0a46c` | `--identity-8` | `#b58b68` |

### Mission labels

Mission labels retain their normalized-text stable eight-slot hash but use a dedicated palette so changing label
readability does not recolor members, Skills or MCP servers.

| Token | Value | Token | Value |
|---|---:|---|---:|
| `--mission-label-1` | `#e28f7b` | `--mission-label-5` | `#81b8e8` |
| `--mission-label-2` | `#72c5c1` | `--mission-label-6` | `#d18cac` |
| `--mission-label-3` | `#b7a6e0` | `--mission-label-7` | `#93bb77` |
| `--mission-label-4` | `#deb26b` | `--mission-label-8` | `#d79b6c` |

### Agent artifact families

Night 为相同十个格式家族提供独立亮度值；它们只表达文件类别，不复用状态色或成员身份色。

| Token | Value | Token | Value |
|---|---:|---|---:|
| `--attachment-web` | `#c98572` | `--attachment-code` | `#70b0ae` |
| `--attachment-notes` | `#abb5bc` | `--attachment-pdf` | `#d6857f` |
| `--attachment-word` | `#80abd1` | `--attachment-sheet` | `#82b695` |
| `--attachment-slide` | `#d0a46c` | `--attachment-image` | `#a89ac8` |
| `--attachment-archive` | `#b58b68` | `--attachment-generic` | `#abb5bc` |

### Evidence and diff

| Token | Value |
|---|---:|
| `--inline-code-canvas` | `#353b3f` |
| `--conversation-inline-code-canvas` | `#343536` |
| `--conversation-code-block-canvas` | `#28292a` |
| `--conversation-code-line` | `#3d3f41` |
| `--shell-result-canvas` | `#373f43` |
| `--code-block-canvas` | `#1d252b` |
| `--evidence-canvas` | `#12191d` |
| `--evidence-surface` | `#171f24` |
| `--evidence-ink` | `#dce4e9` |
| `--evidence-muted` | `#9eabb3` |
| `--evidence-line` | `#35424a` |
| `--diff-add` / `--diff-add-soft` | `#92c7a5` / `#21412e` |
| `--diff-remove` / `--diff-remove-soft` | `#e09a94` / `#4c2221` |
| `--diff-hunk-soft` | `#1b272a` |
| `--file-change-surface` | `#191e22` |
| `--file-change-hover` | `#24292d` |
| `--file-change-selected` | `#303538` |
| `--file-change-selected-line` | `#4b5257` |
| `--file-change-add-soft` | `#223029` |
| `--file-change-remove-soft` | `#342626` |
| `--file-change-hunk` | `#252b2f` |

### Overlay and lightbox

`--overlay` is `rgba(0, 0, 0, 0.58)` and `--shadow-float` is
`0 22px 64px rgba(0, 0, 0, 0.42)`. The lightbox keeps `#10171d` surface,
`#f7fafb` ink, `rgb(255 255 255 / 18%)` line, `rgb(255 255 255 / 10%)` control and
`0 28px 80px rgb(0 0 0 / 52%)` shadow over `rgb(3 7 10 / 84%)`.

### Dialog fields

| Token | Value |
|---|---:|
| `--dialog-field-label` | `#a6abb2` |
| `--dialog-field-line` | `#3b434a` |
| `--dialog-field-line-hover` | `#697983` |

Labels use regular weight. Fields retain a 1px border and input surface; focus follows
[DESIGN.md](../../../DESIGN.md#components). Higher contrast preferences use the stronger control line and ink. Import MCP source JSON reuses
`--conversation-code-block-canvas`, with no extra left margin.

### Shared aliases and geometry

Night inherits the shared non-color structure from `:root`; aliases resolve against Night values:

| Token | Value |
|---|---:|
| `--rail-width` | `270px` |
| `--project-menu-slot` / `--project-create-slot` | `24px` / `26px` |
| `--mention-popover-arrow-x` | `28px` |
| `--mention-popover-accent` | `var(--brand)` |
| `--shadow-menu` / `--shadow-dialog` | `var(--shadow-float)` |
| `--shadow-card` | `none` |
| `--member-avatar-size` | `32px` |
| `--member-avatar-accent` | `var(--identity-1)` |
| `--identity-clamp-lines` | `3` |
| `--conversation-prose-width` | `76ch` |
| `--conversation-artifact-width` | `930px` |
| `--conversation-wide-width` | `1040px` |
| `--conversation-composer-width` | `1040px`; viewport `>= 1800px` 时为 `1440px` |
| `--conversation-user-message-max-width` | `690px` |
| `--conversation-user-message-width-offset` | `36px`; viewport `<= 1080px` 时为 `18.667px`，紧凑会话列为 `16px` |

## Message and evidence rendering

Inline code, Shell results and fenced evidence use their
respective code tokens. Conversation prose, process copy and Markdown files use the dedicated
`--conversation-inline-code-canvas`, `--conversation-code-block-canvas` and `--conversation-code-line` layer;
release notes and Tool results keep shared SafeMarkdown defaults.
Public user/Agent messages and Single Chat user bubbles share `--conversation-user-message-surface`
and its matching 1px border allocation; private Agent narrative stays transparent.

## Contrast requirements

Normal text must meet 4.5:1; control boundaries and non-text state indicators must meet 3:1.
Focus behavior follows the [accessibility baseline](../qa/accessibility.md).
Verify semantic labels and all eight identity tokens on their production Night surfaces.

## Implementation source

The `:root[data-theme="night"]` block in
[`theme.css`](../../../packages/ui/src/theme.css) is the production source. Tokens not
overridden there intentionally inherit shared geometry and aliases from `:root`.

## Visual verification

Run the Renderer theme-token tests and the shared [theme matrix](../qa/theme-matrix.md).
