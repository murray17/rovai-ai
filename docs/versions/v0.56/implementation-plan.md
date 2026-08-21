---
document_type: implementation-plan
version: v0.56
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-11
---

# v0.56 实施与验收计划

> 当前结论：设计真源、生产功能边界、Renderer 实现、自动化门禁、macOS arm64 本地包和
> 多尺寸真实 UI 验收均已完成。

## Checkpoint 0：版本与设计真源

- [x] 建立 v0.56 唯一 current 入口并冻结 v0.55 历史快照；
- [x] 将当前 UI 方向从旧 Arctic Dawn 色彩层切换为 Neutral Porcelain + Steel，同时保留原文件
  路径承接历史链接；
- [x] 明确 P2 HTML 只是一次性视觉选型输入，生产实现继续使用现有 React、Radix、CSS Variables、
  Core Read Side 与产品功能；
- [x] 确认 ADR、Contract、Architecture、Runtime Activity 与 Runtime compatibility 均无需语义变更。

## Checkpoint 1：全局视觉与页面覆盖

- [x] 迁移 Canvas、Surface、Steel、结构线、Focus、Rail 与 Evidence Token；保持状态色和八个队员
  身份色独立；
- [x] 七个设置分类统一使用 Porcelain 页面底、Steel 顶边、标题左轨/下划线和选中态，不增加设置
  项或改变保存/恢复行为；
- [x] 队员页与记忆页统一 Steel 层级，保留半身 portrait、Runtime 状态入口、Memory Workbench、
  Proposal Drawer 与全部原写操作；
- [x] 通用 Dialog、New Conversation、Notification Drawer 与 Memory Proposal Drawer 使用同一
  Steel 表面语言，attention/danger 风险提示继续使用语义色；
- [x] 创建新对话保留目录、安全、Git、队员、Lead、可选名称和原子创建，不增加“创建摘要”或
  黄色静态提示。

## Checkpoint 2：导航与会话细节

- [x] Project 保留文件夹、项目级操作、置顶和分页；主行无独立展开图标，当前项目使用稳定
  `--surface-selected` 底色；
- [x] 会话继续使用真实时间/Camp 日数，不读取或补造“今天 · 发布准备”等阶段字段；
- [x] 所有 Agent 消息使用同一开放阅读表面，身份色只用于头像、名称和小型身份点；
- [x] A2A footer 收敛为“发送给@队员”，蓝色 `@队员` 在身份仍可用时复用现有锚定人物信息卡；
- [x] 2K 窗口 Composer 扩展到 1040px，`Enter` 提示与发送按钮形成紧凑同组；
- [x] v0.55 Agent 聚合执行过程、Task compact 卡、Approval Dock、Composer Stop、Inspector 与
  消息复制入口保持原功能边界。

## Checkpoint 3：验证与完成门槛

- [x] 运行 TypeScript、Renderer 与相关 Node 测试，并确认新 Token、A2A Mention、Composer 几何和
  既有功能断言全部通过；
- [x] 运行通用文档门禁和 `git diff --check`；
- [x] 生成 macOS arm64 本地包并验证主 App、Core、CLI、原生模块架构、签名与可启动性；
- [x] 在隔离 `userData` 中完成 `2560×1440`、`1440×920`、`1040×700`、200% zoom 与
  reduced-motion 验收；
- [x] 覆盖普通导航、New Conversation、完整会话、七个设置分类、队员半身照与可点击 Runtime
  角标、记忆 Workbench、通知/提案 Drawer、确认/错误/风险 Dialog；
- [x] 保留迁移前与迁移后两个可独立启动的本地 App，并记录可复核的 `app.asar` SHA-256。

## 完成条件

- [x] 生产 Renderer 与本版本、UI 详规及真实 App 截图一致；
- [x] P2 视觉已覆盖用户要求的页面和浮层，没有丢失生产功能或引入原型假字段；
- [x] 旧 Arctic Dawn 色彩层、角色专属消息底色、A2A 冒号文案、窄 2K Composer 与当前项目无底色
  等旧断言已经删除或更新；
- [x] 所有自动化与打包 App 验收通过，版本 `implementation_status` 与本计划状态同步为 complete。

## 实际验证结果

```bash
pnpm typecheck
pnpm test
pnpm package:mac
pnpm accept:sidebar-ui
pnpm accept:runtime-activity-ui
pnpm accept:structured-mentions-ui
pnpm accept:memory-ui
pnpm accept:member-avatar-ui
pnpm accept:member-lifecycle-ui
pnpm accept:notification-ui
pnpm accept:diagnostics-ui
pnpm accept:task-card-ui
node scripts/accept-new-conversation-ui.mjs
node scripts/capture-skills.mjs <app> <output>
node scripts/capture-mcp.mjs <app> <output-prefix>
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm test:rust:full
pnpm docs:test
pnpm docs:check
pnpm docs:adr:generate -- --check
DOCS_BASE_REF=origin/main pnpm docs:check:ci
git diff --check
```

2026-08-11 在基于 `origin/main` 的工作树完成：`pnpm typecheck` 通过；`pnpm test` 包含
39 个 Vitest 文件、248 条 Renderer 测试、147 条 Qualification/Benchmark Node 测试和
21 条文档测试，全部通过。Rust format、Clippy（零告警）与 workspace 测试通过，合计
374 passed、0 failed、3 个既有手工 Runtime smoke ignored。

`pnpm package:mac` 生成 arm64 `Rovai-ai.app`；主 App、Core、CLI 与
`open-panel-prewarm.node` 均通过 `codesign --verify --deep --strict` 或对应单体严格校验，
且 `file` 均报告 arm64。打包 App 的 `app.asar` SHA-256 为
`4595f94bfa125d171849f6d6d452cc7b1027c893a1bbb15bb13501ab0da99657`。

全部 packaged-app 验收通过，证据根目录为
`<local-output>/Rovai-ai-comparison-2026-08-11/acceptance/`：其中 `final/`
覆盖 Sidebar、Runtime Activity、Structured Mentions、Memory、Member Avatar、Member Lifecycle、
Notification、Diagnostics、Task Card 与 New Conversation；`final-settings/` 补充通用、外观、
Skill、MCP 与 Agent 运行时 clean 截图，并分别保留 Skill/MCP 浮层打开状态。七个设置分类由
这两组证据共同覆盖。Runtime Activity 在 2560×1440 验证 1040px
Composer，在 1040×700 验证无横向溢出；Task 与 New Conversation 另通过 200% zoom 与
reduced-motion。

可独立启动的对比包保存在
`<local-output>/Rovai-ai-comparison-2026-08-11/`：迁移前包
`Rovai-ai-old-pre-P2-8479cd810715.app` 的 `app.asar` SHA-256 为
`8479cd81071553bcfaf60679c96dcb19965bcabedc4da8ddb1196fb134f4a1e1`；最终包为
`Rovai-ai-final-P2-e5087fb-4595f94bfa12.app`，哈希如上。两者均通过严格签名校验。
