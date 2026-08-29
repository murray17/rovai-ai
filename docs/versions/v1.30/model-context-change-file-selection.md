---
document_type: model-context-change
version: v1.30
change_id: frozen-file-selection-agent-projection
revision: 2
confirmation_status: pending
confirmed_revision: 0
confirmed_by: pending
confirmed_at: pending
authority: proposed-model-input-change-statement
implementation_baseline: a2dbf4b3badbdc00d9e3dffe4bfb5244991518aa
last_updated: 2026-08-30
---

# v1.30 核心模型上下文变更说明：冻结文件选区投影

本文是待开发者二次确认的 revision 2。审阅基线为
`main@a2dbf4b3badbdc00d9e3dffe4bfb5244991518aa`。本说明未确认前，文件选区进入 Agent input 的实现不能
视为可合入交付；任何改变下述 shape、文本格式、发送条件、预算、Evidence 或版本轴的调整都必须递增 revision
并重新确认。

本变更只让用户从文件 Viewer 明确附加的冻结选区进入该条 CampMessage 的 Agent-facing 正文。它不让 Agent
获得文件句柄、磁盘路径权限或未来重读能力，也不改变 Runtime Adapter transport。

## 变更前

### Structured CampMessage Content

基线的 closed `StructuredCampMessageSegment` union 只有以下五类：

```json
{ "kind": "text", "text": "普通文本" }
{ "kind": "member_mention", "agentId": "agent-123" }
{ "kind": "all_members_mention" }
{ "kind": "current_user_mention", "userId": "local_user" }
{ "kind": "skill_mention", "skillId": "skill-123", "nameAtSend": "review-pr" }
```

不存在结构化文件选区。代码或文本即使在 Renderer 中被选中，也不能作为一个带路径、范围、版本和验证语义的
segment 写入 Draft 或 CampMessage。

### Agent-visible message projection

Agent projection audience 为 `agent_v1`，当前逐 segment 映射是：

```text
Text                              → 原文本
MemberMention                     → 当前 Agent-facing 成员显示投影
AllMembersMention                 → @所有队员
CurrentUserMention(local_user)    → @Principal
SkillMention                      → "/" + nameAtSend
```

Direct user `CURRENT_INPUT` 的 closed outer shape 不含选区字段；`message` 是完整 Agent-facing 正文字符串：

```json
{
  "source": { "type": "user" },
  "message": "请检查这里",
  "mentionsCurrentUser": false
}
```

可选 `attachments` 与 `skills` 继续作为同级字段按既有规则出现。相同 Agent projection 还用于
`SHARED_CONVERSATION`、Camp History/Search/Read 和相应 projected body digest；公共历史中的单条正文仍按
Context Delivery Profile v4 最多投影 2000 Unicode scalar，trigger `CURRENT_INPUT` 仍完整且最后。

### 当前版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
Session Charter Revision:         2
AgentRun Context Formatter:       21
ContextManifest Evidence:         21
Context Delivery Profile:         4
Message Projection Audience:      agent_v1
Gather Completion Input:          3
Data Contract:                    v1.29
Projection Schema:                70
Latest Schema Migration:          116
```

## 变更后

### Structured File Selection

closed union 增加且只增加以下 variant；示例包含全部字段：

```json
{
  "kind": "file_selection",
  "selection": {
    "selectionId": "selection-123",
    "displayPath": "apps/desktop/src/App.tsx",
    "selectedText": "const ready = true;",
    "startLine": 12,
    "startColumn": 3,
    "endLine": 12,
    "endColumn": 22,
    "positionEncoding": "utf-16",
    "rangeEnd": "exclusive",
    "contentVersion": {
      "size": 4281,
      "mtimeMs": 1788057600000,
      "fileId": "1:2048"
    },
    "verification": "current_file",
    "sourceKind": "camp_workspace",
    "sourceIdentityDigest": "sha256:<64 lowercase hex>"
  }
}
```

`startColumn`、`endColumn` 和 `contentVersion.fileId` 可省略；其余字段必需。行列均为 1-based，列使用 UTF-16
code unit，结束位置 exclusive。`verification` 的 closed 值为：

```text
current_file
viewer_snapshot_after_change
```

`sourceKind` 的 closed 值为：

```text
message_reference | camp_workspace | attachment | run_evidence | child_of_handle | authorized_root
```

`displayPath` 是安全相对显示路径，不是 canonical path。`sourceIdentityDigest` 只证明来源快照，不是可调用的
Authority。单项 `selectedText` 最多 64 KiB UTF-8；每个 Draft 最多 8 项、合计最多 256 KiB。未知字段、非法
范围、非法 enum、空选区或超限拒绝 whole submitted Structured Content。

### Agent-facing exact text

File Selection 在 Agent projection 中使用以下逐字 block；`range` 的列号仅在对应列存在时出现：

```text
<file_selection>
path: apps/desktop/src/App.tsx
range: L12:3–L12:22
position_encoding: utf-16
range_end: exclusive
content_version: size=4281; mtime_ms=1788057600000; file_id=1:2048
verification: current_file
text:
const ready = true;
</file_selection>
```

`fileId` 缺失时，`content_version` 行精确结束于 `mtime_ms=<value>`。若 block 前已有正文且正文不以换行结束，
先追加一个 `\n`；`selectedText` 字节保持冻结值，若其不以换行结束则在 `</file_selection>` 前追加一个 `\n`。
多个选区严格按 segment 顺序投影，不排序、不合并、不重新读取文件。

因此带一个选区的 Direct user `CURRENT_INPUT` outer shape 不新增字段，只有 `message` 值改变：

```json
{
  "source": { "type": "user" },
  "message": "请检查这里\n<file_selection>\npath: apps/desktop/src/App.tsx\nrange: L12:3–L12:22\nposition_encoding: utf-16\nrange_end: exclusive\ncontent_version: size=4281; mtime_ms=1788057600000; file_id=1:2048\nverification: current_file\ntext:\nconst ready = true;\n</file_selection>\n",
  "mentionsCurrentUser": false
}
```

相同 renderer 覆盖 trigger `CURRENT_INPUT`、`SHARED_CONVERSATION`、Camp History/Search/Read 与 projected body
digest。Human Timeline、FTS、clipboard 和 plain-text fallback 继续使用中性格式：

```text
文件选区：apps/desktop/src/App.tsx · L12:3–L12:22
const ready = true;
```

### 发送、Evidence 与恢复

- 附加时 Main 只验证当前窗口、Camp、句柄、generation、内容版本和 UTF-16 选区文本；Core 在 exact Draft
  revision 事务中持久化冻结 segment；
- 发送时不重新读取文件；句柄过期、文件变化或文件删除均不改变已经冻结的选区；
- ContextManifest 的 source content digest 继续绑定完整 Structured Content，projected body digest 与
  rendered payload digest 继续绑定 Agent 实际看到的 block；
- 选区不是 Attachment、Mention、Skill、routing token、文件读取 Grant 或 Runtime provider input item；
- 现有 Runtime payload 上限与 mandatory `CURRENT_INPUT` fail-closed 规则不变；本 revision 不提高 Runtime
  payload budget，也不截断 trigger 选区来强行适配较小上限。

### 版本与迁移

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
Session Charter Revision:         2 (unchanged)
AgentRun Context Formatter:       21 (unchanged)
ContextManifest Evidence:         21 (unchanged)
Context Delivery Profile:         4 (unchanged)
Message Projection Audience:      agent_v1 (unchanged)
Gather Completion Input:          3 (unchanged)
Data Contract:                    v1.30
Projection Schema:                71
Latest Schema Migration:          117
```

Formatter/Manifest/Profile 不升版，因为 Dynamic Context 的 section 顺序、outer JSON shape、选择、预算和 Evidence
字段均不变；`CURRENT_INPUT.message` 与 Shared Conversation `body` 本来就是完整 projected text，新增 variant 的
精确字节仍由既有 source/projected/rendered digests 证明。`agent_v1` 对全部旧 segment 的映射逐字不变；它只为
旧 reader 无法产生的新 `file_selection` source variant增加映射。

Migration 117 只把 reader/writer gate 从 `v1.29/schema 70` 提升为 `v1.30/schema 71`，并保留
`activity-v2` classifier marker。既有不含
`file_selection` 的 Structured Content JSON 是新 union 的合法子集，不回填、不重写；既有 Manifest 与 accepted
input bytes 继续逐字有效。旧 App 因 Data Contract marker 不认识 schema 71 而 fail closed，不能把新 variant
误读成旧消息。

## 明确不变

- Session Charter、Member Identity、Memory Entrypoint、Bootstrap wrapper 与 Runtime Adapter transport；
- Dynamic Context section 名称、顺序和 `CURRENT_INPUT` 最后一节规则；
- Collaboration State、Self Active Tasks、Run Facts、A2A Guidance、Skill links 与 Attachment paths；
- Context Delivery Profile v4 的 public-history selection、2000-scalar 单消息上限、24,000-scalar历史预算和
  omission evidence；
- Current User Mention 的 Human `@你` / Agent `@Principal` 双投影；
- 文件预览句柄、canonical path、root Grant、watcher、generation 和 reopen token 永不进入模型输入；
- Agent 不能凭 `displayPath`、`sourceIdentityDigest` 或 `contentVersion` 重新读取文件；
- 已冻结选区不会因用户刷新 Viewer、关闭 Tab、切换 Camp、重启 App 或源文件变化而被重写。

## 数据与恢复策略

Migration 117 不删除 Camp、Message、Draft、Delivery、Run、Manifest、Runtime Input Delivery 或 Session，不旋转既有
Binding，也不重投影历史 evidence。旧 JSON 无选区且语义不变；新 JSON 只能由支持 schema 71 的 Core 写入。
Draft 恢复保留完整 File Selection segment；Message/History/Agent projection从同一持久 segment 确定性重建。

## 验证要求

1. closed serde/TypeScript union 接受完整合法 variant，拒绝未知字段、非法 enum、范围、digest 和配额；
2. Human projection 与 Agent block 分离，旧五类 segment 的 `agent_v1` bytes 不变；
3. Agent block 覆盖有/无列、有/无 `fileId`、多行 UTF-16 与末尾换行；
4. Direct Current Input、Shared Conversation、History/Search/Read 和 projected/rendered digest 使用同一 Agent renderer；
5. 文件变化后只有显式 `viewer_snapshot_after_change` 可以附加旧 Viewer 快照，发送不重读磁盘；
6. 句柄、generation、token、canonical path 与原始 source identity 不进入 Draft/Message/Manifest/model payload；
7. Migration 117 接受完整 `v1.29/schema 70/migration 116`，升级到 `v1.30/schema 71/migration 117`，未来
   schema 与缺失迁移 fail closed；
8. 既有无 File Selection 的 ContextManifest、payload digest 和恢复验证保持逐字兼容。

## 二次确认

当前状态：`pending`。

只有开发者在完整阅读 revision 2 后明确确认“同意实施 v1.30 文件选区模型上下文变更 revision 2”，才可把
Front Matter 更新为 `confirmation_status: confirmed`、`confirmed_revision: 2` 并记录确认人和时间。普通的文件
预览实现授权不能替代这次二次确认。
