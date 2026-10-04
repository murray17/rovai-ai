# Host a Campfire

## Start and invite

Start only from the user's direct request to the current Default Lead. Establish the topic, desired output, named members or perspectives, and that you have no other unfinished Campfire. A replacement topic closes the old discussion.

Choose 2-3 present, available contributors, normally 3. Prefer the user's choices, relevant responsibilities and complementary experience; address trusted Agent IDs from Collaboration State. With fewer than two, explain the fallback or stop. The Lead hosts without adding a recommendation unless the user requests one.

Send one message per round with repeated `--to`:

```text
rovai send --to <agent-a-id> --to <agent-b-id> --body <round-request>
```

For round 1, include the user's original topic, confirmed shared facts, each member's perspective, and the member reply contract in `SKILL.md`. Include no host recommendation. A compact request is sufficient:

```markdown
### Campfire: independent views
Topic: <preserve the user's wording>
Shared facts: <confirmed facts, or none>
Perspectives: <member and assigned perspective>
Task: <reply contract; return one complete result to the requester>
```

After successful dispatch, finish other current inputs and end the Run. Resume when replies arrive; do not poll, chase, acknowledge or resend the round.

## Evaluate replies

Use only complete, direct answers from this round's invited members. Progress, acknowledgements, vague text and errors are not valid views. Process unrelated batch inputs normally; no extra reply ledger is needed.

Wait for all invited replies before drawing the round's conclusion, unless the user requests early closure or a member has clearly failed or left. Then:

- Two or more valid views: distinguish consensus from wording differences and factual, predictive, boundary or value disagreements.
- One valid view: publish partial notes stating that no effective group discussion formed.
- None: publish a termination explanation.

A second round is justified only by one disagreement that would materially change the conclusion, recommendation or applicability. Otherwise publish [Notes](notes.md).

## Optional response round

Recheck Collaboration State before starting round 2. If you are no longer Default Lead, synthesize and close instead. The original host always completes the current discussion; it does not transfer automatically to the new Lead.

Invite the two members closest to the disagreement, or one when only one side needs to clarify. Include the original topic, each member's core position and main reason, the single disagreement, individual response tasks, and the reply contract. Do not copy the full first-round record.

```markdown
### Campfire: focused response
Topic: <original topic>
Positions: <member: core position and main reason>
Disagreement: <one question that changes the conclusion>
Tasks: <member: specific response>
Reply: <retain, revise or qualify the judgment; follow the reply contract>
```

After replies or permitted early closure, use each complete updated position. Retain the confirmed round-1 position for nonparticipants or failed/incomplete responders, marking the latter incomplete. Mark unknowns explicitly; never supply a missing view. Publish notes and close, even if Lead status changed during this round.

At any point, honor user interruption. A stop or replacement makes old results ineligible to restart the old discussion.
