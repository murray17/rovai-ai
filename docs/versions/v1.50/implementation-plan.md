---
document_type: implementation-plan
version: v1.50
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-05
---

# v1.50 实施与验收

## 实施范围

- [x] 建立 Automation、AutomationRun、NotificationDelivery schema 91 / migration 140，以及执行快照、终态、
  occurrence、活跃门禁和 CampTurn 关联的数据库约束。
- [x] 实现定义 CRUD、版本冲突、名称派生、设备时区计划、UTC occurrence、错过/冲突规则和一次性消费。
- [x] 在一个事务中领取触发并创建普通 Camp、首条公共用户消息、CampTurn、root AgentRun 和双向运行关联。
- [x] 实现交互等待、超时、执行失败、无结果、重启中断和迟到事件的权威结算。
- [x] 实现 Automation 专用 CampTurn 取消入口，只接受 `interaction_required | timeout | interrupted`。
- [x] 实现 root 公共结果冻结，以及飞书/钉钉 Owner 私聊的独立三次投递。
- [x] 增加七项 Built-in CLI 操作并升级 Transport v22、catalog、projection、帮助和 smoke fixtures。
- [x] 增加 Desktop Automation 一级工作区、模板、自动保存、状态、通知选择和打开结果会话。
- [x] 完成 Rust、TypeScript、Renderer/build、文档治理和 CLI contract 验收；真实 App 双主题视觉保留明确的环境阻断证据。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Automation 领域与 schema 定向回归 | `passed` | 名称、幂等原子派发、快照冻结、重启收口、missed/overlap/once 与 schema 对象测试通过 |
| Rust / Built-in / CLI | `passed` | `cargo fmt --check`、`cargo clippy -D warnings`、workspace all-target check、Core library 500 项、CLI 32 项和 Core binary 219 项通过；5 项手工 Runtime smoke ignored |
| TypeScript / Renderer / Desktop build | `passed` | `pnpm typecheck`、151 files / 1526 项 Vitest 与 `pnpm build:desktop` 通过 |
| Automation UI finish review | `passed-with-limited-evidence` | 独立代码审查提出的模板、分页、保存恢复、结果入口、窄屏操作、字体、列表宽度和新建态问题已修复；受环境限制没有截图证据 |
| 双主题真实 App 视觉与键盘 | `environment-blocked` | 隔离 `pnpm dev` 完成 Core、CLI 和 Renderer 构建后，当前嵌套 macOS 环境以 `sandbox_apply: Operation not permitted` 阻止 Electron/Chromium sandbox 初始化；未声称原生视觉通过 |
| 文档治理与 diff hygiene | `passed` | `pnpm docs:test`、`pnpm docs:check`、基于 v1.50 起点的 diff-aware gate、`git diff --check` 与完整 `pnpm test` 通过 |

## 完成条件

- 同一 occurrence 和同一 Built-in command 重放都不会创建第二个 AutomationRun、Camp 或 CampTurn。
- 定义编辑只影响尚未领取的 occurrence；已领取快照和已冻结结果消息保持不可变。
- 重启、等待交互和超时均先让精确关联 CampTurn 进入权威终态，再释放 Automation 并发门禁；不重新派发 Prompt。
- 运行失败与通知失败可独立观察，通知重试不会创建新的运行。
- Desktop 在最小窗口、Day/Night、键盘操作和保存/失败状态下仍提供完整管理路径。
- 自动化门禁全部通过；真实飞书/钉钉凭据与真实模型执行 smoke 未运行，当前证据来自契约、领域回归和构建测试。
