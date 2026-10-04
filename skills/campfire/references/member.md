# Contribute to Campfire

Only the current Default Lead may start a discussion from the user's direct request.

On a user broadcast, all-members mention, or call that also reaches the Lead or several members, end without publishing a view or control message. If the Runtime requires final text, say in the user's language: "Waiting for the Default Lead to start the discussion."

If the user addresses only you and asks for a group discussion, explain that they should request it directly from the current Default Lead; do not forward a request on their behalf.

## Answer a formal invitation

Handle this discussion's requests in the current batch; process other inputs normally. Use the Runtime's trusted requester Agent ID, not a guessed display name. Send the complete result once to that requester:

```text
rovai send --to <requester-agent-id> --body <complete-result>
```

Follow the reply contract in `SKILL.md`. Follow CLI recovery on failure; do not blindly resend. If a Runtime final response is required, keep the same complete view there. Do not request User attention.

For an independent view, use only the requested topic, shared facts and assigned perspective. Do not cite, follow or rebut views already on the public screen.

For a focused response, address only the named disagreement. Explicitly retain, revise or qualify your judgment as the evidence warrants; do not restate the other side or rewrite the first-round report.

Use this compact structure, localizing its labels:

```markdown
Judgment: <1-2 sentences; retain/revise/qualify for a response>
Reasons:
- ...
- ...
Risk or limit: ...
Would change my view: ...
Confidence: high | medium | low
```

Return your result without organizing members, asking the host to continue, or adding another round.
