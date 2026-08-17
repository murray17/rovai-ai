---
version: 1
slug: "new-conversation-dialog"
primary_target: "apps/desktop/src/renderer/src/NewConversationDialog.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/styles.css"
---

# New Conversation dialog surface brief

## User goal

Create one durable conversation with the correct workspace, teammate set, Lead and optional name,
without hiding safety checks or creating a second Draft model.

## Geometry and hierarchy

Open the same Radix Dialog from every entry point. Width is
`min(760px, viewport width - 72px)` and maximum height is
`min(790px, viewport height - 72px)`. Header and footer remain fixed while the body scrolls. Use the
raised theme surface, strong boundary and 3px Steel top edge; semantic errors keep their own color.

Header: eyebrow `NEW CAMP`, title “创建新对话”, description “确定这段对话的工作环境与队员”, and an
accessibly named close button.

Workspace, teammate, Lead and optional-configuration controls share one 16px stroke chevron and one
right-edge inset. Native select styling must not introduce a second platform-specific arrow.

## Field order

1. **工作目录 · 可选** — default Quick Chat, a known canonical Project or “选择工作目录…”. Preserve
   Finder picker cancellation, directory safety validation and asynchronous Git capability. A valid
   ordinary directory is usable before Git detection completes; do not run `git init`.
2. **队员与 Lead** — default to the saved valid team configuration, otherwise all active teammates.
   The set is non-empty and Lead remains inside it. Runtime availability is guidance, not a structural
   selector. Unavailable saved members are filtered while initializing the draft without adding a
   separate “默认配置已失效” warning block.
3. **可选配置 / 对话名称** — collapsed by default. Expansion focuses the input. Normalize and count
   Unicode scalars up to 80; empty means “未命名对话” and is not delegated to a Runtime/LLM.

Footer summary contains only Quick Chat/directory display name, teammate count and Lead, followed by
“取消 / 创建”. Do not add a duplicate body summary or static warning block.

## Submission and recovery

Submitting locks controls that could mutate the Draft and prevents duplicate create. Close only after
Core atomically accepts the Active Camp, then refresh Navigation, enter it and focus Composer. A Camp
with no messages, AgentRun or prebuilt Conversation is valid.

Failure preserves directory, teammate selection, Lead, name, scroll and focus. Candidate refresh must
not silently drop a teammate, replace Lead or fall back to Quick Chat. Esc/close/cancel in non-submitting
state returns focus to the exact opener.

Do not restore “协作方式 / 并肩协作 / 领队统筹 / 暂未开放”; the request continues to submit the existing
`peer` semantics. This is a Renderer simplification, not a Core union or SQLite migration.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), both theme contracts and
[accessibility baseline](../../../../docs/ui/qa/accessibility.md). This brief cannot alter directory
safety, Camp creation transactions, Pending/Active semantics, Member Order or Core draft authority.
