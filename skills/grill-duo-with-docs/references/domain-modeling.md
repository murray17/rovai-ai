# Domain modeling

Follow repository navigation first. If root `CONTEXT-MAP.md` exists, locate this topic's context and `CONTEXT.md`; otherwise use root `CONTEXT.md`. Find relevant Architecture/Contract documents and the unique current version. Create missing documents only after the first relevant content is confirmed.

During discussion:

- Compare the user's terms with the glossary. Surface a conflict and ask whether to retain the meaning or create a distinct concept; resolve it first if other questions depend on it.
- Replace vague or overloaded language with precise canonical terms. One term should not represent several concepts.
- Use concrete boundary cases to test ownership, relationships and lifecycle.
- Check claimed behavior against code and current authority. Show contradictions and let the user decide whether the model or implementation should change.
- Record confirmed terms promptly using [Glossary format](context-format.md). Keep drafts, implementation detail and full specifications out of `CONTEXT.md`.

For durable choices, follow [Decision routing](decision-routing.md) and the project's admission rules. Record rationale only when warranted, and update current semantics in the owning document at the same time.
