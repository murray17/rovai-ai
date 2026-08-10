---
document_type: contract
contract: context-manifest-evidence-v10
status: accepted
target_version: v0.54
last_updated: 2026-08-10
---

# ContextManifest Evidence v10

v10 冻结 Formatter v12 的 exact AgentRun Dynamic Context bytes，并在 v9 的 public history、Collaboration
State、Run Notice、attachment、Skill/MCP 与 Bootstrap reference evidence 上增加独立 Self Active Task
Evidence。v9 不作为当前恢复 reader。

## Self Active Task Evidence

每个 Manifest 都持久化一个 machine-only 对象及其 canonical evidence digest：

```json
{
  "included": true,
  "selectedTaskRefs": [
    {"taskId": "task_…", "version": 4, "updatedAt": "2026-08-10T00:00:00Z"}
  ],
  "omittedCount": 2,
  "projectionDigest": "sha256:…"
}
```

`selectedTaskRefs` 顺序与模型 projection 完全一致。`omittedCount` 只在大于零时存在；
`projectionDigest` 只在 section included 时存在，并校验 Formatter 产生的 exact compact JSON bytes。
Evidence 不重复 title/status，不记录 omitted Task identity，也不授予 Task read/write authority。

无 candidate 时为 `included:false`、空 refs，省略 optional 字段。全部 candidate 因 payload budget 被
排除时亦不渲染 section，但 `omittedCount` 可以解释该结果。

## 冻结与恢复

Direct Run 在 materialization critical section 选择并持久化；A2A Delivery 在 Delivery transaction
内预选并冻结相同 payload/evidence，后续 Runtime materialization 只包装冻结 bytes。恢复必须复用
原 Manifest bytes，不重新读取 live Task。

Task projection 没有 freshness watermark、delta cursor 或 accepted-ACK 状态。Runtime Input Delivery
的 accepted ACK 继续只推进其既有 public/Collaboration/Bootstrap 边界，不能把 Task snapshot 变成
当前真源。模型执行 mutation 前仍须通过 `task get` 取得 current version 并由 Core 重授权。

## Current-only migration

v10 要求 Formatter 12 与 Profile 3。迁移删除不兼容的 ContextManifest、Runtime Input Delivery、
Bootstrap technical evidence 与冻结 A2A context，fence 非终态执行并重置 Native Binding context
markers；Camp、Task、Message、Memory 等业务历史保持不变。不保留 nullable shim、dual reader 或
fallback projection。
