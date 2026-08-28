---
document_type: contract
contract: runtime-file-change-observation
version: v1
status: accepted
last_updated: 2026-08-27
---

# Runtime File Change Observation v1

本合同定义 Runtime File Operation、Command Diff 与 AgentRun File Changes 的准入、Evidence、归约、读取和
presentation。accepted 只表示目标语义已冻结；实现状态由
[v1.29 实施计划](../versions/v1.29/implementation-plan.md)拥有。

## 1. Closed product layers

| 层 | Identity | 权威来源 | 不证明 |
| --- | --- | --- | --- |
| `runtime_file_operation` | 一个 Canonical Activity | Runtime 成功终态报告的可靠单文件 path | old/new、增删行数或最终磁盘状态 |
| `command_diff` | 一个 Canonical Activity | Runtime 对该 Operation 报告的可靠内容 | 其他 Operation 或整次 Run 的最终结果 |
| `agent_run_file_changes` | `agentRunId + executionEpoch` | 同 Run append-only Evidence 的 terminal projection | 未报告的 shell/外部写入或当前磁盘状态 |

三层不得互相伪造。前两层投影到既有 Canonical Activity；第三层是独立的 Run read projection，不拥有或复制
Activity identity、phase、outcome。产品不存在 `workspace_change_window`、Git snapshot、baseline/final、
participant、coordinator、checkpoint ref 或 workspace scan。

## 2. Evidence semantics

准入文件变化必须明确归入以下一种语义：

```ts
type RuntimeFileChangeEvidence =
  | {
      semantics: 'full_before_after'
      path: string
      changeKind: 'add' | 'update' | 'delete'
      before: string | null
      after: string | null
    }
  | {
      semantics: 'unified_diff_snapshot'
      path: string
      changeKind: 'add' | 'update' | 'delete'
      diff: string
    }
  | {
      semantics: 'exact_mutation'
      path: string
      oldText: string
      newText: string
    }
  | {
      semantics: 'operation_only'
      path: string
      changeKind: 'add' | 'update' | 'delete'
    }
```

- `full_before_after` 的两个端点都必须明确；add 允许 `before=null`，delete 允许 `after=null`；
- `unified_diff_snapshot` 必须是该来源语义下的完整 snapshot，不得把 patch delta 或自由文本包装为 snapshot；
- `exact_mutation` 只证明一次片段替换，不证明文件全貌、全局行号或唯一匹配位置；
- `operation_only` 只证明成功操作和路径，不得产生 inline diff 或增删计数；
- 完整 source bytes 保存在 Execution Evidence 或其 Managed Blob。preview 不能成为 projector 的数据源。

## 3. Common admission

所有 Runtime 必须满足：

1. 事件属于一个仍匹配 `agentRunId + executionEpoch` 的 Run；
2. 文件变化来自协议可证明的成功 terminal operation，或在匹配 Run/Turn terminal 后发布的权威 Run snapshot；
3. path 非空且能按冻结 execution root 纯词法解析。该 root 同时是 display root：落在 root 内时保存相对路径；
   落在 root 外时保存规范化绝对路径。相对路径以 execution root 为基准，因此 `../other/file` 可以解析成 root
   外绝对路径；其他 URI、越过文件系统根的无效路径与 Git metadata path 拒绝；
4. 内容与文件数满足既有限额；
5. Adapter 不读取当前文件、不扫描目录、不解析 shell 命令，不从 title/output/error 文本猜测变化；
6. failed/cancelled operation 不生成文件变化。Run 本身 failed/cancelled 时，terminal 前已成功落库的 operation
   仍可进入该 Run 的卡片。

## 4. Runtime profiles

### 4.1 Codex app-server

Command View admission：

```text
item/completed
+ item.type = fileChange
+ item.status = completed
```

Core 从 terminal `changes[]` 生成同一 Activity 的逐文件 rows；不展示 `apply_patch` 父行，不解析其 input，
不消费 `item/fileChange/patchUpdated`。

AgentRun card：

1. 当前 turn 的每个 `turn/diff/updated` 以 replace 语义更新内存中的最新 snapshot；
2. 只有匹配 `turn/completed` 后才能写 `runtime.file_changes.snapshot` Evidence；
3. 最新 snapshot 是 display root 内文件的权威输入。非空值按 `diff --git` 文件 section 解析，空值明确表示该
   display root 内 no-change；Runtime terminal 明确报告的 root 外文件不在该结论中，仍补入同一张 Run card；
4. 没有权威 snapshot，或 snapshot 不能安全解析时，projector 才使用 terminal fileChange Evidence fallback；
5. snapshot 超出上限或 turn identity 不匹配时不发布，不读取工作区补偿。

### 4.2 ACP

每个 ToolCall 按原生 ID 累计：

- 首次可信结构化 kind；
- opening/progress/terminal 的标准 `locations[].path`；
- 标准 `ToolCallContent::Diff { path, oldText?, newText? }`；
- `rawInput` 与 `_meta/meta` 中已允许的稳定字段。

matching terminal `completed` 时：

- 标准 Diff 生成 `full_before_after`；
- rawInput 同时有可靠 path、`old_string | oldString`、`new_string | newString`，且
  `replace_all | replaceAll` 不为 true，生成 `full_before_after`；
- 只有成功 Edit/Write 与唯一可靠 path 时生成 `operation_only`；
- terminal 稀疏时可复用同 ToolCall 已缓存的 opening/progress 字段；失败、取消、kind 冲突或多路径不发布。

Kiro 路径规则允许 `file:` URI、绝对路径与相对 execution root 的路径。单 entry rooted-relative Diff 只有去根
锚后的路径与同 ToolCall 唯一 location 完全相等时才对齐；不做 suffix 或 basename 匹配。无法对齐但本身是合法
绝对路径时按 root 外文件保留，而不是丢弃 Evidence。

### 4.3 Claude Code

```text
assistant.tool_use
+ name = Edit
+ tool_use_id
+ input.file_path
+ input.old_string
+ input.new_string
        -> cache by tool_use_id
matching user.tool_result
+ same tool_use_id
+ non-error
        -> exact_mutation Evidence
```

`replace_all=true`、Write、NotebookEdit、ApplyPatch、字段缺失、失败、取消或缺失 result 不生成文件变化。
同一文件连续 Edit 保留为多个 chronological mutation block。

### 4.4 Antigravity

当前协议没有等价可靠终态文件内容，因此不准入 AgentRun File Changes 或 Command Diff；普通 Tool Activity 保留。

## 5. AgentRun projection

### 5.1 Timing and identity

- projector 只处理 `succeeded | failed | cancelled` Run，并在 terminal Evidence ingress 完成后执行；
- Codex/ACP 取消路径必须以同一 Host ingress fence 原子串行化“最后一次 route + enqueue”和
  “Run route unbind + queue barrier”；只有 barrier 被 Evidence consumer 确认后才能写 projection；
- cancellation ACK 可以继续完成 Run 生命周期，但 barrier 超时或 consumer 关闭时不得持久化 `no_changes`，必须保留
  缺失 projection 供 startup recovery 重放；
- 主键固定为 `(agent_run_id, execution_epoch)`，状态为 `complete | no_changes`；
- `complete` 必须有至少一个文件、summary 和 detail blob；`no_changes` 必须为空且不显示卡片；
- startup recovery 只处理缺失 projection 的 terminal Run，并复用同一归约函数；重复执行返回既有结果。

### 5.2 Source precedence

- 选择 sequence 最大的 available `runtimeRunDiff`；它存在时覆盖 operation fallback；
- 权威 snapshot 为空时结果固定为 `no_changes`，不能用更早 operation 恢复文件；
- 非空 snapshot 若不能安全解析为完整文件 sections，可回退到 terminal operation Evidence；
- 没有 `runtimeRunDiff` 时，按 sequence 汇总 available `runtimeDiff` 与 `runtimeFileOperation`。
- 同一条 terminal Evidence 的 `runtimeDiff.safeReasonCode=runtime_diff_no_changes` 时，不得再把其中的
  `runtimeFileOperation` 回退为 AgentRun card 的 `operation_only`；该 Evidence 已明确确认本次操作没有内容变化。
- 同一条 terminal Evidence 同时包含一条已准入 `runtimeDiff.entries[]` 与一个可靠单文件
  `runtimeFileOperation` 时，使用 operation path 作为该文件的 presentation identity，并把 diff 内容绑定到同一
  文件；这不是跨事件 suffix/basename 推断。多 entry Diff 不使用该规则，也不能把全部 entry 重标为一个 path。

### 5.3 Per-file reduction

- 同 path 的连续 `full_before_after`：若每次 `before` 等于前次 `after`，生成最初 before 到最终 after 的
  `full_net_diff`；最终回到初态时移除该文件；
- 链不连续：仅该文件降级为 `operation_history`，保留时序块，不声称最终净状态；
- 单个完整 unified snapshot 可形成 `full_net_diff`；
- 全部 exact mutation 形成 `exact_mutations`，逐块保留，不生成 `@@` 或推测行号；
- 全部 operation-only 形成 `operation_only`；同文件同时存在 operation-only 与可靠 Diff 时形成
  `operation_history`，保留全部 operation 的时序、原序号与 `operationCount`，但 operation-only 不进入 Diff
  统计；剩余可靠 Diff 仍按上述规则归约其可证明的 `additions/deletions`；
- `operationCount` 是该文件所含已准入 operation 数。权威 Run snapshot 可沿用同 path 已观察 operation count，
  未观察时最小为 1。

`runtime_diff_no_changes` 对应的 terminal Evidence 整体不参与文件变化投影。其余 operation 中，文件只要仍有一个
或多个可靠 Diff block，就保存这些 block 的可证明 `additions/deletions`；连续完整状态链使用最初 before 到最终
after 的净统计，其余时序块累计各自的可靠统计。只有 card 中每个文件都具有这组统计时，card totals 才可存在；
任一文件仍为纯 operation-only 时，card totals 必须为 null，UI 回退显示文件数与修改次数。

## 6. Read contract

```ts
interface AgentRunFileChangesView {
  schemaVersion: 1
  agentRunId: string
  executionEpoch: number
  files: AgentRunChangedFileSummaryView[]
  fileCount: number
  operationCount: number
  additions?: number
  deletions?: number
  completedAt: string
}
```

Camp open 只包含 `complete` summaries。detail 只能通过：

```text
agentRunFileChanges.get(campId, agentRunId, executionEpoch)
```

Core 必须验证 Run 属于该 Camp、projection 为 complete、blob schema 与 identity 一致。不能通过 blob ID、Evidence
ID 或 AgentRun ID 单独读取。detail blob 是 sensitive Managed Blob，并由 projection row 保持 GC root。

## 7. Renderer contract

- 每个 Run/epoch 至多一张时间线卡片，标题为 `Files Changed`；并行 Run 分别显示。卡片锚定在来源 Run
  最后一条公开消息之后；没有公开消息时才按 `completedAt` 进入时间线；
- 文件行对 display root 内路径显示相对路径，对 root 外路径显示规范化绝对路径；
- 每个文件都有可靠统计时显示 `N 个文件 · +A −D`；任一文件只有 operation-only 时显示
  `N 个文件 · M 次修改`，不得用其余文件的局部 totals 代替整张卡片；
- 文件名顶格，不以横线分隔。卡片默认显示三行，存在更多文件时由原位的“再显示 N 个文件 / 收起文件”控制；
- 卡片 header 显示无箭头、非品牌色的 `View` 控件；点击 header、`View` 或任一文件行进入同一个 Run 的独立
  `Files Changed` 页面，文件行进入时预选对应文件；
- Review 左侧列出该 Run 的不可变文件摘要，右侧读取 detail blob。`full_net_diff` 显示带 hunk 与旧/新行号的
  unified diff；`exact_mutations` 不显示 hunk 或行号；`operation_history` 保留全部 operation 的时序与计数，但只
  为有可靠 diff 的 operation 渲染代码块，并将可见代码块从“修改 1”开始连续编号；隐藏的 operation-only 不造成
  编号缺口。exact mutation 与 operation history 不额外显示解释提示；`operation_only` 显示
  “没有可审查的差异内容”，但仍保留文件选择与诚实说明；
- Command View 仍使用 `修改 <basename>` 与既有 File Tool 图标；逐文件 rows 不是新 Activity；
- 卡片不显示 Workspace 参与者、Git 状态、保存时间、执行台共享工作区观察或 unavailable 占位；
- Review 只读取不可变 AgentRun projection 与受管 detail blob，不读取当前 workspace、不执行 Git，也不为缺失内容
  补造行号、上下文或 diff；
- 缺少可靠 Evidence 时保持普通 Tool Activity，并且不显示 Run card。

## 8. Negative boundaries

- 不解析 shell 命令、`apply_patch` input、自由文本 patch 或当前文件；
- 不执行 Git discovery、diff、tree write、ref 操作、workspace scan 或 baseline/final capture；
- 不合并不同 Run，不因同 Camp、同 execution root 或时间重叠共享卡片；
- 不把未报告的用户、IDE、其他 Runtime 或外部进程写入归因给 Agent；
- 不把 ExactMutation 或 OperationOnly 包装成完整文件净差异；
- 不把文件变化 projection 注入模型 Context、Camp message 或 Runtime Session。

## 9. Related authority

- [Runtime File Change Observation 架构](../architecture/runtime-file-change-observation.md)
- [Execution Evidence 与 Canonical Activity 不变量](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.29-D08–D10](../versions/v1.29/decisions.md#v1-29-d08)
