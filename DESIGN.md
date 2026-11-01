---
name: Rovai AI
description: A quiet, evidence-first desktop workspace for human and agent collaboration.
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
rounded:
  control: "6px"
  surface: "10px"
  dialog: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
---

# Design System: Rovai AI

## Overview

Use compact desktop controls, open reading surfaces, aligned rows and restrained decoration.
All registered palettes share one component tree, interaction model and state matrix.
Use [UI routing](docs/ui/README.md) for component contracts, surface briefs and verification.

### Brand mark

- Preserve the separated four-point star and curved horizon; reuse the production assets.
- The App icon uses its fixed charcoal carrier, Steel horizon and Porcelain star, without a rendezvous point.
- In-app marks omit the carrier and use `--rail-logo` with the `--ember` rendezvous point.
- Brand geometry and colors do not express status, selection, identity or approval.

## Colors

Complete palettes and mode mappings belong to the [theme registry](docs/ui/themes/README.md);
production values live in [theme.css](packages/ui/src/theme.css). Use semantic variables; do not
add component-level theme colors, automatic inversion or theme-specific markup.

| UI role | Token / rule |
|---|---|
| Solid primary action | `--conversation-action`, `--conversation-action-hover`, `--conversation-action-contrast` |
| Action text and selected control marks on a surface | `--conversation-action-ink`; ordinary labels use `--ink` |
| Ordinary functional icons | Inherit control text via `currentColor`: `--ink`, `--muted` or `--faint` for ordinary controls; contrast foreground for solid buttons |
| Checked checkbox, radio, switch and range accent | Current theme action family; never the OS default accent, `--brand`, `--workspace-steel` or `--focus` |
| Navigation and row selection | Quiet selection surfaces and neutral text, no colored left stripe; retain selection independently of hover |
| Brand | `--brand` / `--brand-*`, `--rail-logo`, `--ember`; only for an explicitly assigned brand role |
| Semantic state | Dedicated success, attention, danger and info tokens plus text, icon or shape |
| Identity | Eight stable `--identity-*` tokens; never state or selection |
| Evidence and Diff | Dedicated evidence, code and diff tokens; preserve signs and line numbers |
| Scrollbar | `--scrollbar-thumb`; preserve the documented Memory/Automation override |

- Apply the same control rules inside Portal-mounted menus, dialogs and sheets. Do not depend on a page-local alias reaching a Portal.
- Action colors follow the selected palette; do not describe them as always black, white or neutral.
- Blue/Steel is not the default icon color or background. Semantic icons and documented component feedback keep their assigned tokens.
- Memory content, notices and dialogs use the achromatic `--memory-*` family, including local actions. Its shared navigation keeps the selected App theme.
- Preserve dedicated component tokens for reading surfaces, links, search matches and Runtime configuration; do not replace them with a generic accent.

## Typography

- Use the production system sans-serif stack; add no downloaded font.
- Body text is normally 12.5–13px with 1.6–1.7 line height; secondary copy is at least 10.5px.
  Smaller type is limited to short, contrast-safe metadata.
- Use monospace for commands, paths, timestamps, IDs and evidence.
- Establish hierarchy with size, weight, spacing and alignment before color.
- Follow the [conversation](docs/ui/components/conversation-workspace.md) and
  [file preview](docs/ui/components/file-preview.md) contracts for prose/artifact widths and reading preferences.

## Layout

- Desktop: default 270px navigation, 50px top row (38px in Thread), flexible content.
  Navigation sizing, collapse and platform-specific settings layout follow
  [App Shell](docs/ui/components/app-shell-navigation.md#调宽与完全折叠).
- Use the `4 / 8 / 12 / 16 / 20 / 24 / 32px` spacing rhythm and stable alignment axes.
- Keep narrative text aligned; wide artifacts may expand independently. Composer and its route rail share one centered track.
- Avoid page-level horizontal scrolling. Desktop checks cover `1040×700`, `1440×920`, `2560×1440` and 200% zoom.
- Mobile reflows the same data and actions; use the [Mobile contract](docs/ui/host-web-mobile.md) for sheets, navigation and touch controls.

## Elevation & Depth

- Establish depth with canvas, surface, raised surface and dividers.
- Ordinary messages, lists, cards and Inspector content have no shadow.
- Use `--shadow-float` and its aliases only for actual overlays, menus, dialogs and floating approval surfaces.
- Prefer open sections and separators; use a card only for a bounded object, decision or independent state.

## Shapes

- Controls: 5–8px radius; work surfaces: 9–11px; dialogs: 12–13px.
- Pills are for short statuses, filters and identity metadata; circles are for portraits, small status dots and bounded icon controls.
- Use `--line` for separators, `--line-strong` for structure and `--control-line` for interactive boundaries.
- Dialog fields use `--dialog-field-line` / `--dialog-field-line-hover`; higher-contrast modes retain a visible control boundary.

## Components

- **Buttons:** primary actions use the action family; secondary and workspace creation entries use quiet tonal surfaces.
  Destructive actions use `--danger-soft` and `--danger`. Mission Worktree cleanup keeps its documented ordinary action treatment.
  Preserve existing pressed behavior; fixed-position controls must not shift their hit area. Disabled labels remain legible.
- **Inputs and selection:** use the input surface and visible labels.
  Keep DOM focus, caret, IME and keyboard navigation without extra focus rings, glow, focus-only borders or search underlines.
- **Splitters:** use one 1px boundary; hover/drag changes it to `--resize-line` without thickening or a short grip.
  Preserve wide hit areas, keyboard resizing, reset, cancellation and final-pointer coordinates under zoom.
  Collapsible panes stop at minimum width; dragging another 64px folds immediately during the gesture over 160ms.
  Reverse 24px to reopen within the same gesture; reduced motion skips animation.
  Escape restores the prior layout; pointer interruption, blur and container resize settle the last position.
  Scope changes discard stale gestures; a drag-generated click never resets width.
  Keep each surface's dimensions and persistence in its component contract or brief.
- **Preview expansion:** file, execution and activity use the shared 28px header control and 15px two-corner glyph.
  Expansion hides the conversation flush to navigation; restore with the same control or Escape. Preserve mounted content, drafts and reading positions.
- **Dialogs and Popovers:** one raised surface, 1px boundary, single title, muted regular-weight labels and no colored top stripe.
  Keep common fields visible; optional disclosure preserves drafts and validation. Footers contain actions and necessary status only.
  Preserve modal focus trapping and Esc; use the surface's documented focus return, otherwise suppress automatic trigger refocus.
- **Messages and code:** retain production bubble geometry, spacing and same-color bubble borders.
  Use shared SafeMarkdown and the dedicated conversation code tokens; release notes retain shared defaults.
- **Identity:** preserve portraits and stable identity markers; do not spread identity colors into surrounding surfaces.

Page composition belongs in [surface briefs](docs/ui/README.md#页面局部-brief); complex interactions belong in
[component contracts](docs/ui/components/README.md). Do not duplicate their state machines here.

## Do's and Don'ts

- **Do** cover Loading, Empty, Partial, Error, Disabled, Submitting and Recovery with real read-model facts.
- **Do** preserve drafts, selection, scroll and focus on failures and theme changes.
- **Do** keep labels direct; show explanations only when needed to choose, resolve a problem or understand an unavailable action.
- **Do** use the established terms 队员、记忆、智能体、快速对话.
- **Don't** add decorative gradients, glow, particles, role-colored message bubbles, card walls or global `transition: all`.
- **Don't** invent progress, approvals, capabilities or recovery certainty.
- **Don't** introduce a new UI framework, CSS-in-JS layer, font, icon system, animation library or state manager for an incremental change.
