---
document_type: prototype-index
authority: prototype-routing
last_updated: 2026-08-23
---

# Prototypes

`docs/prototypes/` contains static interaction studies, visual alternatives and review artifacts.
A prototype can make a design easier to discuss, but it is never a production fact, a domain
contract or proof that an interface has been implemented.

Current requirements must be read from Architecture, Contracts, `DESIGN.md`, `docs/ui/`, the current
version scope, production code and reproducible acceptance evidence.

## Lifecycle

| Status | Meaning |
| --- | --- |
| `current-review-artifact` | Explicitly linked by a current UI, Architecture or current-version document for an active review. |
| `superseded` | Useful design history, but replaced by a later prototype, current contract or production implementation. |
| `archived` | Historical reference retained under [`archive/`](archive/README.md); it must not guide new implementation. |

A directory without an explicit current link or status should be treated as a
`superseded` candidate, not as current product authority.

## How to use this directory

- Start from [`docs/ui/README.md`](../ui/README.md) for current Renderer work.
- Follow direct links from current Architecture, Contracts or the unique current version.
- Open prototype HTML locally only for design review; sample data and interactions are not product evidence.
- When production contracts replace a prototype, move the artifact to `archive/` or add an explicit
  supersession notice in the same change.
- Keep synthetic fixtures explained. Opaque payloads without a documented format or purpose should
  not remain in an active prototype directory.

## Archive

Historical artifacts are indexed in [`archive/README.md`](archive/README.md). The attachment
composer study was archived after the current attachment and Composer contracts superseded its open
questions.
