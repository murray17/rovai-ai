---
document_type: ui-theme
authority: renderer-theme
status: accepted
theme_id: steel-night
mode: dark
last_updated: 2026-08-25
---

# Steel Night

## Identity

- `theme_id`: `steel-night`
- Display name: `Steel Night`
- Runtime value: `ResolvedTheme = "night"`

## Mode

Dark. `color-scheme: dark`.

## Design intent

冷石墨表面与低饱和 Steel 为低光环境提供独立设计的亮度层级。Night 不是 Day 的算法反色，
也不恢复 Meridian Night；它在相同组件、状态、身份映射和信息架构上替换根 Token。

## Surface hierarchy

最深 Canvas 承载 rail 和主 surface，raised/input 再上提一级。会话与 Inspector 使用相邻但可辨的
石墨表面及强分隔线。普通内容保持平面，只有真正浮层使用更深阴影。

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
| `--conversation-find-match` | `#5a4725` |
| `--conversation-find-current` | `#845f23` |
| `--conversation-find-line` | `#d2ac70` |
| `--inspector-surface` | `#171d21` |
| `--conversation-inspector-line` | `#53616b` |
| `--home-surface` | `#181d21` |
| `--topbar` | `#151a1e` |
| `--input` | `#1b2227` |
| `--ink` | `#e7ecef` |
| `--muted` | `#abb5bc` |
| `--faint` | `#919da6` |
| `--line` | `#333e46` |
| `--line-strong` | `#53616b` |
| `--control-line` | `#687b88` |
| `--rail` | `#11161a` |
| `--rail-ink` | `#a6b1b8` |
| `--rail-line` | `#313b43` |
| `--rail-logo` | `#b1c8d8` |

### Brand, mention and supporting accents

| Token | Value |
|---|---:|
| `--brand` | `#7897ae` |
| `--brand-hover` | `#b1c8d8` |
| `--brand-contrast` | `#091116` |
| `--brand-soft` | `#22303a` |
| `--brand-ink` | `#c0d4e1` |
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

### Evidence and diff

| Token | Value |
|---|---:|
| `--inline-code-canvas` | `#1d252b` |
| `--code-block-canvas` | `#1d252b` |
| `--evidence-canvas` | `#12191d` |
| `--evidence-surface` | `#171f24` |
| `--evidence-ink` | `#dce4e9` |
| `--evidence-muted` | `#9eabb3` |
| `--evidence-line` | `#35424a` |
| `--diff-add` / `--diff-add-soft` | `#92c7a5` / `#1a2b22` |
| `--diff-remove` / `--diff-remove-soft` | `#e09a94` / `#321e1d` |
| `--diff-hunk-soft` | `#1b272a` |

### Overlay and lightbox

`--overlay` is `rgba(0, 0, 0, 0.58)` and `--shadow-float` is
`0 22px 64px rgba(0, 0, 0, 0.42)`. The lightbox keeps `#10171d` surface,
`#f7fafb` ink, `rgb(255 255 255 / 18%)` line, `rgb(255 255 255 / 10%)` control and
`0 28px 80px rgb(0 0 0 / 52%)` shadow over `rgb(3 7 10 / 84%)`.

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

## Brand, semantic, identity, and evidence color rules

The same semantic separation as Day applies. Brightened identity colors retain stable ID mapping;
they do not become statuses. Evidence and diffs remain neutral and structurally labeled. Narrative
inline code uses `--inline-code-canvas`; fenced code uses the bounded `--code-block-canvas` with its
evidence border, while other evidence surfaces continue to use `--evidence-canvas`.

## Contrast requirements

Normal text must meet 4.5:1; focus, control boundaries and non-text state indicators must meet 3:1.
All semantic labels and eight identity tokens are verified on their production Night surfaces.

## Prohibited substitutions

Do not mechanically invert Day, reuse Meridian Night, reduce the palette to monochrome Steel, or
add dark-only component markup and behavior.

## Implementation source

The `:root[data-theme="night"]` block in
[`styles.css`](../../../apps/desktop/src/renderer/src/styles.css) is the production source. Tokens not
overridden there intentionally inherit shared geometry and aliases from `:root`.

## Visual verification

Run the Renderer theme-token tests and the shared [theme matrix](../qa/theme-matrix.md), including
first-paint system resolution and switching themes while Draft, focus, selection and overlays are active.
