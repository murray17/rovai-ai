---
document_type: protocol-contract
contract: camp-message-send
authority: camp-message-send-with-unambiguous-principal-addressing-guidance
status: accepted
version: 17
last_updated: 2026-09-01
---

# Camp Message Send v17 Contract

v17 replaces [v16](camp-message-send-v16.md) only for one Session Charter Authority-boundary sentence. All Send
inputs, attachment handling, public publication, Agent addressing, Principal attention, receipts, replay, Delivery,
Gather, Composer admission, CLI help and Feishu file-delivery teaching remain unchanged.

## Session Charter Principal addressing

The previous Authority-boundary sentence was:

```text
The Principal is the single human user who owns the Camp objective. `@Principal` and `--to-principal` address that human, never the currently running Agent; they request human attention without scheduling Agent work or constituting approval.
```

It is replaced exactly with:

```text
The Principal is the single human user who owns the Camp objective. `--to-principal` addresses that human, never the currently running Agent; it requests human attention without scheduling Agent work or constituting approval.
```

This removes the ambiguous implication that an Agent should author `@Principal` in message body text. It does not
change Core behavior: only the existing explicit Send input creates Current User Mention and Attention. Structured
Current User Mention still projects as `@Principal` to Agent audiences and as `@你` to the local human audience.

## CLI teaching

The operation summary remains exactly:

```text
Publish one public Camp message. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.
```

The exact `--file` help remains:

```text
Attach a local file or directory readable by the active Runtime to this message; repeat to preserve attachment order. Use this only for recipient-facing files the recipient needs. Do not attach temporary, intermediate, cache, log, or diagnostic files.
```

The three examples remain:

```text
rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'
rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'
rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'
```

The `files` schema, other field help and actual attachment-only behavior remain unchanged.

## Feishu Session Charter

Only when creating new Native Session Bootstrap evidence, Core tests whether that exact Camp has an active
`channel_conversation_binding` whose `channel_conversation.provider = feishu`. Both Quick Chat and Project qualify,
independent of conversation kind. No binding, a closed binding, an unbound conversation or another provider qualifies.

For a qualifying Camp, append one newline and this exact bullet after the final Built-in CLI Charter bullet and before
any Adapter-specific guidance:

```md
- This Camp is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
```

The static CLI Charter resource, surrounding sections and separators are unchanged. There is no empty section,
per-Turn hint, channel field in Dynamic Context or image-to-attachment conversion. Runtime image previews stay local;
external delivery continues to require an explicit Send attachment.

The selection and resulting Charter bytes freeze in the existing Bootstrap evidence. Reuse, redelivery, closing or
adding a channel binding, and continuing locally do not re-evaluate it for that Native Binding. A normal replacement
Binding selects from current channel facts; channel changes alone do not rotate the Session.

## Version and evidence boundaries

Session Charter revision advances from 3 to 4 in the existing Adapter Binding compatibility digest. The next normal
execution replaces an incompatible revision 3 Binding; there is no separate restart or database migration. Historical
evidence keeps its original bytes and digests and remains readable.

Native Session Bootstrap contract v3, Bootstrap Formatter 3, AgentRun Formatter 22, ContextManifest 22, Delivery
Profile 4, Built-in Tool Transport v21, CLI/capability/catalog digests and all schemas are unchanged. The v17 document
identity is not a wire-version bump.

Implementation authorization:
[confirmed revision 1](../versions/v1.37/model-context-change-principal-addressing.md).
