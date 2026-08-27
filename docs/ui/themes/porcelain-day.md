---
document_type: ui-theme
authority: renderer-theme
status: accepted
theme_id: porcelain-day
mode: light
last_updated: 2026-08-25
---

# Porcelain Day

## Identity

- `theme_id`: `porcelain-day`
- Display name: `Porcelain Day`
- Runtime value: `ResolvedTheme = "day"`

## Mode

Light. `color-scheme: light`.

## Design intent

冷瓷灰 Canvas、近白纸面和低饱和 Steel 构成适合长时间协作的安静工作台。Steel 只用于
品牌、结构和稳定选择；语义状态、身份与证据保留各自颜色系统。

## Surface hierarchy

`canvas → rail/surface → raised/input` 形成主要层级。会话、Inspector 与 Quick Chat 主区使用
独立语义 surface token，以便结构清楚而不依赖阴影。普通列表与消息保持平面。

## Complete semantic token assignments

### Surfaces, text and structure

| Token | Value |
|---|---:|
| `--canvas` | `#eceeef` |
| `--surface` | `#fbfbfa` |
| `--surface-raised` | `#ffffff` |
| `--surface-subtle` | `#f0f2f4` |
| `--surface-muted` | `#e7eaed` |
| `--surface-selected` | `#e9ecee` |
| `--surface-hover` | `#e8eaea` |
| `--surface-sunken` | `#e4e8eb` |
| `--workspace-surface-subtle` | `#f4f5f4` |
| `--workspace-surface-raised` | `#ffffff` |
| `--workspace-surface-hover` | `#e8ebec` |
| `--workspace-surface-selected` | `#e4eaee` |
| `--workspace-line` / `--workspace-line-strong` | `#d5dadd` / `#bdc6ca` |
| `--workspace-steel` / `--workspace-steel-ink` | `#476b85` / `#34576f` |
| `--workspace-attention-soft` | `#f4ecdf` |
| `--workspace-faint` | `#71808a` |
| `--conversation-surface` | `#ffffff` |
| `--conversation-find-match` | `#f4e4c3` |
| `--conversation-find-current` | `#edc66f` |
| `--conversation-find-line` | `#bd8a38` |
| `--inspector-surface` | `#ffffff` |
| `--conversation-inspector-line` | `#c7cfd6` |
| `--home-surface` | `#ffffff` |
| `--topbar` | `#fbfbfa` |
| `--input` | `#ffffff` |
| `--ink` | `#171b20` |
| `--muted` | `#616a73` |
| `--faint` | `#6e7382` |
| `--line` | `#dfe4e8` |
| `--line-strong` | `#c7cfd6` |
| `--control-line` | `#8b9389` |
| `--rail` | `#f3f4f4` |
| `--rail-ink` | `#626b72` |
| `--rail-line` | `#dadde0` |
| `--rail-logo` | `#526f88` |

### Brand, mention and supporting accents

| Token | Value |
|---|---:|
| `--brand` | `#526f88` |
| `--brand-hover` | `#3d5874` |
| `--brand-contrast` | `#ffffff` |
| `--brand-soft` | `#e9eef3` |
| `--brand-ink` | `#405f7e` |
| `--mention-ink` | `#2f61c8` |
| `--mention-ink-hover` | `#244ea7` |
| `--mention-feedback` | `rgba(47, 97, 200, 0.08)` |
| `--mention-popover-portrait-scrim` | `rgba(32, 36, 56, 0.10)` |
| `--mention-popover-label-line` | `rgba(255, 255, 255, 0.45)` |
| `--mention-popover-label-surface` | `rgba(32, 36, 56, 0.34)` |
| `--aurora` | `#719d94` |
| `--aurora-soft` | `#e7f0ec` |
| `--violet` | `#9082b4` |
| `--violet-soft` | `#efebf6` |
| `--ember` | `#d3a45f` |
| `--ember-soft` | `#f8edda` |

### Semantic state

| Role | Foreground | Soft | Contrast |
|---|---:|---:|---:|
| success | `#3e775c` | `#e7f1ea` | `#ffffff` |
| attention | `#8a6226` | `#f8edda` | `#ffffff` |
| danger | `#a24c46` | `#f7e6e3` | `#ffffff` |
| info | `#416c86` | `#e5eef3` | `#ffffff` |
| neutral | `#5f6678` | `#ecefe9` | — |

`--approval-line` is `#d8bd87`; `--focus` is `#526f88`; `--focus-soft` is
`rgba(82, 111, 136, 0.16)`.

### Identity

| Token | Value | Token | Value |
|---|---:|---|---:|
| `--identity-1` | `#a65f4a` | `--identity-5` | `#4f729b` |
| `--identity-2` | `#39777a` | `--identity-6` | `#8a5c75` |
| `--identity-3` | `#74628f` | `--identity-7` | `#547245` |
| `--identity-4` | `#9a6a32` | `--identity-8` | `#8c6146` |

### Evidence and diff

| Token | Value |
|---|---:|
| `--inline-code-canvas` | `#eef2f5` |
| `--code-block-canvas` | `#eef2f5` |
| `--evidence-canvas` | `#f4f6f3` |
| `--evidence-surface` | `#ffffff` |
| `--evidence-ink` | `#252a36` |
| `--evidence-muted` | `#5f6678` |
| `--evidence-line` | `#d5dad3` |
| `--diff-add` / `--diff-add-soft` | `#137333` / `#e6f4ea` |
| `--diff-remove` / `--diff-remove-soft` | `#b3261e` / `#fce8e6` |
| `--diff-hunk-soft` | `#f3f4f4` |

### Overlay and lightbox

`--overlay` is `rgba(28, 32, 43, 0.42)` and `--shadow-float` is
`0 18px 56px rgba(38, 45, 58, 0.14)`. The lightbox uses `#10171d` surface,
`#f7fafb` ink, `rgb(255 255 255 / 18%)` line, `rgb(255 255 255 / 10%)` control and
`0 28px 80px rgb(0 0 0 / 42%)` shadow over `rgb(12 18 24 / 72%)`.

### Shared aliases and geometry

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

## Brand, semantic, identity, and evidence color rules

- `attention` is for pending user action or approval; warm `ember` is decorative and cannot replace it.
- `danger` is for stop, permanent deletion, forgetting and confirmed failure—not ordinary disabled state.
- Stable IDs map to `--identity-1..8`; identity color never signals state or permission.
- Evidence never inherits brand gradients, identity fills or portraits.
- Narrative inline code uses `--inline-code-canvas`; fenced code uses the bounded
  `--code-block-canvas` with its evidence border, while other evidence surfaces continue to use
  `--evidence-canvas`.

## Contrast requirements

Normal text must meet 4.5:1; focus, control boundaries and non-text state indicators must meet 3:1.
State cannot rely on color alone. Identity colors are tested on the production surfaces where they appear.

## Prohibited substitutions

Do not replace Steel with status colors, collapse eight identities to one Steel mark, use `--line` as the
sole control boundary, or restore the historical Arctic Dawn/Meridian palette.

## Implementation source

The `:root` block in [`styles.css`](../../../apps/desktop/src/renderer/src/styles.css) is the production
source. This document is a reviewable contract, not a second CSS source.

## Visual verification

Run the Renderer theme-token tests and the shared [theme matrix](../qa/theme-matrix.md), including
`1040×700`, `1440×920`, `2560×1440`, keyboard focus, 200% zoom and reduced motion.
