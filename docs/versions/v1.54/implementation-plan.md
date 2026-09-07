---
document_type: implementation-plan
version: v1.54
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-07
---

# v1.54 实施与验收

## 实施范围

- [x] 建立 Automation、AutomationRun、NotificationDelivery schema 96 / migration 145，以及执行快照、终态、
  occurrence、活跃门禁和 CampTurn 关联的数据库约束。
- [x] 实现定义 CRUD、版本冲突、名称派生、设备时区计划、UTC occurrence、错过/冲突规则和一次性消费。
- [x] 在一个事务中领取触发并创建普通 Camp、首条公共用户消息、CampTurn、root AgentRun 和双向运行关联。
- [x] 实现交互等待、超时、执行失败、无结果、重启中断和迟到事件的权威结算。
- [x] 实现 Automation 专用 CampTurn 取消入口，只接受 `interaction_required | timeout | interrupted`。
- [x] 实现 root 公共结果冻结，以及飞书/钉钉 Owner 私聊的独立三次投递。
- [x] 增加七项 Built-in CLI 操作并升级 Transport v23、catalog、projection、帮助和 smoke fixtures。
- [x] 增加 Desktop Automation 一级工作区、模板、自动保存、状态、通知选择和打开结果会话。
- [x] 收紧恢复边界、统一五段 Cron 求值，保证非计划编辑不重算、关闭定义可显式运行、全部活跃运行公平结算。
- [x] 全局页面切换在离开 Automation 工作区前等待尚未保存的草稿提交，保存失败保留当前页面。
- [x] 按 v30 修复默认总览、模板入口、筛选搜索、可调分栏和紧凑详情；增加只读运行历史分页与可见历史刷新。
- [x] 完成 Rust、TypeScript、Renderer/build、文档治理和 CLI contract 验收；真实 App 双主题视觉保留明确的环境阻断证据。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Automation 领域与 schema 定向回归 | `passed` | 名称、幂等原子派发、快照冻结、重启收口、missed/overlap/once 与 schema 对象测试通过 |
| Rust / Built-in / CLI | `passed` | `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、workspace all-target check、Core library 535 项、CLI 33 项和 Core binary 232 项通过；5 项手工 Runtime smoke ignored，1 项嵌套 macOS sandbox 用例因当前环境限制显式跳过 |
| TypeScript / Renderer / Desktop build | `passed` | `pnpm typecheck`、160 files / 1633 项 Vitest、222 项 Node 测试（1 项 Windows 平台跳过）与 `pnpm build:desktop` 通过 |
| Automation UI 原实现审查 | `superseded` | 原先只有源码审查，没有与 v30 实际画面对照；固定 260px 分栏、默认打开详情与模板入口不符合原型，不能作为视觉还原通过的证据 |
| v30 Renderer 交互与视觉修复 | `passed` | [隔离 Renderer 场景与截图](../../../scripts/fixtures/automation-workspace/README.md)：总览/空列表、筛选搜索、创建、历史分页、保存失败与冲突恢复；Day/Night、1040×700、720×460 等效布局与分隔条键盘操作 |
| 双主题真实 App 视觉与键盘 | `environment-blocked` | 隔离 `pnpm dev` 完成 Core、CLI 和 Renderer 构建后，当前嵌套 macOS 环境以 `sandbox_apply: Operation not permitted` 阻止 Electron/Chromium sandbox 初始化；未声称原生视觉通过 |
| 文档治理与 diff hygiene | `passed` | `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、`git diff --check` 与完整 `pnpm test` 通过 |

## v30 还原修复的补充验收

本轮基线为 `fd0b80284dccd5c0cd04997f8ddb4397542a0220`，对照用户提供的
`rovai-scheduled-tasks-prototype-v30.html` 修复入口与详情层级。上表原实现的完整测试记录不代表本轮重新执行全量测试；
本轮执行的是以下与改动对应的检查：

- `cargo test -p rovai-core --lib --bins automation::tests::`：8 项通过；在既有派发/恢复测试中补充历史跨页、无重复、
  failed/skipped Camp 链接及无效输入断言，没有新增 Rust 测试夹具。
- `cargo fmt --check`、`cargo clippy -p rovai-core --all-targets -- -D warnings`。
- `pnpm typecheck`、`pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts`：166 项通过，
  `pnpm build:desktop` 与隔离 Renderer 场景的单独 TypeScript 检查。
- 文档治理三项门禁与 diff hygiene；真实输入、截图和证据边界记录在隔离场景 README。
- 后续用户校准：列表初始及恢复默认宽度改为最小 208px，筛选/新建移至顶部；更新双主题截图。
  补上运行时列表宽度的 CSS 默认声明，修复 PR 首轮 CI 的未声明变量失败，32 项主题回归通过。

## 完成条件

### 通知交互与单聊补充

- 当前阅读区域细分为公屏与精确单聊；当前来源完成静默，其他分类依据精确内容可见性决定，抑制不代替确认。
- 卡片只保留来源与最多两行信息；一次一张，同来源更新保留焦点，余下提醒由用户主动查看，后台 / 悬停 /
  焦点暂停剩余时间。保留既有视觉主题与四类偏好。
- 单聊审批和终态向本机 Owner 提醒，按冻结 Conversation / Run 定位；已结束来源失败且撤下临时队列。
  公共审批列表与计数排除私有来源。Migration 146 只改变未来来源触发，不改 schema 96 存储形状与历史事实。
- 合同入口为 [Notification Episode v6](../../contracts/notification-episode-v6.md)、
  [Current User Attention v5](../../contracts/current-user-attention-v5.md)、
  [Single Chat v3](../../contracts/single-chat-v3.md)、[Camp Open Projection v17](../../contracts/camp-open-projection-v17.md)。

本轮基线为 `60bfadaaf7285563c9618bb9b6a8e55537579676`，验证范围与此前 Automation 记录独立：

- `pnpm test`：160 files / 1635 项 Vitest、222 项 Node 通过，1 项 Windows 平台跳过；包含文档和 Skill 门禁。
  最终定向 `App / SingleChatPanel / NotificationAttentionController` 197 项与 TypeScript 检查通过。
- `cargo test --workspace`：Library 536、CLI 33、Core 232 项通过，5 项人工 Smoke ignored；
  通知 slow-tests 11 项、单聊 8 项、v93 Context 升级、数据库 66 项及 authority migration 6 项定向通过。
- 隔离生产组件 Electron 通知与单聊回归通过；验收涵盖原来源定位、失效不创建后继对话、通知抑制、显式
  队列与焦点 / 悬停剩余计时。日夜主题卡片经截图检查。未运行已打包 App 的 `accept:notification-ui` 或真实模型。
- Rust 未新增 / 删除独立测试函数；扩展既有单聊私有边界 owner，覆盖本机通知来源、公共审批列表 / 计数
  排除、原单聊结束 invalidation 与 successor 隔离。只有数据库 seam 能证明这些 SQL 关系，纯映射测试不足；
  最小命令为 `cargo test -p rovai-core --lib single_chat::tests::successful_final_is_private_and_a_cancelled_run_cannot_append_late_output`。
- 升级夹具统一先退回 v145 触发器再重建历史表，保留所有历史升级 case；Automation 历史分页的既有测试
  改为按 `(created_at, id)` 合同验证完整跨页结果，去掉“连续创建必定跨秒”的不稳定假设，保留所有状态和分页断言。
- 同步 `0771e3fc1612988892b57c79049ce60e85fe7380` 主线后的最终复核：`pnpm test` 160 files / 1643 项
  Vitest、222 项 Node 通过（1 项 Windows 平台跳过），`pnpm typecheck`、`pnpm build:desktop`、
  `pnpm test:rust:staged`（workspace all-target check 与 536 项 Library）、Rust 格式和差异检查通过。
  通知及单聊 Electron 回归重新通过，另覆盖长成员名不溢出、同来源更新保留真实 DOM 与键盘焦点；
  以该不可变 SHA 为 base 的文档 CI 门禁通过。

### 原版本完成条件

- 同一 occurrence 和同一 Built-in command 重放都不会创建第二个 AutomationRun、Camp 或 CampTurn。
- 定义编辑只影响尚未领取的 occurrence；已领取快照和已冻结结果消息保持不可变。
- 重启、等待交互和超时均先让精确关联 CampTurn 进入权威终态，再释放 Automation 并发门禁；不重新派发 Prompt。
- 运行失败与通知失败可独立观察，通知重试不会创建新的运行。
- Desktop 在最小窗口、Day/Night、键盘操作和保存/失败状态下仍提供完整管理路径。
- 自动化门禁全部通过；真实飞书/钉钉凭据与真实模型执行 smoke 未运行，当前证据来自契约、领域回归和构建测试。
