---
document_type: implementation-plan
version: v0.47
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-08
---

# v0.47 实施与验收计划

> 当前状态：实现与发布前本机验收已完成。所有勾选均由同一工作树中的代码、Migration、
> 确定性测试、九 Runtime smoke、packaged App 签名和隔离 UI 验收支持；Apple notarization 未运行，
> 不属于本地完成声明。

## Checkpoint 0：设计与文档切换（已完成）

- [x] 通过七个集中问题冻结 clean break、membership release、Task authority、一次性 linked
  admission、版本矩阵、Renderer 分层和 RemoveMember 原子级联；
- [x] 接受 ADR-0136 与 ADR-0137，明确局部替代 ADR-0057/0058 的范围；
- [x] 冻结 Durable Task v2 与 Built-in Tool Transport v4 字段级合同；
- [x] 把 v0.46 冻结为 historical，创建 v0.47 概览、实施计划和生产设计，并完成九类跨版本
  文档影响记录；
- [x] 运行 `pnpm docs:check`，确认唯一 current pointer、lifecycle、索引和影响表一致。

## Checkpoint 1：受管 clean reset 与 Task v2 schema

- [x] 依 ADR-0118 增加 v0.47 clean-reset marker 与 allowlist，只清除 Rovai-owned App data；
- [x] 负向证明用户 workspace、外部 Runtime Home/config/credentials 与外部 MCP state 未变化；
- [x] 新 Task authority schema 直接使用五态、ordered Acceptance Criteria、Blocked Reason、
  Completion Summary、Cancellation Reason 与完整 Closure Metadata；不迁移四态数据；
- [x] 为 Task/member/Run/Delivery admission 增加必要索引和外键，不能把 Related execution 复制进
  TaskRecord；
- [x] CampSnapshot schema 提升到 25，旧 Snapshot/command result/replay 不翻译；
- [x] Migration 与 fresh-db 测试证明旧字段、旧状态约束、旧 list projection 和 dynamic
  `claim:<agentId>` 不存在。

## Checkpoint 2：Task model、规范化与 projected-state validator

- [x] 实现共享 `TaskStatus` 五态、`TaskDetail`、`TaskListItem/Page`、Task action 与 patch 类型；
- [x] 集中实现 title 160、description 8,000、Criteria 12×500/总计 6,000/trim exact 去重、
  reason/summary 4,000 的 Unicode 字符限制；
- [x] Create 省略/空白 description 存 `""`，省略 Criteria 存 `[]`；Update 的空数组/null 与
  clear flag 互斥按合同拒绝；
- [x] 实现一个 projected final state validator，覆盖 Assignee、blocked/closure condition、
  terminal immutability 与 `clearAssignee → pending`；
- [x] 表驱动覆盖每个非终态到五个目标状态、terminal 全拒绝、`pending → completed`、
  `blocked → completed` 和离开 blocked 自动清除 reason；
- [x] 证明 validator 不自动改变未请求 status，并且所有 Core/CLI/Renderer 提交路径共用最终
  快照规则。

## Checkpoint 3：Create/Get/Update/List 领域操作

- [x] `team.create_task` 返回事务内完整平铺 `TaskDetail`，初始 `pending/version=1`；
- [x] 在 create 事务内强制每 Camp 512 个非终态 Task 与每 source AgentRun 累计 32 个 Task；
- [x] 新增 `team.get_task` / `get_visible_task`，对 missing/cross-Camp/invisible 统一
  `task.not_found`；
- [x] `team.update_task` 按合同固定顺序执行 visibility、terminal、authority、expectedVersion、
  normalization、projected state、no-op 与 persistence；
- [x] no-op 返回 `changed=false`，version/updatedAt/event 不变，仍持久化 command result；旧
  expectedVersion 不能借 no-op 绕过 CAS；
- [x] Applied create/update 在同一事务形成完整 exact-version canonical result 并持久化，禁止
  commit 后 live get 拼接；
- [x] `team.list_tasks` 使用 SQL projection 完成 visibility/filter/preview/`limit+1`，按
  `createdAt DESC, taskId DESC` 稳定分页；默认含 blocked；
- [x] Get/List 不成为 waiting primitive；Bootstrap、Tool Description、Help 与 tests 明确禁止
  polling。

## Checkpoint 4：Visibility、Task authority 与错误隐私

- [x] User/Default Lead 读取和更新 Camp 内全部非终态 Task，包括取消；Lead 权限只进入 Task
  service，不能扩张到成员、Runtime、Memory 或其他管理命令；
- [x] 普通 Agent 可读 own/unassigned/created Task，只能更新当前 own Task，允许编辑、转交、
  释放、阻塞、完成但不能取消；
- [x] 普通 Agent 只能以一次 update 把 unassigned Task 认领给自己，projected final status 只允许
  pending/in_progress/blocked；组合式 claim-and-close 必须拒绝；
- [x] Creator-only visibility 不产生对已分配他人的更新权；System actor 无业务 Task read/mutation；
- [x] 删除所有 Member-level Task Capability gate，同时保留认证 Run、current Camp、ownership、
  Lead role 与 state 的逐次授权；
- [x] `availableActions` 只返回 `update | claim`，terminal/creator-only 为空，不返回动态字符串；
- [x] 测试不可见 Task 不泄漏 terminal/version/Assignee/Camp；version conflict 只在 visibility 与
  authority 之后暴露安全 currentVersion。

## Checkpoint 5：Membership ending 与 RemoveMember 原子级联

- [x] 提取唯一内部 membership-ending 领域路径；单 Camp leave 与 RemoveMember 级联都调用它；
- [x] 同一 Camp transaction 将离开成员负责的 pending/in_progress/blocked 全部置 pending、清除
  Assignee/Blocked Reason、增加 version/updatedAt，并记录
  `cause=assignee_membership_ended`；
- [x] terminal Task 保留历史 Assignee；`present → away` 不释放，不创建 CampMessage 或新 Task 卡；
- [x] membership-ending path 同时按既有规则完成 Default Lead successor/reconcile 和 membership/
  Task/Lead audit；
- [x] `RemoveMember` 继续只以 queued/running/waiting AgentRun 为安全 blocker；计数大于 0 返回
  `agent_profile.non_terminal_runs`；
- [x] 计数为 0 时在一个数据库事务枚举并结束全部 Current CampMembership，所有 Camp 成功后才
  标记 Profile removed；任意 Camp/Task/Lead/audit 故障全部回滚；
- [x] Removal preview 返回 `nonTerminalAgentRunCount/currentCampMembershipCount/
  openAssignedTaskCount/defaultLeadCampCount`，并以稳定 snapshot 支持确认；
- [x] 测试 accepted pre-materialization Delivery 不计入 Run gate，但 Profile removed 后可因独立
  recipient eligibility 停止 materialization。

## Checkpoint 6：一次性 Task-linked responsibility admission

- [x] Direct path 在创建 linked queued AgentRun 的同一事务执行唯一 Task admission；
- [x] A2A path 在 MessageDelivery responsibility 持久接受的同一事务执行唯一 Task admission；
- [x] Admission 要求同 Camp、Task pending/in_progress、recipient 是当前 Executable Assignee，
  并冻结 `taskVersionAtAdmission/assigneeAgentIdAtAdmission`；
- [x] message/purpose/expectedOutput 继续拥有执行指令，不复制完整 Task snapshot；
- [x] 删除 queued Run dispatch/start 处按 Task current status/Assignee 的二次检查；
- [x] 回归证明 accepted 后 Task blocked/completed/cancelled/reassigned/unassigned/content edit 均不使
  Delivery/queued Run/running Run 单独失败、取消、重定向或停止物化；
- [x] 保留并覆盖 Current CampMembership、Presence、Runtime readiness、cancellation、budget、
  lease/scheduler、lineage/capacity、permission/safety 的独立 current checks；
- [x] 验证 Task cancelled 与 Delivery/AgentRun/CampTurn cancellation 各自产生独立 audit，互不
  伪装或级联。

## Checkpoint 7：Built-in Transport v4 与十三项 CLI

- [x] 固定 v4 版本矩阵、13 项 catalog、`builtin_cli.transport.v4` 与 digest coverage；
- [x] 添加 `rovai task get` parser、输入来源互斥、简短 help、Bootstrap/Charter/Skill 和 catalog
  Tool Description；
- [x] Task create/update Core canonical result 改为完整 snapshot，Agent stdout 分别显式投影
  6/7 个字段；get 输出完整 detail，list 输出 compact page；
- [x] 为 13 项 operation 建立 closed input/result/`agentOutputSchema`、projection identity、golden
  fixtures 与错误 fixtures；
- [x] Envelope/IPC/receipt 保持 v1，完整 Envelope validation 先于 projection，receipt/replay/
  evidence 不受 compact stdout 影响；
- [x] 删除 transport v3 runtime capability、12-command Bootstrap、四态 Task fixtures、旧 result
  shape、dual catalog、translation 和 mixed-version path；
- [x] 更新 catalog/preflight/packaging 静态检查，v3 Core/CLI/lease/context 与 v4 混合时 fail closed。

## Checkpoint 8：Renderer Read Side 与 Task UI

- [x] CampSnapshot v25 提供五态 Task Detail/List 与 audit cause，并保留 Renderer 可派生
  AgentRun/Delivery 的既有 identity 关系；不得向 TaskRecord 添加 execution relation；
- [x] 会话创建位置唯一实时卡只显示中文五态文字、title、当前负责人；所有更新原地刷新，不新增
  消息、不移动、不重排、不自动滚动；
- [x] Inspector list 显示 title/status/Assignee、单行状态相关 preview 与 Criteria count，不加载
  完整正文；
- [x] Inspector detail 显示完整内容、ordered Criteria、creator/source Run/version/timestamps、
  reason/summary/closure/audit cause；
- [x] Related execution 从 Snapshot relation 派生，只读显示关联数量、状态与进入现有 Run detail
  的入口；不得进入 TaskRecord 或反向改 Task；
- [x] Editor 按表单 projected final state 动态展示和要求条件字段；terminal 详情只读；
- [x] User/Lead-only 取消入口仍提交 `tasks.update(expectedVersion,status=cancelled,cancelReason)`，
  必填原因并明确不会取消已接受/运行的 AgentRun；
- [x] Version conflict 刷新最新 detail、保留未提交草稿、提示重新确认，不静默覆盖或自动 replay；
- [x] Membership 自动释放只实时更新卡/list/detail 和 audit，不生成消息、卡片或“Agent 主动修改”提示；
- [x] 永久删除确认使用中文，展示将离开的 Camp 与将释放的未完成 Task 数量；非终态 Run
  blocker 也使用可行动的中文说明。

## Checkpoint 9：确定性测试、恢复与静态清理

- [x] Rust 单元/集成覆盖字段边界、Criteria 去重/顺序、迁移矩阵、projected validation、权限矩阵、
  creator visibility、availableActions、capacity、cursor/preview 和 error privacy；
- [x] 并发覆盖 create capacity、version CAS、no-op stale version、membership release、multi-Camp
  RemoveMember rollback 和 exact command result Replay；
- [x] Delivery/Run fixture 覆盖 admission race、grandfathering、explicit cancellation、removed identity、
  restart/recovery、lease fence 与 capacity；
- [x] TypeScript contract/Renderer tests 覆盖五态、list/detail 分层、terminal read-only、cancel warning、
  draft preservation、related execution 与自动释放；
- [x] 静态扫描证明当前源、schema、fixture、Bootstrap/help/smoke 中无四态 enum、动态 claim action、
  旧 Task result、12-operation 常量或 dispatch-time Task fence；历史文档不计为当前残留；
- [x] 执行 `cargo fmt --check`、`cargo test --workspace --no-fail-fast`、`pnpm typecheck`、`pnpm test`、
  `pnpm docs:check` 和相关 focused suites。

## Checkpoint 10：桌面、Runtime 与发布验收

- [x] 在 1440×920、1040×700、200% Zoom 验收卡/list/detail/editor/delete dialog，无横向溢出，
  Inspector 可纵向滚动，关键操作不依赖 hover；
- [x] 完整键盘、visible focus、Dialog focus trap/return、screen-reader status 与 conflict announcement
  通过；
- [x] `pnpm smoke:builtin-cli` 对九种正式 Runtime 完成 13 项 v4 operation、get/list、version conflict、
  no-op、旧 v3/四态输入负向、Envelope evidence、lease fence 与 new lease；
- [x] `pnpm smoke:recovery` 验证 crash/restart 后 command/admission/release/Run grandfathering 无重复与
  无二次 Task fence；
- [x] `pnpm smoke:intake` 验证真实 Runtime 不依赖 discovery 或 Task polling；
- [x] `pnpm package:mac`、deep/strict codesign、打包 Core/CLI v4 capability 与 packaged App smoke
  通过；未运行 notarization 时不得声称公证通过；
- [x] 以新一轮真实 v4 证据原子更新 Runtime compatibility，不覆写 v0.46 historical evidence；
- [x] 所有门槛有可复现证据后，才把 v0.47 `implementation_status` 和本计划 `status` 改为
  `complete`。

## 发布前审阅清单

- [x] Task 仍是责任记录，不是执行/通知/workflow 容器；
- [x] Default Lead authority 只在 Task domain 生效；普通 Agent 永远不能取消；
- [x] `away` 与 membership ending、Task cancellation 与 execution cancellation 没有混淆；
- [x] RemoveMember 的所有 Camp 收口原子，Task release cause 仍是 membership ending；
- [x] accepted responsibility 只在 acceptance boundary 做一次 Task admission；
- [x] UI 四层没有重新合成复杂 Task 卡，删除和取消文案为中文且说明真实副作用；
- [x] 合同、代码、Migration、测试、九 Runtime、打包 App 和版本状态没有互相冒充完成证据。
