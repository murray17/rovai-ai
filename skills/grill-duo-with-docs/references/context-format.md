# Glossary format

```markdown
# <Context name>

<One or two sentences explaining its purpose.>

## Language

**Order**:
<One or two sentences defining the concept.>
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Choose one canonical term; list discouraged synonyms under `_Avoid_`. Define what a concept is, without a full behavioral specification or implementation. Include only project-specific domain concepts.

Use subheadings for natural clusters; keep one tight domain flat. For several contexts, root `CONTEXT-MAP.md` lists their locations and relationships, and each context owns its `CONTEXT.md`. Follow the project's document language.
