---
document_type: protocol-contract
contract: camp-message-send
authority: camp-message-send-with-nondiscoverable-inline-fallback
status: accepted
version: 18
last_updated: 2026-09-01
---

# Camp Message Send v18 Contract

v18 replaces [v17](camp-message-send-v17.md) for the Agent-visible `body` description and the existing inline
display-name compatibility parser. Explicit `--to` remains the only recommended Agent-recipient authoring route.
Public publication, Principal attention, attachment handling, receipts, replay, Delivery, Gather, Composer admission,
CLI examples and the v17 Session Charter revision remain unchanged.

## Agent-visible Send help

The `body` schema description is exactly:

```text
Optional exact public message body; omit it when at least one file supplies the complete payload.
```

It does not teach canonical inline tokens, display-name aliases, cluster grammar, placement or failure rules. The
existing `to` description continues to require canonical Agent IDs and reject display names. The operation summary
keeps only its generic safety warning that restricted inline addressing can have routing effects; it provides no
copyable inline syntax. The existing `--public-only` help continues to explain that it bypasses every inline Agent
addressing effect.

## Line-leading mention compatibility parser

Canonical inline `@agent_N` recognition keeps its existing parseable-body positions, validation and malformed-token
failure behavior. Exact active-Camp display-name aliases remain a Core-only compatibility fallback and follow these
rules:

1. A logical line starts at body byte zero or immediately after `\n`. Unicode whitespace may precede the first token.
2. A valid canonical token or unique exact active-member display-name alias at the first non-whitespace position starts
   a line-leading mention cluster.
3. After each valid occurrence, one or more Unicode whitespace characters followed by another valid canonical token or
   exact display-name alias on the same line extend the cluster. A cluster never crosses `\n`.
4. Ordinary prose, an unknown or ambiguous display-name lookalike, or an unresolved `@Principal` ends the cluster.
   Those display-name lookalikes stay literal Text and do not make the Send fail. Later canonical tokens retain their
   existing mid-line behavior; malformed reserved canonical `@agent_*` tokens remain invalid wherever the canonical
   parser already recognized them.
5. Canonical precedence, longest exact display-name match, whitespace/end-of-body name boundary, case sensitivity and
   code/URL/escape exclusions remain unchanged. Mid-line display-name lookalikes do not route.
6. Every valid source occurrence becomes a Structured Content `MemberMention` in source order; original whitespace
   remains Text. Duplicate occurrences remain visible, while Effective Recipients are still canonicalized, sorted and
   deduplicated so each recipient receives at most one Delivery.

`--public-only` still bypasses roster lookup and body parsing before publication, preserving the complete body as
literal Text with zero Agent recipient, Delivery or A2A allocation. Membership, self/ancestor, depth, fanout, budget,
Task cardinality, caller-return and Gather admission remain unchanged after valid identities are resolved.

Human Principal attention remains available only through the explicit `--to-principal` input. Literal `@Principal`
text does not create Current User Mention or attention.

## Feishu Session Charter

The v17 channel-specific rule and exact bullet remain unchanged. Only a new Native Session Bootstrap for a Camp with
an active Feishu conversation binding appends this bullet after the final Built-in CLI Charter bullet and before any
Adapter-specific guidance:

```md
- This Camp is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
```

The v17 Principal Authority-boundary sentence also remains exact and teaches only `--to-principal`. Session Charter
revision stays 4; existing Bootstrap evidence remains frozen.

## Version and evidence boundaries

Changing the Agent-visible `body` description rotates `builtin_tool_catalog_digest`. The next normal execution uses the
existing Adapter Binding compatibility path to replace a Binding with the old catalog digest. There is no separate
restart mechanism or database migration. Historical Bindings, Bootstrap Evidence, manifests, messages, receipts and
Deliveries retain their original bytes and digests.

Native Session Bootstrap contract v3, Bootstrap Formatter 3, AgentRun Formatter 22, ContextManifest 22, Delivery
Profile 4, Built-in Tool Transport v21, CLI/capability versions, IPC, Envelope, receipt and Agent Output versions are
unchanged. The v18 document identity is not a wire-version bump.

Implementation authorization:
[confirmed revision 3](../versions/v1.37/model-context-change-multi-mention-cluster.md).
