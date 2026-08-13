# Rovai AI 2K workspace prototypes

## Purpose

This prototype explores deliberate `2560×1440` adaptations for Renderer surfaces that currently
remain narrow and centered. It is a design study, not implementation evidence and not a replacement
visual world.

## Source of truth

- Root `DESIGN.md`: Porcelain Day / Steel Night, compact desktop density, fixed 270px rail,
  token-only themes, quiet structure and semantic color separation.
- `docs/ui/README.md`, theme contracts, accessibility baseline and App Shell contract.
- Surface briefs for Memory, Members and Settings.
- Current Renderer components and copy. Sample values are explicitly marked as prototype snapshots;
  the prototype does not read Core, SQLite, Runtime, MCP or the local filesystem.

## Selected surfaces

1. **Quick Chat home** — use 2K space to expose recent work without inventing a dashboard. The
   primary action remains “新对话”; the page still has no Composer.
2. **Memory** — restore the specified list/detail split and use a controlled 1600px work stage. The
   catalogue stays bounded while details gain a governance/evidence side column.
3. **Member workspace** — keep roster navigation stable and turn the detail page into a readable
   identity canvas with profile content, portrait and a narrow facts/actions column.
4. **Agent Runtime** — widen only this data-dense Settings category. Show the complete nine-product
   catalogue in two open columns, with one state and next action per row.
5. **Diagnostics** — keep summary evidence full-width, then use a 480px issue lane beside the full
   results/evidence lane. There is no “repair all”.

## Layout strategy

- App shell remains `270px + minmax(0, 1fr)`.
- The hidden macOS title bar remains native chrome: traffic lights use the production `x: 12`,
  `y: 14` inset, while the rail reserves the same 38px draggable strip above its brand row.
- At `>= 1800px`, dense workspace stages become `min(1600px, available width - 96px)`.
- Ordinary text remains around `65–76ch`; widening reveals simultaneous panes rather than longer
  prose.
- At the regular desktop comparison mode, stages contract to the incumbent hierarchy; Memory and
  Diagnostics become single-column when their container can no longer preserve both panes.
- No page-level horizontal scrolling at the prototype's two comparison modes.

## Interaction model

- The top prototype bar switches the design viewport, theme and page. It is outside the depicted
  product and exists only for comparison.
- The depicted macOS traffic lights report prototype feedback on click; only the packaged App's
  native controls close, minimise or zoom a real window.
- Quick Chat filters recent work and can locally mark a row opened.
- Memory supports scope/governance/search, row selection, proposal drawer, revision disclosure and
  a destructive confirmation. Local actions never claim a Core write.
- Members support roster selection and identity/runtime tabs.
- Runtime supports local state filtering and a simulated checking state.
- Diagnostics supports result filtering, details disclosure and one bounded simulated repair.
- Toasts report only local prototype behavior.

## Visual rules

- One component tree for Day and Night, driven by semantic tokens.
- Steel is structural and interactive, not success or health.
- Identity color is confined to avatars and names.
- Evidence uses neutral evidence surfaces and monospace only for commands, timestamps, stable IDs
  and diagnostic codes.
- Ordinary rows and sections are open planes with dividers, not a wall of cards.
- Floating shadow is limited to the proposal drawer and confirmation dialog.

## Non-goals

- No production React/CSS is changed.
- No invented Runtime availability, diagnostic health, persistence result, Memory rationale,
  confidence score or automatic policy is presented as fact.
- New Conversation remains a fixed-size dialog by contract and is not redesigned for 2K.
- Camp already has a dedicated 2K composition and is therefore not duplicated here.

## Verification target

- Local browser interaction at `1440×920` and `2560×1440` design viewports.
- Porcelain Day and Steel Night.
- Keyboard focus visibility, reduced motion, no document-level overflow and no clipped primary
  actions.
