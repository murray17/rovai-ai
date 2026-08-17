---
name: Rovai AI
description: A quiet, evidence-first desktop workspace for human and agent collaboration.
colors:
  steel-day: "#526f88"
  steel-night: "#7897ae"
  porcelain-canvas: "#eceeef"
  porcelain-surface: "#fbfbfa"
  graphite-canvas: "#0d1114"
  graphite-surface: "#151a1e"
  ink-day: "#171b20"
  ink-night: "#e7ecef"
  ember-rendezvous: "#d3a45f"
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

**Creative North Star: “Porcelain Day / Steel Night.”**

Rovai AI is a dense but calm desktop workspace: porcelain and graphite surfaces provide quiet
structure while evidence, responsibility and user decisions remain easy to inspect. Porcelain Day
and Steel Night are two implementations of the same visual world and the same component tree—not
separate products.

The interface favors open reading planes, aligned rows and restrained Steel accents. It does not
use decoration to soften or obscure commands, diffs, approvals, errors or uncertain recovery.

**Key characteristics:**

- neutral surfaces with low-frequency Steel structure;
- compact desktop density and stable information hierarchy;
- identity, status, evidence and brand colors kept semantically separate;
- one shared component and state matrix across both themes.

## Brand Mark

The canonical Rovai mark is a four-point star held above a curved horizon. The star means direction;
the horizon means a shared world and a common plane for collaboration. Their deliberate gap keeps
both ideas legible at Dock and rail sizes. Both shapes remain present in production brand lockups—the
four-point star alone is not the Rovai brand mark.

The theme-independent App icon uses a deep charcoal carrier that descends from `#2b2b2c` through
`#1a1a1b` to `#0c0c0d`, a Steel horizon (`#7897ae`) and a Porcelain star (`#e7ecef`), with no outline
around the carrier. Its star-to-horizon gap remains pure negative space: the App icon does not
include a rendezvous point. Compact in-app marks omit the carrier, render the separated
star-and-horizon geometry in `--rail-logo`, and place an Ember rendezvous point (`--ember`) at the
center of the horizon. Day and Night keep one silhouette while using their own contrast-safe Steel
and Ember values. The rendezvous point is brand geometry and never indicates status, identity,
approval or evidence.

## Colors

The canonical values live in [Porcelain Day](docs/ui/themes/porcelain-day.md) and
[Steel Night](docs/ui/themes/steel-night.md). Components consume semantic CSS variables; they do
not own theme-specific colors.

### Named rules

**The Token-Only Theme Rule.** Components use semantic tokens and must not add theme-specific hex
values or `theme === "night"` color branches.

**The Identity Is Not Status Rule.** Stable identity colors distinguish a person, Skill or MCP
server; they never mean running, healthy, approved, dangerous or selected.

**The Evidence Stays Neutral Rule.** Commands, paths, tool output, JSON and diffs use evidence
tokens. Brand washes, portraits and identity fills do not enter evidence surfaces.

**The Same Surface Rule.** Every production theme covers the same pages, controls, capabilities and
states. `system` is a preference resolver, not a third theme.

## Typography

The body stack is the platform-native sans-serif stack declared in `styles.css`; no downloadable
font is required. Monospace is reserved for commands, paths, timestamps, stable IDs, short status
values and evidence.

- Body copy is normally 12.5–13px with 1.6–1.7 line height.
- Secondary text is not smaller than 10.5px. Smaller type is limited to short metadata that still
  meets contrast requirements.
- Narrative prose is bounded at `76ch`; code, tables and other artifacts may grow to `930px`; the
  shared wide conversation track remains `1040px`, while Composer reaches `1440px` at viewports
  `>= 1800px`.
- Weight, size, placement and whitespace establish hierarchy before color does.

## Layout

The desktop shell uses a fixed 270px navigation rail, a 50px top row and a flexible content column.
The minimum supported window is `1040×700`; reference checks also cover `1440×920` and
`2560×1440`, 200% zoom and reduced motion.

Spacing follows the existing `4 / 8 / 12 / 16 / 20 / 24 / 32px` rhythm. Content stays aligned to
stable axes. Ordinary conversation prose and the message copy affordance share a content track;
Composer uses an independent centered track, with its route rail and input box kept equal-width and
coaxial. Wide artifacts may expand without moving narrative text. The whole app must not acquire a
horizontal scrollbar.

## Elevation & Depth

Depth is tonal and structural by default. Canvas, surface, raised surface, selection and strong
divider tokens describe most hierarchy. Ordinary cards, messages, lists and the Inspector have no
shadow.

The sole general floating elevation is `--shadow-float`: `0 18px 56px rgba(38, 45, 58, 0.14)` in
Day and `0 22px 64px rgba(0, 0, 0, 0.42)` in Night. Menus and dialogs alias that token. Use it only
for genuine overlays such as Dialogs, Popovers and fixed approval surfaces.

**The Quiet Structure Rule.** Prefer surface levels, dividers and selection rails over nested cards
and ambient shadows.

## Shapes

Controls use compact 5–8px radii, work surfaces typically use 9–11px and dialogs use 12–13px.
Pills are reserved for terse status, filters and identity metadata; they do not wrap paragraphs.
Circular shapes are reserved for portraits, small status dots and bounded icon controls.

Borders are semantic: `--line` separates, `--line-strong` establishes structure and
`--control-line` makes interactive boundaries perceivable. A pale decorative line must not be the
only boundary of an input or control.

## Components

- **Buttons:** compact, direct and text-first. Primary actions use Steel; danger is reserved for
  destructive outcomes. Active buttons move down 1px; disabled controls retain legible content at
  reduced opacity.
- **Inputs:** use the raised/input surface and a perceivable control boundary. Focus is a 2px
  `--focus` outline with 2px offset, or the equivalent tokenized inner treatment where geometry
  requires it.
- **Navigation:** rows and short 2px selection rails establish location. Hover is supplementary;
  selected state and actions remain understandable from text, placement and focus.
- **Containers:** prefer one open surface with dividers over card walls. A card is justified only
  when it represents a bounded object, decision or independent state.
- **Dialogs and Popovers:** raised neutral surface, strong boundary and restrained Steel top/edge
  accent. Semantic danger or attention may replace the accent when meaning requires it.
- **Evidence:** uses the dedicated evidence and diff tokens, monospaced type where appropriate, and
  structural `+`/`-`, line numbers or labels in addition to color.
- **Identity:** portraits and eight stable identity tokens are a narrow exception to the neutral
  workspace. Identity treatments do not spread into background decoration.

Rovai-specific interaction contracts are indexed in
[UI components](docs/ui/components/README.md); page-local composition belongs in
`apps/desktop/.impeccable/surfaces/`.

## Do's and Don'ts

### Do

- **Do** keep the two themes on one component tree and one state matrix.
- **Do** preserve readable evidence, uncertainty and the next user action.
- **Do** combine state color with text, icon, shape or stable position.
- **Do** use the established product terms “队员”, “记忆”, “Agent 运行时” and “快速对话”.
- **Do** implement Loading, Empty, Partial, Error, Disabled, Submitting and Recovery states for
  primary surfaces.

### Don't

- **Don't** reintroduce Meridian, the historical Arctic Dawn palette or automatic color inversion.
- **Don't** create role-colored message bubbles, card walls, gradients, glow, particles or global
  `transition: all`.
- **Don't** use Steel as a substitute for success, attention, danger, evidence or identity.
- **Don't** invent progress, approval options, Runtime capability or recovery certainty that the
  authoritative read model does not provide.
- **Don't** introduce a new UI framework, CSS-in-JS layer, font, icon system, animation library or
  state manager for an incremental Renderer change.
