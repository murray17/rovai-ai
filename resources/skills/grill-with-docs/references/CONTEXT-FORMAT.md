# CONTEXT.md Format

Use the repository's existing glossary format when one exists. Otherwise use:

```md
# {Context Name}

{One or two sentences describing the context.}

## Language

**Order**:
{A tight one- or two-sentence definition.}
_Avoid_: Purchase, transaction
```

Rules:

- Pick one canonical term and list misleading alternatives under `_Avoid_`.
- Define what a concept is, not its implementation.
- Keep definitions to one or two sentences.
- Include only domain-specific language, not general programming vocabulary.
- Group terms only when natural clusters emerge.

If `CONTEXT-MAP.md` exists, use it to locate the correct bounded context before editing.
