---
document_type: protocol-contract
contract: camp-message-send
authority: camp-message-send-agent-visible-target-teaching
status: accepted
version: 19
last_updated: 2026-09-01
---

# Camp Message Send v19 Contract

v19 replaces [v18](camp-message-send-v18.md) only for Agent-visible target teaching and the Native Session Charter
revision. Canonical `--to` is the only recommended Agent-recipient authoring route. The v18 inline compatibility
parser, public publication, Principal attention, attachment handling, receipts, replay, Delivery, Gather admission,
Composer admission and CLI examples remain unchanged.

## Agent-visible Send teaching

The operation summary is exactly:

```text
Publish one public Camp message. Use --public-only when the message must not address any Agent; it prevents Agent addressing, creates no Agent Delivery, and wakes no Agent. Without --public-only, --to may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.
```

The `publicOnly` input schema description is exactly:

```text
Guarantee that this public Camp message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because Principal attention is not Agent routing.
```

The `rovai send --public-only` CLI help is exactly:

```text
Guarantee that this public message wakes no Agent.

effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

Do not combine this option with --to or --task-id. It may be combined with --to-principal.
```

The `body`, `to`, `mentionUser`, `taskId` and `files` schema descriptions; `--to`, `--to-principal`, `--file` and
body-newline CLI help; and all three Send examples remain byte-for-byte unchanged from v18. Agent-visible Bootstrap,
Send schema and CLI help no longer teach the inline fallback mechanism.

## Compatibility parser and sending effects

All v18 parser and delivery rules remain authoritative. In particular, Core still recognizes the existing canonical
and line-leading exact display-name compatibility forms, resolves a whitespace-separated valid mention cluster,
and preserves unknown, ambiguous or ineligible display-name tails as Text instead of introducing a new rejection.
Malformed reserved canonical tokens retain their existing failure behavior, and code, URL and escaped-literal
exclusions remain unchanged.

`@惠 @响子` can therefore still resolve both eligible members. `@惠 @Principal` remains an accepted Send that routes
only 惠 and preserves `@Principal` as literal Text; it does not create Principal attention. `--public-only` still
bypasses roster lookup and body parsing before publication, preserving the complete body as Text with zero Effective
Recipient, Delivery or Agent wake. Membership, self/ancestor, depth, fanout, budget, Task cardinality, caller return,
Gather admission and idempotent replay remain unchanged.

## Session Charter and Feishu

The Agent-addressing Charter bullet is exactly:

```text
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
```

Session Charter revision advances from 4 to 5 so a normal next execution cannot reuse a revision 4 Native Binding.
Native Session Bootstrap contract v3 and Bootstrap Formatter 3 remain unchanged; existing Bootstrap Evidence retains
its original bytes and digest.

The v18 Feishu-specific rule and exact bullet remain unchanged. Only a new Native Session Bootstrap for a Camp with
an active Feishu conversation binding appends this bullet after the final Built-in CLI Charter bullet and before any
Adapter-specific guidance:

```md
- This Camp is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
```

## Version and evidence boundaries

The changed Send summary and `publicOnly` schema description rotate `builtin_tool_catalog_digest`. The existing
Adapter Binding compatibility path replaces a Binding with the old catalog digest or Charter revision on the next
normal execution. CLI-only help does not independently enter the catalog digest. There is no explicit restart,
database migration, history rewrite, dual write, wire clean break or parser migration.

AgentRun Formatter 22, ContextManifest 22, Delivery Profile 4, Built-in Tool Transport v21, CLI/capability versions,
IPC, Envelope, receipt and Agent Output versions are unchanged. The v19 document identity is not a wire-version bump.

Implementation authorization:
[confirmed revision 1](../versions/v1.37/model-context-change-inline-addressing-teaching.md).
