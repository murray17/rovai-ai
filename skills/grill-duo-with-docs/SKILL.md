---
name: grill-duo-with-docs
description: Clarify a plan or design with one fixed Thread reviewer while maintaining confirmed domain language, current specifications and version decisions. Applies to the initiator and invited reviewer during that exchange; excludes solo questions, group debates and questioning without documentation work.
---

# Grill Duo with Docs

The initiator questions and maintains documents; one fixed partner independently advises without editing project documents. Investigate facts available from code, authoritative documents, tools, current input or Thread history. Ask the user for real choices. Use the user's language.

## Roles and partner

Use trusted sender identity, the triggering request and direct replies. A user start/answer or the current partner's direct reply to the valid invitation resumes the initiator. A direct request for this documentation variant makes you its reviewer only. Plain Grill Duo, old, invalid and late replies cannot advance, roll back or reopen this exchange.

Choose a relevant, available Thread partner other than yourself; address a trusted Agent ID and keep them throughout. Change only at the user's request, departure/unavailability, or a shift beyond their useful expertise; explain why. With none available, disclose solo questioning and keep the same round and documentation rules.

## One open round

1. Prepare 1-4 independent questions with established prerequisites, numbered `Q1`-`Q4`; defer dependent questions.
2. Send the goal, confirmed facts, options, constraints and affected documents to the partner without your recommendation.
3. The partner returns one recommendation, main reason and risk per original number. They do not delegate, add questions or edit project files.
4. Present all open questions together, including tradeoffs, your recommendation, the partner's view, disagreements and affected documents. Ask the user to answer by number.
5. Maintain only confirmed content. Close questions when answered, cancelled or invalidated; start another round only after all close.

Keep unanswered questions, numbers and advice. Add no new questions mid-round. For a changed question, retain its number and re-review only that item; accept only a direct reply to the updated invitation. Partial answers confirm only the answered portion.

## Messages

- Request: `rovai send --to <partner-agent-id> --body <questions>`.
- Advice: `rovai send --to <requester-agent-id> --body <advice>`.
- User questions/final confirmation: `rovai send --public-only --to-user --body <questions-or-summary>`.

After dispatch, finish other current inputs and end while waiting. Follow CLI recovery on failure; do not blindly resend.

## Confirmed documentation

The initiator reads [Domain modeling](references/domain-modeling.md), [Glossary format](references/context-format.md) and [Decision routing](references/decision-routing.md) as needed. The partner need not load these authoring rules.

For each confirmed decision, determine whether to update domain vocabulary, Architecture, Contract, current-version decisions, implementation/acceptance notes, or no durable document. Apply repository rules. Unanswered, ambiguous or partner-only advice is not a confirmed fact. Do not create numbered ADR files.

When no important questions remain, summarize confirmed decisions, constraints, risks, document changes and nonblocking unknowns. Obtain the user's confirmation of the shared understanding before product implementation, then close the exchange. Unrelated messages and completed exchanges do not restart it.
