---
document_type: protocol-contract
contract: camp-message-send
version: 24
status: accepted
authority: principal-inline-addressing
last_updated: 2026-09-26
---

# Camp Message Send v24

v24 inherits [v23](camp-message-send-v23.md) publication, delivery, receipt, attachment, withdrawal and idempotency
semantics. It adds a reserved human target to the existing Agent-authored Send body parser. This supersedes v18/v19's
literal-only Principal rule and PublicOnly's complete parser bypass. No input field or receipt shape changes.

## Principal body addressing

The exact, case-sensitive token `@Principal` resolves to `CurrentUserMention(local_user)`. It uses the existing member
**display-name** grammar: first non-whitespace token on any logical line, or a whitespace-separated continuation of
that line's valid mention cluster. The next character must be whitespace or end-of-body. Ordinary prose and unknown
or ambiguous names end the cluster. Existing code, URL and escaped-literal exclusions continue to apply. The broader
mid-line canonical `@agent_N` compatibility rule does not apply to Principal. Principal is reserved even if a member
has that display name; use its canonical Agent ID to address that member.

Mixed clusters work in either order. Principal does not enter Agent recipients, Delivery, Task recipient cardinality
or Conversation creation. Structured content retains occurrence order; repeated authored occurrences remain visible,
while user attention is message-local and created once by the existing atomic notification projection.

`mentionUser=true` / `--to-principal` inserts its existing leading structured mention only when no Principal occurrence
was parsed. With a body starting `@Principal `, its first ASCII separator is consumed because the existing leading
CurrentUser projection already supplies that separator. This gives flag-only, body-only and combined sends the same
canonical prefix without changing the projection of any historical content.

## PublicOnly and non-Send sources

`--public-only` still rejects explicit Agent targets and taskId, creates no Agent Delivery, and leaves Agent-looking
body text literal. It now resolves the active roster only to recognize valid mixed clusters; it discards Agent
occurrences and malformed-Agent errors before routing validation, while retaining Principal occurrences. Thus
`@Alice @Principal please confirm` can create human attention with zero Agent deliveries in PublicOnly mode.

Only explicit Agent Send ingress gains this behavior. User-authored text, structured quotes, Runtime narration,
automatic final publication and Missing-Send Recovery keep their current policies. Historical Text segments are not
reparsed, and successful command replay returns the already committed result without adding attention.

## Presentation and evidence

Stored identity is `local_user`, never a nickname. Desktop/Web render and copy every CurrentUser segment using the
current user profile's display name; the existing fallback applies only when that profile has no nickname. Inline and
trailing occurrences remain at their authored positions and retain surrounding sanitized Markdown. Nickname markup
is always literal UI. Message-quote selection projects the same visible Markdown text; frozen quotes remain unchanged.
Channel output continues through its existing structured-mention projection and provider-native Owner mention.

The existing Agent projection remains `@Principal`. Bootstrap text, CLI help/schema, context sections, selection,
budgets, formatter versions and frozen evidence are unchanged. This is an authorized message-ingress behavior change,
not a new model input format. No migration, historical rewrite or Native Binding reset is required.

## Verification ownership

The pure parser owner covers position, mixed clusters, reserved identity, exclusion regions and flag/body merging.
Existing Send fixture owners cover PublicOnly suppression, structured persistence, one attention occurrence and
idempotent replay. Renderer/profile and shared quote fixtures cover nicknames, Markdown, collision-safe inline UI,
copy and quote text. The new parser test is the lowest-cost owner of the newly accepted syntax; stateful effects stay
in the existing integration owners rather than duplicating fixtures.
