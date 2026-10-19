---
name: rovai-docs-governance
description: Use when adding or changing a Rovai Version Decision, Architecture, Contract, version document, documentation route, UI rule, or Markdown link. Keeps the single current-version pointer and versioned-contract model intact.
---

# Rovai Docs and Contract Governance

## Trigger

Use for any `docs/` change, `DESIGN.md`, `PRODUCT.md`, `AGENTS.md`, Skill
authoring, or a documentation-routing update.

## Read First

1. `docs/README.md` for the task route and authority boundaries.
2. `docs/decisions/README.md` for admission and the no-numbered-ADR rule.
3. `docs/versions/README.md` for the single `current_version` pointer and the
   version-transition checklist.
4. `docs/contracts/README.md` and `docs/architecture/README.md` for the owning
   document.

## Workflow

1. Classify the change: decision rationale, Architecture, Contract, current
   version scope, UI rule, development command, research evidence, or
   postmortem.
2. Put current semantics in the owning Architecture or accepted Contract, not
   only in a version document or decision record.
3. Contracts are immutable snapshots per version. Add `-vN.md`, link it from the
   predecessor and the index, and update current references. Do not silently
   rewrite an accepted contract.
4. `docs/versions/README.md` front matter owns `current_version`; the index row
   and version overview `lifecycle` are projections that must agree.
5. Do not create numbered ADR files. Historical version decisions are frozen
   except for typos, broken links, metadata, or explicit errata.
6. Keep Front Matter and relative links valid. Run both documentation gates.

## Verify

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<target-base-sha> pnpm docs:check:ci   # PR gate
pnpm skills:test && pnpm skills:check                # Skill changes
git diff --check
```

## Forbidden

- Multiple `current` versions or a hard-coded version path in `AGENTS.md`.
- Historical documents presented as current constraints.
- A Contract change without a versioned file and reference updates.
- Feature-specific checker exceptions or numeric ADR files.
