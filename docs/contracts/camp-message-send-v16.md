---
document_type: protocol-contract
contract: camp-message-send
authority: camp-message-send-with-recipient-facing-file-guidance
status: accepted
version: 16
last_updated: 2026-08-31
---

# Camp Message Send v16 Contract

v16 replaces [v15](camp-message-send-v15.md) for file-delivery teaching. All Send inputs, attachment snapshots,
pure-attachment payloads, public publication, addressing, Principal attention, receipts, replay, Delivery, Gather and
Composer admission remain unchanged. This is guidance, not a new file-purpose classifier or path authorization rule.

## CLI teaching

The operation summary no longer teaches attachment copying, creation locations or pure-attachment payloads. It is exactly:

```text
Publish one public Camp message. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.
```

The exact `--file` help is:

```text
Attach a local file or directory readable by the active Runtime to this message; repeat to preserve attachment order. Use this only for recipient-facing files the recipient needs. Do not attach temporary, intermediate, cache, log, or diagnostic files.
```

Examples retain only the three existing public-only, Agent-only and Principal-attention sends:

```text
rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'
rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'
rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'
```

The `files` schema, other field help and actual attachment-only behavior remain unchanged.

## Feishu Session Charter

Only when creating new Native Session Bootstrap evidence, Core tests whether that exact Camp has an active
`channel_conversation_binding` whose `channel_conversation.provider = feishu`. Both Quick Chat and Project qualify,
independent of conversation kind. No binding, a closed binding, an unbound conversation or another provider does not qualify.

For a qualifying Camp, append one newline and this exact bullet after the final Built-in CLI Charter bullet and before
any Adapter-specific guidance:

```md
- This Camp is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
```

The static CLI Charter resource, surrounding sections and separators are unchanged. There is no empty section, per-Turn
hint, channel field in Dynamic Context or image-to-attachment conversion. Runtime image previews stay local; external
delivery continues to require an explicit Send attachment.

The selection and resulting Charter bytes freeze in the existing Bootstrap evidence. Reuse, redelivery, closing or adding
a channel binding, and continuing locally do not re-evaluate it for that Native Binding. A normal replacement Binding
selects from current channel facts; channel changes alone do not rotate the Session.

## Version and evidence boundaries

Session Charter revision advances from 2 to 3 in the existing Adapter Binding compatibility digest. The next normal
execution replaces an incompatible old Binding; there is no separate restart or database migration. Historical evidence
keeps its original bytes/digests and remains readable.

Native Session Bootstrap contract v3, Bootstrap Formatter 3, AgentRun Formatter 22, ContextManifest 22 and Delivery
Profile 4 are unchanged. Built-in transport/CLI/capability remain v21 and all schemas are unchanged; the catalog digest
naturally reflects the new summary. The v16 document identity is not a wire-version bump.

Implementation authorization: [confirmed revision 1](../versions/v1.37/model-context-change.md).
