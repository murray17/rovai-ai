---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-27
---

# v1.29 Camp 动态队员管理与 Runtime 文件变化实施计划

本计划记录 v1.29 当前实现与验收事实。Camp 动态队员管理、Managed Attachment v2 与 ACP Client FS/Terminal
权限收敛已完成；Runtime File Change Observation 的代码主路径已完成，真实打包 App 多 Runtime smoke 仍是交付项。
本版本未发布，旧 Workspace Change Window 实现按 clean break 删除，不承担兼容责任。

## 1. 已完成：Camp membership 与 Managed Attachment v2

- [x] 完成添加、移除、至少一位成员、Lead successor、generation/version、exact membership lifetime、原子
  cutover 与 durable reconciliation；
- [x] 完成 Message Delivery zero-attempt cancelled terminal，并保证 terminal 状态不复活；
- [x] 完成 Managed Attachment v2：durable ingest intent、CampMessage refs、无 active Run publication gate、
  DB-only Context descriptor 与 legacy v1 只读兼容；
- [x] 完成 Migration 113 planned shutdown v3：保留历史 pending v2 cycle，退出、重启与更新统一取消全部非终态
  AgentRun，并以 400ms 门槛抑制快速启停反馈闪现；
- [x] 完成 Desktop typed IPC、Camp Open projection、Renderer 权威预览与定向/完整门禁；
- [x] 当前模型上下文保持 Collaboration State v2，只在新 Run 冻结当前 peers。

## 2. 已完成：ACP Client FS/Terminal 权限

- [x] 删除 ACP Client FS one-time file authorization、Core execution-root containment 与 Workspace access 判定；
- [x] 自动/绕过模式对合格 `session/request_permission` 返回 native allow 只作协议兼容，交互模式保留 Approval；
- [x] `fs/read_text_file` / `fs/write_text_file` 的绝对路径按 Runtime 请求执行，相对路径以 execution root 为基准；
- [x] `terminal/create` 的显式 cwd 只要求绝对、存在且为目录；省略 cwd 仍使用 execution root；
- [x] 保留 Run/epoch/Session/Prompt/cancel/detach fence、进程树、输出限制、kill/release 与清理；
- [x] 回归覆盖 root 外读写、连续写、readback、root 外 terminal cwd、相对/不存在 cwd 拒绝与默认 cwd。

## 3. 已完成：Workspace Window clean break

- [x] 删除 `workspace_change.rs`、Core coordinator、Run admission/cancel/terminal Window hooks 与 startup recovery；
- [x] 删除 Git repository discovery、stable capture、synthetic tree、tree-to-tree diff、Git child runner、
  `refs/rovai/w/*` 和 ref cleanup；
- [x] Migration 114 只保留 Canonical Activity Command Diff 列；Migration 115 改为
  `agent_run_file_change_projection`，不创建或迁移任何 Window/participant/ref 表；
- [x] 删除 Window Evidence event、Managed Blob roots、Camp Open fields、Desktop RPC、旧 Workspace Window Review 与
  Window UI；
- [x] 删除当前 Architecture/Contract/版本/UI 文档中的 Window authority 与 HTML prototype；历史版本冻结文档不改；
- [x] 当前 Data Contract 升为 `v1.28 / projection schema 69`，让使用过未发布 Window schema 的本地数据 fail
  closed，而不是运行时查询缺失新表。

## 4. 已完成：Runtime Evidence normalizer

- [x] Evidence 保留 `full_before_after | unified_diff_snapshot | exact_mutation | operation_only` 的源语义与完整
  bytes；Command projection 需要时确定性构造 unified diff；
- [x] 路径以 execution root 作为 display root：root 内使用相对路径，root 外使用规范化绝对路径；相对 `..` 可解析
  到 root 外，其他 URI、越过文件系统根的无效路径与 Git metadata 拒绝；
- [x] Codex terminal `item/completed.fileChange.completed` 继续拥有 Command View；缓存最新
  `turn/diff/updated`，只在 matching `turn/completed` 后发布 Run snapshot，空 snapshot 保留为权威 no-change；
- [x] ACP 同 ToolCall 累计 kind、locations、standard Diff、rawInput、stable `_meta/meta`；稀疏 terminal 可使用
  opening/progress 字段；成功 Edit/Write 的唯一 path 可形成 OperationOnly；
- [x] ACP `file_path | filePath | filepath` 与 `old_string | oldString`、`new_string | newString` aliases 在字段完整且
  `replace_all != true` 时形成 FullBeforeAfter；失败、取消、冲突或字段不完整不发布；
- [x] Kiro rooted-relative standard Diff 只与同 ToolCall 唯一 location 精确对齐；不做 suffix 猜测；
- [x] Claude Code 只配对原生成功 Edit 的 `tool_use_id`，保存 ExactMutation；Write、NotebookEdit、ApplyPatch、
  replace-all 与 Antigravity fail closed；
- [x] 不解析 shell、Tool title/output 或当前文件，不推测异常退出前的修改。

## 5. 已完成：AgentRun file-change projector

- [x] 新增 `(agent_run_id, execution_epoch)` 唯一 projection，状态 `complete | no_changes`；
- [x] projector 在 `succeeded | failed | cancelled` terminal ingress flush 后运行；取消/失败 Run 可收录此前成功
  operation，失败/取消 operation 不进入；
- [x] Codex/ACP cancellation 以 Host ingress fence 串行化 route/enqueue 与 unbind/barrier；barrier 未确认时不固化
  `no_changes`，保留缺失 projection 给 startup recovery；
- [x] 最新 Runtime Run snapshot 优先覆盖 display root 内文件；空 snapshot 只表示该 root 内 no-change；显式 root
  外 terminal Evidence 仍补入卡片，缺失或不可安全解析时使用全部 terminal operation Evidence fallback；
- [x] 连续 full-state 链收敛为首态到末态，roundtrip 移除；chain mismatch 仅降级该文件；exact mutation 按
  sequence 保留；operation-only 不伪造内容；
- [x] `runtime_diff_no_changes` 不进入卡片；同文件 path-only operation 只保留时序与 operation count，剩余可靠
  Diff 继续归约逐文件 additions/deletions；只有所有文件都有可靠统计时才计算 card totals；
- [x] detail 写入 sensitive Managed Blob，projection row 是 GC root；summary 进入 Camp Open；
- [x] detail RPC 以 `campId + agentRunId + executionEpoch` 授权并复核 blob schema/identity；
- [x] startup recovery 对缺失 projection 的 terminal Run 重放，同一 Run/epoch 至多一张卡片；
- [x] 集成回归覆盖非 Git directory、三个并行 Run、failed/cancelled card、空权威 snapshot no-card 与 replay 幂等。

## 6. 已完成：Renderer presentation

- [x] Command View 扁平显示同级 `修改 <basename>` rows，复用既有 File Tool 图标与完整横条；
- [x] 删除 `apply_patch` 父行、“编辑了 N 个文件”聚合层；逐文件 row 不创建 Activity；
- [x] 每 Run 卡片标题为 `Files Changed`，并行 Run 分别进入既有会话时间线；
- [x] 文件名顶格、无横线分隔；默认三行并可展开/收起清单；header 使用无箭头、浅边框的 `View`；
- [x] header 与文件行进入同一个 Run 的独立 Review，文件行预选对应路径；返回恢复会话；
- [x] Review 的 `full_net_diff` 显示 totals、hunk 与可靠行号；exact/history 按块显示且没有虚假 hunk/行号；
  operation-only 显示诚实空态；有可靠 Diff 的 mixed file 显示可证明 totals，含纯 operation-only 文件的 card
  不显示局部 totals；
- [x] 不改变会话连接轨、底部/右侧执行台、Tool list 宽度与其他既有视觉结构；
- [x] Renderer fixtures 覆盖每 Run card、三行默认、mixed totals 隐藏、四种 Review mode 与 typed Camp Open。

## 7. 自动化验证

- [x] Rust 定向回归覆盖 Evidence 保存、Command Diff reconstruction、路径/URI、Codex snapshot、ACP sparse
  terminal、projector 归约/恢复与 Migration 115；
- [x] TypeScript typecheck 通过；
- [ ] `cargo test -p rovai-core` 全量通过；
- [ ] Renderer/Vitest 全量通过；
- [ ] `pnpm docs:test`、`pnpm docs:check` 与精确 merge-base `docs:check:ci` 通过；
- [ ] Desktop production build 通过；
- [ ] Impeccable final detector 对本次 UI targets 只运行一次并通过。

## 8. 真实 Runtime 验收

- [x] Claude Code `2.1.220` 旧路径已证明原生 Edit matching terminal Evidence 与无虚假 hunk；
- [ ] 使用本次 clean-break build 复测 Codex Command rows、权威 Run snapshot、空 snapshot 与 fallback；
- [ ] 复测 Kimi Code `0.38.0` 的 path-only Command row + operation-only Run card，以及 Qoder `1.1.28` 的
  path-only Write 计数、可靠 Edit Review 与 card `+ / −` 聚合；
- [ ] 复测 Kiro `2.18.1` 的标准 Diff、`file:`/绝对/相对路径和 inline presentation；
- [ ] 对其余当前可用 Runtime（不含明确排除项）逐个记录 terminal file-change capability；没有可靠事件时保持
  no-card，并将真实 wire 结论写回 [Runtime compatibility](../../runtime-compatibility.md)；
- [ ] 在 Git 与非 Git Camp、并行 Run、failed/cancelled Run、日/夜主题和键盘下完成打包 App 验收。

## 交付阻断条件

- 任一路径仍创建/读取 Window、baseline/final、synthetic tree、checkpoint ref 或扫描 workspace；
- Run card 从当前文件、shell 命令、Tool 文案或未准入 raw 字段推测变化；
- 不同 Run/epoch 被合并，或一个 Run 的 projection 等待另一个 Run；
- failed/cancelled operation 被当作成功变化，或空权威 snapshot 被 fallback 覆盖；
- operation-only 被计入 Diff 统计、含纯 operation-only 文件的卡片显示局部 totals，或 exact/history 显示虚假
  hunk/行号；
- detail 可以绕过 Camp + Run + epoch 读取，或受管 blob 没有 GC root；
- Renderer 改动无关会话/执行台结构，或把 Files Changed Review 重新耦合到 Window/共享 workspace 文案；
- 当前 Architecture、Contract、Version、Decision、UI 或 routing 文档仍把 Git Window 描述为现行能力；
- 定向 fixture 尚未完成真实 App smoke，却被表述为 Runtime 实测成功。
