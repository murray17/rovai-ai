---
document_type: implementation-record
version: v1.72
authority: implementation-evidence
last_updated: 2026-10-08
---

# 用户主动继续执行实施记录

本文保留首轮 v1 与后续修正的验证时间线；当前会话策略见末节“2026-10-08 会话自动选择与投递前降级”及
[Continuation v2](../../contracts/agent-run-continuation-v2.md)。

## 工作区

- worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-run-continuation`
- branch：`rovai/run-continuation`；base：`origin/main` / `b20b1f69`；状态：merged（PR #664，原 worktree 已清理）。
- Governance：无独立主线先行提交要求；已确认 r2 的合同和实施记录随本分支交付。
- 授权：User 在审阅 r2 后明确要求独立 worktree 实现并推送；[输入对照](model-context-change-run-continuation.md) 已确认。
- 原工作区既有图片菜单变更及其他 worktree 均保留。

## 实施大纲

1. 新 User 命令原子提交系统操作、授权记录与 waiting Delivery，复用命令回执和唯一调度器。
2. 队首按批次边界领取，完整承接原业务输入；Core 重验当前范围，清理完成才创建新 Run。
3. 新 Run 复用当前 Context builder；会话兼容时恢复，显式新会话保留工作区，恢复失败不隐式回退。
4. Desktop / Web 共享 24×24 继续图标与单次会话确认；原 Run 状态不传播、同一来源可多次请求。
5. Migration 184 / schema 134 增量保存请求；旧输入／Manifest／接受事实不修改。

## 影响范围

| 范围 | 结论 |
| --- | --- |
| 产品与 UI | 执行卡片纯图标；等待请求与新 Run 独立显示 |
| 架构 | 继续是 User 新授权，沿用现有 lane 与 Conversation |
| 合同与传输 | Continue v1、Recovery v7、Delivery v11、Host Web v5、Surface v45；Web protocolVersion 仍为 4 |
| 数据与迁移 | v1.72/schema 133 → 134，保留全部旧证据，不做 clean break |
| 模型上下文 | 输入选择入口新增；现有 builder、字段、Formatter 32、Run Facts 9、Profile 10 保持 |
| Runtime 与工作区 | 清理门禁保持，续做恢复失败不得空会话回退，工作区不重置 |
| 权限与业务 | 仅 User，选中 Run 范围；不重开 Task/Mission/Automation |
| 测试与观测 | 事务、幂等、隔离、顺序、迁移和生产组件交互；系统操作进入普通时间线 |
| 分发与运维 | 独立分支提交／推送；不替换日常 App，不修改日常数据 |

## 测试准入

- `delivery_queue::tests::user_continuation_preserves_source_and_claims_independent_fifo_batches` 拥有新授权跨模块事务：
  原实现无此入口，需证明回滚、同命令幂等、同来源多次请求、重开数据库、FIFO、清理及来源不变，纯函数不足。
- `delivery_queue::tests::continuation_rechecks_scope_and_requires_explicit_session_replacement` 拥有 User 准入与会话确认：
  覆盖越权、活动 Run、Thread 不匹配、绑定不兼容、确认后轮换、恢复失败和排队输入失效。
- `db::run_continuation::tests::continuation_migration_rolls_back_and_preserves_frozen_evidence` 拥有新约束迁移回滚与重开：
  需要 SQLite DDL、回执及证据一起提交；已有 pending-draft owner 不拥有输入约束变化。
- 三项新增 Rust owner 均进入 `extended-tests`。最小命令：
  `cargo test -p rovai-core --lib --features extended-tests continuation`。
- Renderer 批次边界扩展现有 `App.test.ts`；生产图标、键盘、连点、同请求核对与新会话确认由
  `pnpm test:run-continuation-ui` 的隔离 Chrome fixture 拥有，不调用真实模型。

## 验证记录

| 命令／范围 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 238 个 Vitest 文件／2602 项通过；Node 334 项通过、2 项平台跳过 |
| `pnpm test:rust:pr` | Rust workspace 453 项通过、1 项既有忽略；Core、CLI、Host 与 Web 均通过 |
| `pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts` | 最终队列排序修订后 181 项通过；相同时间戳保留后端排队顺序 |
| `cargo test -p rovai-core --lib --features extended-tests delivery_queue:: -- --test-threads=2` | 24 项通过，包括两项新增续做 owner |
| `cargo test -p rovai-core --lib --features extended-tests db:: -- --test-threads=2` | 覆盖 99 项；首次 95 项通过，4 项旧版本夹具修正后分别定向复验通过 |
| `pnpm test:run-continuation-ui` | 生产组件在隔离 Chrome 中通过图标尺寸、键盘、连点、独立请求、原状态不变、响应丢失核对与新会话确认 |
| `pnpm build:desktop` | Web／Execution Web／Electron 构建通过 |
| `cargo fmt --all -- --check`、`git diff --check` | 通过 |
| `DOCS_BASE_REF=b20b1f69 pnpm docs:check:ci` | 版本及 diff-aware 文档治理通过 |

数据库回归修正的是测试夹具：当前 migration receipt 预期、导航读模型调用前补齐当前增量表、
历史 requeue 领取前升级至当前 schema，以及旧 Thread lineage 测试撤销后续迁移表。
未放宽生产准入、未退役测试、未添加治理检查例外。新增 Migration 184 的事务回滚与证据保留 owner 通过。

浏览器截图保存在此 worktree 的 `out/verification/run-continuation/`；测试使用 Mock 传输，
不代表真实 Runtime 恢复或模型质量对照。

2026-10-08 已完成下述真实 Codex 续做专项；通用 12 Case 新旧模型／Judge 对照 Gate **未执行**。
专项运行不替代该语义 Gate，本项尚无冻结的通用评测模型、Judge 和预算配置；不沿用其他工作项的豁免。
按[上下文变更治理](../../development/model-context-change-governance.md#真实任务-gate)“PR 前保留新旧实际执行对照”的要求，
首次分支提交／推送后保留了 worktree，未创建 PR。2026-10-08，User 在收到该验证缺口说明后明确要求
“pr到main merge”（Thread 消息 `74345281-cd4c-437f-9143-7deb956a07ee`）。按本次 User 指令推进 PR 与合入，
保留 Gate 未执行的事实，不把已有专项或 CI 通过表述为通用模型评测通过。

## 恢复失败历史修正与真实 Runtime 专项

User 对 `39ab0d0e` 的复核指出：历史 `continuation_session_unavailable` 会压过同一会话之后的成功。
修正只查询既有成功事件和 Runtime Input Delivery；同一当前绑定的可信原生完成发生在失败之后，
旧失败就不再要求新会话。事件不删除，未知输入门禁不放宽，未增加 Schema、提示词或恢复状态系统。

扩展既有 `continuation_rechecks_scope_and_requires_explicit_session_replacement` owner：
实际调用接受与成功结算路径，验证“失败 → 普通执行成功 → 继续”；同时保留接受不等于完成、
不同绑定不能清除失败、新失败仍要求确认的负向断言。修复前目标断言失败，修复后 delivery queue 24 项通过。
未新增独立 Rust 测试 owner。

真实专项入口为 `node scripts/accept-run-continuation.mjs`，前置为 `cargo build -p rovai-core --bins`。
脚本使用生产 Core / Codex CLI 和独立 data-dir、Skill Library、MCP 配置与工作区，不启动日常 App。
恢复失败通过临时移开本次 fixture 自己创建的 Native Session 文件触发；核对 session ID 和工作区归属，
停止本次 Core 后操作，结束时恢复文件。没有 Mock 响应或预制模型输出。

执行环境为 macOS、Codex CLI `0.159.2`，配置 `runtime_default`，实际观察到 `gpt-6.1-sol`。
最终运行于本地 2026-10-08，fixture 名为 `rovai-continuation-real-65ecpJ`，
Thread 为 `rvcamp_01m4bk35n4f4rac0hr9pree7kp`。报告同时保存源码 diff、脚本与实际 Core 二进制摘要。

| 真实路径 | 结果与证据 |
| --- | --- |
| 投递前停止 → 原会话续做 | 原 Run `ac8907e2` 保持 cancelled；新 Run `84bf694e` 成功，会话 ID 不变，读到新 Task |
| 实际恢复失败 | Run `f3059632` 明确 failed；无 Runtime Input Delivery、无空会话替换，下次请求要求确认 |
| 历史失败 → 普通消息成功 → 再续做 | 普通 Run `10b050af` 和续做 Run `fcb27c71` 成功，沿用同一 Native Session，无额外换会话确认 |
| 再次恢复失败 → 确认新会话 | Run `7f2be575` 再次失败并要求确认；确认后 `0254ed25` 成功，原 checkpoint 字节摘要不变；模型产物读到更新后的 Task 和职责，原 Run 状态不变 |
| 已接受输入后停止、native 终态未知 | Run `1e10c499` 清理完成仍要求明确新会话确认，不用进程清理冒充原生完成 |

首次 fixture `rovai-continuation-real-xiCNgn` 的原始失败报告保留：当时把“已接受但终态未知的停止”
误当作可直接恢复的前置条件，被既有确认门禁正确拒绝。随后区分投递前停止与已接受停止两个路径，
没有为了让测试通过而放宽准入。上述同会话停止用例只证明投递前停止；未证明已接受输入且 Adapter
已确认 interrupted 终态之后的同会话恢复。其他 Adapter / 平台和通用 12 Case Judge Gate 仍未验证。

中间 fixture `rovai-continuation-real-k7mKCZ` 的五项检查也通过；最终运行进一步连接
“成功之后再失败 → 确认新会话”，验证较早的成功不会覆盖新失败。三份原始私有报告均保存在
各自 fixture 的 `report.json`，由入口输出的绝对路径定位，保留 Run、会话与检查结果。
本次提示词前后相同，沿用已确认 r2，仅修正会话准入判断。

修正后复验：`pnpm test:rust:pr` 为 453 项通过、1 项既有忽略；`pnpm docs:test`、
`DOCS_BASE_REF=b20b1f69 pnpm docs:check:ci`、`cargo fmt --all -- --check`、
`node --check scripts/accept-run-continuation.mjs` 与 `git diff --check` 均通过。

## 原业务消息 Task 关联修正

User 对 `0dd10916` 的复核确认，batch Run 的 `task_id` 为 NULL，旧续做检查没有读到原输入的
明确 Task 关联。改为从全部 `AgentRunInput.message_id` 查询同 Thread 公开发送事件的 `taskId`，
逐项检查 Task 是否仍存在、未完成或取消且负责人未变化。提交和领取共用 `eligible_source()`；
任何一项失效都拒绝整个续做范围，已入队请求取消后仍可领取下一条普通输入。

User 发送在既有事务事件中补存 `execution.taskId`，Agent Send 保留现有写入。
新增 [Camp Message Send v25](../../contracts/camp-message-send-v25.md) 记录该内部事件字段与关联读取边界；
没有新增请求参数、Schema、提示词、队列或恢复状态系统。历史事件不回填，未记录关联的旧 User
输入仍无法按 Task 校验，不从正文或当前 Tasks 推断。

测试继续由 `continuation_rechecks_scope_and_requires_explicit_session_replacement` 拥有，
移除手工补写 `run.task_id` 的片段，替换为 16 个表驱动场景：User / Agent 正式发送持久化路径 ×
取消 / 完成 / 改派 / 清空负责人 × 提交前变化 / 入队后变化。每个 batch 都包含两个 Task 输入和一个
普通输入，失效关联位于非末尾消息；通过正式 Stop 与 Task update 命令推进状态，验证来源 Run 终态不变。
Agent 入队后变化场景先生成并停止一次续做 Run，再从它继续，检查关联仍来自原业务消息。
这条跨发送、持久化、调度和取消事务的路径由既有 SQLite fixture 承担；不新增独立 Rust owner。

修复前新场景实际失败：Task 取消后仍返回 `agent_run.continuation_requested`；修复后
`cargo test -p rovai-core --lib --features extended-tests delivery_queue:: -- --test-threads=2`
的 24 项通过。此回归未调用真实模型；此前真实 Runtime 专项的范围和限制保持原记录。

默认 `pnpm test:rust:pr` 为 453 项通过、1 项既有忽略。另用 `--features slow-tests` 运行既有
`collaboration::slow_tests::queued_run_remains_dispatchable_after_task_changes`，1 项通过，确认普通
已准入执行仍遵守原有 Task 变化规则。`pnpm docs:test`、diff-aware 文档治理、Rust 格式及 diff 检查通过。

## 2026-10-08 会话自动选择与投递前降级

User 报告 TRAE 执行的新会话确认弹窗，并要求默认降级、可用性优先。
只读诊断日常数据库发现：相关 Run 于本地 14:36:23 被停止，
输入为 `delivery_unknown`、无原生终态；14:36:25 的续做命令被 `new_session_confirmation_required` 拒绝。
此次未尝试原生恢复，没有该 Thread 的 `continuation_session_unavailable` 事件；“无法恢复”文案把
“无法确认旧 native turn 已结束”错误表述为实际恢复失败。未更改日常数据库或操作其 Runtime。

现有续做还比普通 Runtime 更严格：generation/key 信息不足时提前换会话，而普通路径允许 Controlled
恢复；专属 guard 拦截 ACP/Pi 已有降级。当前 [Continuation v2](../../contracts/agent-run-continuation-v2.md)
移除这两处差异。点击直接受理，领取时未知 native turn 自动轮换，兼容性由原 Runtime 判断；
Codex 新授权在输入投递前允许一次新 Thread，ACP/Pi 复用既有路径。没有新增 Schema、状态系统或提示词。
旧未知结果在同一绑定之后已有可信成功完成时不再强制轮换；旧事实保持不变。

提示词前后相同：原业务输入集合、当前动态上下文和既有新会话 bootstrap；不增加“继续”、来源 ID、
证据或产物摘要。旧执行清理、权限/Task 准入和本次已投递输入不可重放的边界保留。

### 测试 owner 与隔离

沿用 `user_continuation_preserves_source_and_claims_independent_fifo_batches`；将原显式会话确认 owner
改为 `continuation_rechecks_scope_and_selects_safe_session_at_claim`，覆盖兼容性变化不拒绝、
Controlled 恢复不被预检查剥夺、未知输入自动轮换、后续完成消除旧未知、其他绑定/较早成功不足、
投递后不能降级重发，以及领取前业务范围变化。显式确认/恢复失败必须拒绝的断言随 v1 规则退出，
没有删除或新增 Rust 独立测试函数。新会话按钮对话框断言由直接提交、无对话框和请求幂等断言替代。

工作分支 `rovai/continuation-session-fallback`，基线 `a77b537d59d7cc8c01d520d9fd1d0174a194e1e7`；
独立 worktree `../rovai-ai-continuation-session-fallback`。真实 Runtime 使用既有
`node scripts/accept-run-continuation.mjs` 自动验收通道、临时 data-dir/Skill Library/MCP/工作区。
该入口更新为验证投递前 Stop 沿用原会话、真实恢复失败自动降级并单次投递、当前上下文/文件保留、
普通消息及同源再次继续复用当前会话、接受后 Stop 自动选择新会话；不接触用户 Thread。

### 本次验证

| 命令／范围 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | Vitest 238 文件／2604 项通过；Node 334 项通过、2 项平台跳过 |
| `cargo test --workspace` | 455 项通过、1 项既有忽略 |
| `cargo test -p rovai-core --features extended-tests --lib delivery_queue:: -- --test-threads=2` | 24 项通过 |
| `pnpm test:run-continuation-ui` | 隔离 Chrome 生产组件通过尺寸、键盘、连点、同请求核对、重复提交和无弹窗断言 |
| `cargo build -p rovai-core --bins` | 通过；以下真实专项使用该 worktree 二进制 |
| `node scripts/accept-run-continuation.mjs` | 真实 Codex 的四项专项通过；原生恢复失败后一次投递，旧 Run 完整基准和文件摘要不变 |
| `pnpm docs:test`、`pnpm docs:check`、diff-aware docs gate、格式／diff 检查 | 通过 |

最终真实专项为 macOS、Codex CLI 0.159.2，隔离 fixture `rovai-continuation-real-hrQduM`；
其 `report.json` 记录 Core 二进制、脚本、源码 diff 摘要，以及各次 Run/Session 关联和验证结果。
TRAE 本轮只有用户报告的只读诊断，其他 Adapter/平台没有真实续做验收；不将共享代码或 Mock UI 通过
等同于所有 Runtime 已验证。通用 12 Case Judge 未执行，本次提示词不变。

首次 fixture `rovai-continuation-real-a8FgEA` 保留失败报告：四条执行路径均成功，但最终旧 Run 全字段比较
碰到 Stop 后的异步 `ending_git_observation_recorded` 将 version 从 4 更新为 5。事件确认该写入属于
Stop Git observer；测试改为等待该独立收尾完成后取基准，再完整复跑通过，没有忽略 version 差异或修改
生产状态约束。历史 v1 专项的确认/失败行为仅证明当时合同，不能当作 v2 通过证据。
