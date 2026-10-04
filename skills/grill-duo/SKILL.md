---
name: grill-duo
description: Clarify or stress-test a plan, requirement, design or decision through user questions and one fixed Thread partner's independent review. Applies to the initiator and invited reviewer during that exchange; use grill-duo-with-docs when confirmed project documentation must also be maintained.
---

# Grill Duo

The initiator asks questions; one fixed partner reviews independently. Investigate facts available in code, authoritative documents, tools, current input or Thread history. Ask the user for genuine choices. Use the user's language.

## Roles and partner

Use trusted sender identity, the triggering request and direct replies:

- A user start/answer or the current partner's direct reply to the valid current invitation resumes the initiator.
- A direct Grill Duo review request makes you the partner for that request only.
- Old, invalid or late replies are supplementary; they cannot advance, roll back or reopen the exchange.

Choose a relevant partner who is not you, remains in the Thread and can receive work. Address a trusted Agent ID. Keep that partner unless the user requests a change, they leave or become unavailable, or the topic moves beyond their useful expertise; explain a change. With none available, disclose solo questioning and keep the same round rules.

## One open round

1. Prepare 1-4 independent questions with established prerequisites, numbered `Q1`-`Q4`. Defer questions that depend on this round's answers.
2. Send the partner the goal, confirmed facts, options and constraints, without your recommendation.
3. The partner returns one reply with a recommendation, main reason and risk for each original number. They do not delegate, add questions, decide for the user or implement.
4. Present all open questions to the user together: choices, tradeoffs, your recommendation and the partner's view, including disagreements. Ask for answers by number.
5. Close each question only when answered, cancelled or invalidated. Start the next round after all current questions close.

Keep unanswered questions, numbers and existing advice unchanged. Add no new questions mid-round. If the user changes a question, options or constraints, keep its number and re-review only that question; accept only a direct reply to the updated invitation. Partial answers close only the answered items.

## Messages and completion

- Partner request: `rovai send --to <partner-agent-id> --body <questions>`.
- Partner response: `rovai send --to <requester-agent-id> --body <advice>`.
- User questions or final confirmation: `rovai send --public-only --to-user --body <questions-or-summary>`.

After dispatch, finish other current inputs and end while waiting for the reply. Follow CLI recovery on failure; do not blindly resend.

When no important questions remain, summarize the goal, decisions, constraints and major risks. Obtain the user's confirmation of that shared understanding before implementation, then close the questioning exchange. Solo questions, group debates, unrelated messages and closed exchanges do not start this workflow.
