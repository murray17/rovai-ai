---
document_type: ui-theme-template
authority: renderer-theme-process
status: template
last_updated: 2026-08-13
---

# Theme display name

> Copy this file; do not edit it into a production theme. A new theme requires explicit product and
> runtime-contract review.

## Identity

- Stable `theme_id`:
- Display name:
- Runtime mapping:
- Relationship to the established Rovai AI visual world:

## Mode

`light` or `dark`, including intended `color-scheme`.

## Design intent

State the confirmed visual intent and anti-references without inventing product behavior.

## Surface hierarchy

Describe Canvas, surface, raised/input, conversation, Inspector and rail levels.

## Complete semantic token assignments

Provide every canonical theme token: surfaces, text, structure, brand, mention, supporting accents,
semantic states and contrasts, focus, overlay/shadow, eight identity colors, evidence/diff and lightbox.

## Brand, semantic, identity, and evidence color rules

Explain their separation and any theme-specific accessibility constraint.

## Contrast requirements

Record measured WCAG 2.2 AA results for text, controls, focus, semantic labels and all identity colors
on their actual surfaces.

## Prohibited substitutions

List rejected automatic conversions, legacy palettes and component-level theme branches.

## Implementation source

Link the canonical production Token block and tests.

## Visual verification

Run every row in [the shared theme matrix](../qa/theme-matrix.md) on the same components, states and
features as existing themes. Include first paint, runtime switching, 200% zoom and reduced motion.
