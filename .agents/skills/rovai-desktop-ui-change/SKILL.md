---
name: rovai-desktop-ui-change
description: Use when changing the Rovai Electron Renderer, preload bridge, Main-process window behavior, Composer, file preview, settings, themes, or desktop layout. Enforces the established design world, structured IPC, isolated userData, and focused Electron fixtures.
---

# Rovai Desktop UI Change

## Trigger

Use for `apps/desktop/src/renderer`, `preload`, `main`, desktop CSS, native
window behavior, visual acceptance, or a Renderer-facing contract.

## Read First

1. `DESIGN.md` and `docs/ui/README.md`.
2. The matching `docs/ui/components/<surface>.md` and, when present,
   `apps/desktop/.impeccable/surfaces/<surface>.md`.
3. `docs/development/local-workflow.md` and `docs/development/ui-acceptance.md`.
4. The owning Contract when the change crosses IPC or persistence.

## Workflow

1. Identify the owning surface and search for an existing component, hook, or
   CSS token before adding a new one. `ThreadWorkspace.tsx` is large; reuse its
   subcomponents rather than creating a parallel workspace.
2. Keep the trust chain explicit: Renderer -> preload -> Main. Never expose
   Node, filesystem, credentials, or raw Core clients directly to Renderer.
3. Return structured success and rejection values across the bridge. Do not
   encode failures as silent `undefined` or string-only errors.
4. Share types through `packages/contracts` and visual primitives through
   `packages/ui`; do not fork a second contract shape.
5. Preserve the established Rovai visual world, both themes, responsive
   layouts, focus behavior, and keyboard paths.
6. Run the focused fixture for the surface, then typecheck. Run
   `pnpm build:desktop` when Main, preload, packaging, or window behavior changes.

## Common Fixtures

```bash
pnpm test:desktop-bridge
pnpm test:composer-input
pnpm test:file-preview-layout
pnpm test:message-anchors
pnpm test:settings-workspace
pnpm test:navigation-shell
pnpm test:startup-presentation
```

## Forbidden

- Importing Electron or Node APIs into Renderer code.
- Bypassing preload with a broad generic IPC passthrough.
- Hard-coded colors or a replacement design system.
- Running the daily App, daily `userData`, `dist/`, or bare `electron-vite dev`.
- Installing Impeccable hooks/plugins or mutating host configuration.

## Verify

```bash
pnpm typecheck
pnpm test:<focused-surface>
pnpm build:desktop   # only when the desktop envelope changes
```
