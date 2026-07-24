# Domain Modeling

Actively build and sharpen the project's domain model while designing. Challenge terms, invent
edge-case scenarios, cross-reference claims with code, and record glossary terms and decisions
when they crystallize.

## Repository structure

Most repositories use one root `CONTEXT.md` and `docs/adr/`. If `CONTEXT-MAP.md` exists, use it to
locate multiple bounded contexts and their local glossary or ADR directories. Create files lazily:
only when there is a resolved term or decision to record.

## Working rules

### Challenge the glossary

When the user uses a term that conflicts with the existing glossary, call out the conflict and ask
which meaning is authoritative.

### Sharpen fuzzy language

When a word is vague or overloaded, propose one precise canonical term and distinguish adjacent
concepts.

### Test concrete scenarios

Invent edge cases that force relationships, ownership, lifecycle, recovery, and failure semantics
to become explicit.

### Cross-reference code

Check claims against the repository. Surface contradictions between the proposed model and current
behavior instead of silently choosing one.

### Update the glossary inline

When a term is resolved, update the repository's glossary immediately. A glossary defines domain
language; it is not an implementation spec, scratchpad, or task list.

### Create ADRs sparingly

Create or offer an ADR only when all three are true:

1. The decision is meaningfully expensive to reverse.
2. A future reader would find the choice surprising without context.
3. Real alternatives were considered and rejected for specific reasons.

Repository-specific ADR policy and templates always take precedence.
