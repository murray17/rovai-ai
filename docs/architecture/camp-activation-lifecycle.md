---
document_type: architecture
authority: camp-activation-component-boundary
status: accepted
last_updated: 2026-10-03
---

# Camp Activation Lifecycle

## Component authority

| Component | Responsibility |
| --- | --- |
| Rust Host / Core | Stores the shared one-click preference and saved default member/Lead configuration under the instance data root; see [Host Web v2](../contracts/host-web-v2.md#shared-creation-preferences). |
| Electron Main | Imports legacy creation preferences once through Core and adapts local presentation preferences; it does not store Camp activation or public Composer content. |
| Renderer | Chooses `pending` for a valid one-click entry and `active` for the explicit Dialog. Saves ordinary one-click input per Thread locally, then acknowledges meaningful presence with Core. AI member-creation drafts keep their window-local overlay. |
| Core collaboration service | Validates creation structure, persists Camp activation, guards pre-activation mutation/discard, and activates a Pending Camp in the first accepted public-message transaction. |
| Navigation / Read Model | Lists Active Camps and Pending Camps marked for the verified client, including group totals/pages. Renderer may overlay meaningful AI member-creation drafts within one window. |
| SQLite startup recovery | Removes untouched empty Pending Camps only when no client presence marker exists. It never reconstructs public Composer input. |

## State flow

```text
one-click entry
  -> camps.create(pending)
  -> current Renderer opens an empty local Composer
     -> save meaningful input locally, then acknowledge Core client presence
          draft row appears; repeated new entries retain separate Thread IDs
     -> send rejected/failed: local input remains
     -> send accepted transaction:
          Active + camp.activated + CampMessage + waiting Deliveries + presence removal
     -> switch / refresh / close before send:
          saved local input can be selected from the client's draft row
          truly empty Pending Camp stays hidden and is eligible for guarded cleanup

explicit Dialog
  -> camps.create(active)
  -> durable zero-message Camp
```

The first accepted send is the only Pending-to-Active transition. It validates the one frozen local send snapshot and,
in one Core transaction, activates the Camp, publishes the message and creates target Deliveries. A rejection or
rollback leaves the Camp Pending and does not clear the mounted Renderer input.

Renderer navigation flushes the existing Composer save/attachment queue before unmounting. Ordinary Pending saves
persist the local snapshot before setting Core presence; a failed write or acknowledgement retains the editor and
blocks leave. Core stores no Composer content. Migration 183/schema 133 adds only the client presence table and an
activation trigger; the trigger's deletion rolls back with a failed first-send transaction.

## Invariants

- A Pending Camp cannot have an accepted public message; its first accepted public send activates it atomically.
- Active never transitions back to Pending.
- Ordinary one-click drafts are independently navigable on their originating client; project identity is not a draft key.
- `camps.discardPending` and startup cleanup may delete only an otherwise untouched empty Pending Camp with no client marker.
- Saved draft rows do not change Main Window Session's Active-only automatic restoration contract.
- Single Chat's private Draft/Pending lifecycle is independent and unchanged.

## References

- [Camp lifecycle invariants](foundational-invariants.md#camp-lifecycle)
- [Pending Camp Activation v4](../contracts/pending-camp-activation-v4.md)
- [Camp Composer Draft v16](../contracts/camp-composer-draft-v16.md)

## AI 队员创建

名册入口选择一位当前可用协助者后复用普通 Pending Thread。BusinessApp 持有这个入口创建的窗口内草稿 map；
有输入时仅合并到 Renderer 的侧栏投影，同窗口切换可恢复，刷新与退出不恢复。此入口不写本机 store 或 Core presence。
普通一键入口采用上方的持久保存流程；两者首条接受的发送都是唯一激活事务。选择与状态边界见
[Member Creation Flow v1](../contracts/member-creation-flow-v1.md)及[Pending Camp Activation v4](../contracts/pending-camp-activation-v4.md)。

Member Studio 调用现有 AgentProfile Gateway，在同一创建事务中保存静态入队回执和最近成功协助者。
ReadModel 只读业务回执表，Renderer 只展示创建时身份；当前 Runtime、Presence 与资料存续由跳转后的队员页处理。
回执不成为消息或模型上下文，也不引入另一条身份创建权限路径。
