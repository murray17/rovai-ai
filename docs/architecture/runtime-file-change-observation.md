---
document_type: architecture
architecture: runtime-file-change-observation
authority: command-and-agent-run-file-change-boundaries
status: accepted
last_updated: 2026-08-28
---

# Runtime File Change Observation 架构

字段、归约与授权接口见 [Runtime File Change Observation v3](../contracts/runtime-file-change-observation-v3.md)。
本架构只消费 Runtime 明确报告的文件变化，不读取当前文件、不扫描工作区，也不依赖 Git。

## 产品模型

```text
Runtime terminal file event
  -> Adapter-specific public normalizer
  -> exact managed-output-root exclusion
  -> append-only Execution Evidence
       -> Canonical Activity projector
            -> Command View `阅读 | 新增 | 编辑 <file>`
            -> optional inline Command Diff
       -> AgentRun file-change projector
            -> one projection per agentRunId + executionEpoch
            -> one timeline card `Files Changed`
            -> inline file detail
```

`Command Diff` 回答一次 Operation 明确报告了什么；`AgentRun File Changes` 汇总一个 Run 在本次 execution epoch
中已经成功报告的文件变化。两者读取同一份 append-only Evidence，但分别投影，不互相依赖，也不创建第二套
Canonical Activity。

工作区当前状态不属于这条观测链。产品没有 baseline、final、Window、participant、coordinator、Git tree、
checkpoint ref 或 filesystem capture；Git 与非 Git execution root 使用相同能力。

## 组件职责

### Runtime Adapter normalizer

- Adapter 只接纳它能从协议结构化字段证明的成功 read/write 文件操作、完整 before/after、完整 unified diff snapshot 或 exact
  mutation；失败、取消、字段不完整和自由文本保持普通 Tool Evidence；
- 路径按 Run 冻结的 execution root 做纯词法规范化，该 root 也是 display root。root 内转换为相对路径；root 外
  保留规范化绝对路径。相对 `..` 可解析到 root 外，但不能越过文件系统根；其他 URI scheme、Git metadata 路径和
  不明确多路径 fail closed；
- Core 同时向 normalizer 传入当前 Built-in Tool Process 的 typed `run_tmp`。解析后的 path 等于该 root 或位于其下
  时只写安全 unavailable 诊断，不形成文件 path 或 Diff；这是逐 component 的精确排除，不扩大到 data dir、
  process root、其他进程目录或 `run-tmp-copy`；
- mixed Diff 逐 entry 保留普通文件；Codex whole-turn snapshot 在 durable ingress 前逐 `diff --git` section 执行
  同一过滤。全部 section 被排除时保存权威空 snapshot，startup recovery 不会从更早 operation 重新引入；
- 规范化不打开文件、不解析 shell 命令，也不从 Tool 显示名、stdout/stderr 或当前磁盘补全缺失事实；
- Evidence 保留来源语义和原始 old/new 或 diff 内容。Renderer 所需 unified diff 是 projection，不反向改写
  Evidence。

### Canonical Activity projector

- 成功的可靠单文件 read/write operation 可在原 Canonical Activity 上形成阅读／编辑 presentation row；明确
  `changeKind=add` 的 Diff 行可显示新增，只有 write path 时保守显示编辑；
- 有可靠内容时，同一行再获得 `diffProjection`、增删计数与 inline disclosure；只有 path 时仍显示文件行，但不
  伪造计数或空 diff；
- Activity identity、phase、outcome、排序和 operation count 继续由既有 Canonical Activity 拥有。逐文件行只是
  presentation rows；
- `apply_patch` 等 Runtime 原始 Tool 名不作为 Diff 数据源，也不形成父级聚合行；
- managed output 的 unavailable projection 只保留内部诊断，不形成带 path 的文件行或 inline Diff；原 Tool
  Activity 仍可按可靠 Runtime kind 保持普通 file/tool 分类与通用 presentation。

### AgentRun file-change projector

- 投影 key 是 `agentRunId + executionEpoch`。Core 在 Run terminal ingress 已落库后执行；成功、失败或取消 Run
  都可以包含 terminal 前已经确认成功的文件操作；
- schema 2 `operationKind=read` 永远不进入本投影；schema 1 历史 write/changeKind 和 schema 2 write 继续按既有
  规则归约；
- 正常 terminal callback 本身位于顺序消费的 Runtime ingress queue 中；取消路径则由 Host 级 ingress fence 将
  `route + enqueue` 与 `unbind + barrier` 串行化。Core 只在 barrier 被 consumer 确认后投影，不能让已选中 owner
  但尚未入队的终态文件事件落到 `no_changes` 之后；
- projector 按 Evidence sequence 读取完整受管 payload。最新权威 Run snapshot 优先覆盖 display root 内文件；
  root 外不属于该 snapshot 的范围，显式 terminal file evidence 仍补入同一张卡。没有权威 snapshot 时使用同 Run
  的全部 terminal file evidence；
- 同一 terminal Evidence 只有一条 admitted Diff entry 且同时有一个可靠单文件 operation path 时，后者是该文件
  的 presentation identity，Diff 内容直接绑定到同一文件；多 entry Diff 不进行该重标，且不跨事件做 basename
  或 suffix 猜测；
- terminal Evidence 已用 `runtime_diff_no_changes` 明确确认没有内容变化时，projector 不再把同事件的 path-only
  operation 回退成卡片文件；
- 每个文件按语义归约：连续 `FullBeforeAfter` 链可合成为首态到末态的净差异，回到首态则移除；链断裂只让该
  文件降级为 operation history，不影响其他文件；`ExactMutation` 保留时序；`OperationOnly` 保留成功操作、
  原序号和 operation count，但不参与 Diff 统计；
- 移除 `runtime_diff_no_changes` 后，同文件只要仍有可靠 Diff，就按其语义计算逐文件 `+A −D`：连续完整状态链
  使用净统计，其余可靠块累计统计。只有所有文件都有可靠统计时卡片才显示总 `+A −D`；任一文件只有
  operation-only 时，整张卡片回退为 `N 个文件 · M 次修改`；
- 投影状态为 `complete | no_changes`。`complete` 的 detail 进入 sensitive Managed Blob；`no_changes` 是内部
  幂等 checkpoint，不进入会话；
- startup recovery 对尚未投影的 terminal Run 重放同一 projector。唯一键与不可变 source Evidence 保证每个
  execution epoch 至多一张卡片；取消 barrier 无法在期限内证明完成时保留缺失 projection，不提前写
  `no_changes`，由 recovery 在已有 Evidence 上重放。

### Read Side 与 Renderer

- Camp open 投影每个 Run 的卡片摘要；Renderer 将卡片锚定到来源 Run 的最后一条公开消息，没有公开消息时才按
  `completedAt` 排序。并行 Run 不合并，后完成的 Run 不覆盖先前卡片，也不会被摆到其他 Run 的消息之后；
- detail RPC 必须同时匹配 `campId + agentRunId + executionEpoch`，不能仅凭 Run ID 或 Managed Blob ID 读取；
- Renderer 卡片默认只显示三行；header 的 `View` 与文件行进入同一独立 Review，文件行预选对应路径。Review
  完整净差异显示 unified diff；exact mutation 显示没有虚假 hunk/行号的片段块；operation history 保留全部
  operation 的时序、计数和原始序号，但不为 operation-only 记录渲染空白占位块；operation-only 文件显示诚实空态；
- 卡片和 Review 都只消费 typed projection 与受管 detail blob，不读取当前 workspace 或执行 Git；
- 没有可靠文件 Evidence 时不显示卡片，不显示 unavailable 占位，也不读取当前 workspace 重建；
- 历史 v1 Evidence 与既有 projection 不 backfill、不重写；exclusion 只作用于新 ingress，Renderer/read wire 不变。

## Runtime 边界

### Codex app-server

- Command View 只使用 terminal `item/completed`、`item.type=fileChange`、`item.status=completed`；
- Run card 优先使用当前 turn 最新 `turn/diff/updated`，但只在匹配的 `turn/completed` 后以
  `runtime.file_changes.snapshot` Evidence 发布。空 snapshot 是 display root 内的权威 no-change；显式 root 外
  terminal file evidence 不被它吞掉；
- snapshot 发布前过滤当前 exact `ROVAI_RUN_TMP` sections；普通 root 外用户文件仍保留，全部过滤后保持权威空值；
- 没有可解析 snapshot 时使用 terminal fileChange Evidence fallback。`item/fileChange/patchUpdated` 和
  `apply_patch` input 不接入。

### ACP

- 同一 ToolCall 累计 opening/progress/terminal 的标准 locations、Diff content、`rawInput` 与 `_meta/meta`；只有
  terminal completed 才可发布；
- 标准 ACP Diff 形成完整 before/after。可靠单路径但没有 Diff 时形成 `OperationOnly`；
- `rawInput` 的 `file_path | filePath | filepath` 只用于稳定路径，`old_string | oldString` 与
  `new_string | newString` 字段完整且 `replace_all != true` 时形成 FullBeforeAfter；
- failed/cancelled terminal 不发布。Kiro 的 `file:` URI、绝对路径、相对路径与已知 rooted-relative Diff 只按
  同 ToolCall 的唯一 location 做严格对齐，不做 suffix 猜测；合法 root 外绝对路径仍可作为展示路径；
- ToolCall 的唯一 location 命中当前 managed output root 时，path-only 与绑定的单 entry Diff 都 fail closed；
  其他 ToolCall 和普通 root 外路径不受影响。

### Claude Code 与 Antigravity

- Claude Code 只配对 `assistant.tool_use(name=Edit)` 与相同 `tool_use_id` 的非错误 `user.tool_result`，保存
  `file_path + old_string + new_string` 的 ExactMutation；`replace_all=true`、Write、NotebookEdit、ApplyPatch、
  缺失或失败 result 均不准入；
- 同一文件连续 Edit 保留多个时序块，不合并为虚假的完整文件净差异；
- Antigravity 当前没有等价可靠终态内容，因此不生成文件变化卡片或 Command Diff。

## 故障边界

- 文件变化是附加观察能力；Evidence 归一化、投影或 detail blob 失败不能反向改变 Run 终态；
- 失败只记录安全诊断并允许启动恢复重试，不扫描文件系统补偿；
- Managed Blob 由 projection row 作为 GC root。Camp 删除遵循既有 Run/Evidence/Blob 引用闭包；
- `ROVAI_RUN_TMP` 是可重置的临时交付区；通过 `rovai send --file` 成功发布后的 Managed Attachment 属于独立资源
  合同，临时源路径不因此成为文件变化；
- 文件变化 Evidence 不进入模型上下文、Runtime Bootstrap、Camp public message 或 Agent built-in 读取面。

## 相关规范

- [Runtime File Change Observation v3](../contracts/runtime-file-change-observation-v3.md)
- [Execution Evidence 与 Canonical Activity 不变量](foundational-invariants.md#evidence-canonical-activity)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [v1.29 决定](../versions/v1.29/decisions.md#v1-29-d08)
- [V1.29-D13 managed output exclusion](../versions/v1.29/decisions.md#v1-29-d13)
