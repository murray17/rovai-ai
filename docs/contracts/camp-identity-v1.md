---
document_type: protocol-contract
contract: camp-identity-v1
authority: camp-identity-format-and-boundaries
status: accepted
version: 1
last_updated: 2026-08-18
---

# Camp Identity v1 Contract

## Canonical value

Every Camp identity is one UTF-8 string:

```text
rvcamp_<26 lowercase Crockford Base32 characters>
```

The exact lexical pattern is:

```text
^rvcamp_[0-7][0123456789abcdefghjkmnpqrstvwxyz]{25}$
```

The 26-character suffix is the canonical 130-bit-width Base32 spelling of one 128-bit value; its first digit is `0..7`.
After decoding, bits 76..79 must contain UUID version `7` and bits 62..63 must contain RFC variant `10`. Generation uses
UUIDv7 and emits the canonical lowercase alphabet. No case folding, `i/l/o/u` alias, padding, separator or alternative
prefix is accepted.

Valid example:

```text
rvcamp_01h47kvsy5fk1shh6w1g60eecf
```

Its decoded UUID bytes are `01890f3d-e7c5-7cc3-98c4-dc0c0c07398f`, but the UUID spelling is not a valid Camp ID and
must never be exposed as a Camp alias.

## Sole identity

The canonical value is simultaneously:

- `camp.id` and every `camp_id` primary/foreign-key value stored as SQLite `TEXT`;
- Rust `CampId`, JSON/TypeScript `campId`, command Envelope Camp scope and Renderer Camp locator;
- Agent Context, Camp History, Built-in Tool, event, log and diagnostic Camp identity;
- the single Camp component below Rovai-owned attachment and Runtime-home roots.

There is no `CampRef`, `camp_ref`, legacy Camp UUID, internal Camp UUID or mapping table. A supplied old UUID cannot be
used to discover, authorize, resume or mutate a Camp.

## Boundary validation

- Rust request/domain boundaries deserialize through `CampId`; SQLite reads into `CampId` validate stored values.
- TypeScript `isCampId` validates the lexical form plus UUIDv7 version and RFC variant before restoring local state.
- Explicit Camp History targets validate before authorization; path operations validate before joining a filesystem path.
- Read models may serialize already-authoritative database strings, but no external string becomes authoritative without
  an earlier strict boundary.

Invalid values fail the owning operation without fallback, normalization or ID guessing. Camp ID remains a locator,
not an authorization token.

## Native identity separation

`native_session_id`, `native_thread_id`, `native_turn_id`, ACP Session ID, Codex Thread ID, Conversation ID and Native
Binding ID retain provider/domain-specific formats. `rvcamp_...` is invalid as a Runtime resume/load target; a provider
UUID is invalid as a Camp target. Runtime continuation reads only the Native binding stored on the Camp's Conversation.

## Clean break

Pre-release local data with non-current contract/schema is quarantined and a current store is created. The product does
not convert old Camp UUIDs, retain aliases or offer a compatibility reader. Old Renderer locators are discarded by their
storage-version gates. Quarantine is recovery evidence, not a supported reader.

## References

- [ADR-0219](../adr/0219-single-namespaced-camp-identity.md)
- [Camp Identity Architecture](../architecture/camp-identity.md)
- [v1.10 model-context revision 1](../versions/v1.10/model-context-change.md)
