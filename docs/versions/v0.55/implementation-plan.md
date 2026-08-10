---
document_type: implementation-plan
version: v0.55
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-10
---

# v0.55 实施与验收计划

> 完成结论：Agent 级过程 read model、底部执行台、连续 Drawer、三 Tab Inspector 与消息/Task
> 收口均已落地；打包 App 在标准、紧凑和 reduced-motion 场景通过真实 Desktop 验收。

## Checkpoint 0：设计真源与 clean break

- [x] 建立 v0.55 唯一 current 入口并冻结 v0.54 历史快照；
- [x] ADR-0154 完整替代 ADR-0133，冻结 Agent 级连续执行过程的长期边界；
- [x] 建立 Run Process Detail Surface v2，并把 v1 标记为 historical 入口；
- [x] 更新 Arctic Dawn、UI 索引和桌面验收口径。

## Checkpoint 1：Renderer read model 与过程入口

- [x] 从当前 Camp Snapshot 仅按 `agentId` 生成 Agent 过程；每位有 AgentRun 的队员只有一个入口；
- [x] 入口按 CampMember 顺序显示，并以本地化状态呈现该过程的优先 Run；不显示旧 Run 总数或
  逐 Run chip；
- [x] 打开、关闭和 Camp 切换只维护 Renderer 局部选择；关闭或 Escape 后将焦点返回原触发入口；
- [x] Task Related execution、停止结果等既有详情入口按 Agent 路由，不保留 Run 级选择 state；Header
  删除执行入口。

## Checkpoint 2：连续详情与 Inspector 收敛

- [x] Drawer 以时间升序保留同一 Agent 的每个 AgentRun stage；每项呈现其 Run/CampTurn、调用来源、
  A2A 深度、收件人、状态和独立证据 disclosure；
- [x] 打开时选择最新 running、否则最新非终态、否则最新终态 Run，并滚动至该 stage；
- [x] 删除 Inspector Audit tab 和残留 route/state/fixture；仅保留任务、上下文投递、审批；
- [x] 保持 Drawer 非模态、无 backdrop/focus trap；不增加 Agent/Run stop、cancel、retry 或自动打开。

## Checkpoint 3：验证与完成门槛

- [x] 以 Renderer 单元测试和打包 App 验收覆盖分组、稳定排序、优先 Run、终态保持展开、历史重开、
  Escape 焦点返回与 Agent 路由；
- [x] 更新 `pnpm accept:runtime-activity-ui` fixture，证明同一 Agent 多个 Run 只产生一个入口而 Drawer
  保留所有 stage、证据与诚实 Runtime activity；
- [x] 在 `1440×920`、`1040×700` 与 reduced motion 验证 Drawer、Composer 与唯一 CampTurn Stop
  不遮挡、无横向溢出且键盘可达；200% zoom 沿用未改动的 Arctic Dawn 通用合同；
- [x] 运行 TypeScript/Renderer、文档治理、diff、Desktop build/package 与相关 UI 验收门禁。

## 完成条件

- [x] 当前 Agent 级过程合同、Renderer、测试和打包 App 行为一致；
- [x] 不存在逐 Run process chooser、Inspector Audit/Activity route、AgentRun stop/cancel 或自动 Drawer
  打开等旧 surface；
- [x] 既有用户工作区改动保持不变；实现位于独立 `codex/agent-execution-process-ui` worktree；
- [x] 验证证据已回填，本计划与版本 `implementation_status` 同步为 complete。

## 验证证据

- `pnpm typecheck`；
- `pnpm test`：39 个 Vitest 文件 / 241 个测试与 115 个 Node qualification 测试通过；
- `pnpm build:desktop`、`pnpm package:mac`；
- `pnpm accept:runtime-activity-ui`：9 个 Agent / 10 个 AgentRun 聚合为 9 个唯一入口，同 Agent
  双 Run 连续展示，running Run 聚焦且证据展开，终态历史可重开，无顶部 Run 入口、无 Audit Tab，
  `1440×920` 与 `1040×700` 无横向溢出；验收默认启用 reduced motion；
- `pnpm accept:structured-mentions-ui`：用户消息保持左侧，右侧 hover copy 可见且完整复制，结构化 Mention
  与原生选择未回退；
- `pnpm docs:test`、`pnpm docs:check`、`pnpm docs:adr:generate -- --check`、`git diff --check`。
