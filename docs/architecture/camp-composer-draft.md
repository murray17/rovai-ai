---
document_type: architecture
architecture: camp-composer-draft
authority: camp-composer-draft-pending-and-user-send-boundaries
status: accepted
last_updated: 2026-09-04
---

# Camp Composer Draft 架构

Camp Composer Draft 是普通输入框的唯一持久编辑真源；已提交但尚未公开的下一轮输入由私有 Pending Camp Input
拥有。字段、命令和错误见 [Camp Composer Draft v7](../contracts/camp-composer-draft-v7.md)与
[Pending Camp Input v2](../contracts/pending-camp-input-v2.md)，附件生命周期见
[Camp Attachment v8](../contracts/camp-attachment-v8.md)。

## Component authority

| Component | Responsibility |
| --- | --- |
| Renderer Composer | 展示 Content、Reply、Continuation 与 pathless attachment Views；串行提交同 Camp revision mutation；不保存 source path 或判断 storage model |
| Camp Draft module | 持久化 Structured Content、source refs、legacy Prepared 互斥状态、Reply/Continuation、recipient touched、revision 与 expiry |
| Pending module | 原子保存已提交的完整下一轮意图、FIFO、edit token/revision、working source refs 与 needs-repair 状态 |
| Collaboration send | 从 exact Draft/Pending 读取提交，物化 continuation，最终校验 Reply/Mention/source availability，并只在 accepted transaction 消费 owner |
| Camp Read Model | 投影 Reply/Continuation 和统一无路径附件 View；历史附件 availability 默认为 unknown |
| Runtime source resolver | 对触发 Message 的 source refs返回 executionRoot 内原路径或当前 Run Temp 路径；Adapter 不理解存储差异 |

## Send and queue flow

```text
exact Composer Draft
  -> rendered body non-empty OR source/legacy attachment exists
     -> Camp idle and Pending empty
        -> validate current source availability
        -> create CampMessage/Turn/Run and consume Draft atomically
     -> Camp busy or Pending exists
        -> source-ref Draft: copy complete intent JSON into Pending and consume Draft atomically
        -> legacy Prepared Draft: reject queue admission and preserve exact Draft
  -> no body and no attachment
     -> reject camp_message.empty_body
```

Source-ref publication only copies JSON between owners. It never copies a physical file, calculates a digest or enters Managed
v2. Body plus attachments, attachment-only and multiple attachments are all valid. Immediate availability failure creates no
Message and preserves the Draft.

Pending keeps Structured Content, source refs, Reply/Continuation result and Execution Request as one intent. The Scheduler
publishes only the head after prior execution settles. Missing, unreadable or kind-changed source paths mark that head
`needs_repair` with the exact code and continue to block FIFO.

## Pending Edit flow

```text
Pending canonical refs
  -> Begin/Takeover copies refs to edit-session working JSON
     -> add / paste / drop / remove / reorder
        -> Save: whole working array replaces Pending; revision + 1; queued
        -> Cancel: working array discarded; Pending unchanged
        -> Delete: Pending cancelled; revision + 1
```

Every edit action is fenced by pendingInputId, pending revision and editToken. The `pending_edit` attachment locator includes
that token so an unsaved new attachment can be previewed/opened without leaking its path. No edit outcome deletes the native
or OS Temp source.

## Reply and Continuation

Reply and Continuation priority remains unchanged:

```text
stable message Reply -> exact Draft mutation -> active Agent author adds visible Mention
                                        \-> unavailable author requires explicit replacement

latest accepted single-recipient user route -> empty Draft continuation candidate
  -> first content or attachment mutation freezes it in the Draft revision
  -> send validates and materializes the canonical Member Mention
```

Reply, explicit Mention, recipient-touched state and continuation suppression remain distinct reviewable facts. A frozen
continuation with attachment-only payload is meaningful; if its Agent becomes unavailable, Core preserves refs and requires
explicit replacement rather than falling back to Default Lead.

## Legacy Draft exhaustion

Migration does not rewrite existing Prepared rows. A Draft with any Prepared attachment must have an empty source-ref array.
It may edit text, remove those attachments, send directly or be discarded, but it cannot create more Prepared rows, mix in
source refs or enter the attachment Pending path. Removing the final Prepared row makes later additions source refs.

This compatibility is Core-internal. Renderer uses the same attachment View for both modes and never displays
`source_ref | managed_v2 | legacy_v1`.

## Failure and recovery

- revision conflict reloads the Core Draft; local route or attachment state does not overwrite a newer revision;
- direct source failure preserves Content, refs, Reply and Continuation and creates no Message;
- Pending source failure preserves the head as `needs_repair`; Save repairs in place, Delete allows the next item to progress;
- accepted Message survives a later source deletion; preview/open/reveal or a later AgentRun may then fail honestly;
- navigation, reload and App restart restore stored refs but do not guarantee their physical source still exists;
- accepted command replay uses the existing persisted result and never needs the consumed Draft to reappear.

## Invariants

- one Camp has at most one Composer Draft and one Pending edit session;
- one owner array has ordered, unique ref IDs and is the only source-ref relationship;
- public Views never contain source paths or storage-model discriminators;
- historical reads do not touch the filesystem to calculate availability;
- successful queue admission and direct publication consume the exact Draft; every rejection preserves it;
- pure attachment payloads preserve empty body/Structured Content without placeholder text;
- Pending editing never consumes or overwrites the ordinary Composer Draft;
- Agent Send and User Automation do not enter the private Composer Pending queue.

## References

- [Camp Composer Draft v7](../contracts/camp-composer-draft-v7.md)
- [Pending Camp Input v2](../contracts/pending-camp-input-v2.md)
- [Camp Attachment v8](../contracts/camp-attachment-v8.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.40-D01](../versions/v1.40/decisions.md#v1-40-d01)
