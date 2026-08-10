---
document_type: implementation-plan
version: v0.56
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-11
---

# v0.56 实施与验收计划

> 当前结论：设计真源和生产功能边界已经收敛，Renderer 视觉实现已完成主体迁移；完成状态必须
> 等待 TypeScript、Renderer、文档、打包 App 和多尺寸真实 UI 验收全部通过后回填。

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

- [ ] 运行 TypeScript、Renderer 与相关 Node 测试，并确认新 Token、A2A Mention、Composer 几何和
  既有功能断言全部通过；
- [ ] 运行通用文档门禁和 `git diff --check`；
- [ ] 生成 macOS arm64 本地包并验证主 App、Core、CLI、原生模块架构、签名与可启动性；
- [ ] 在隔离 `userData` 中完成 `2560×1440`、`1440×920`、`1040×700`、200% zoom 与
  reduced-motion 验收；
- [ ] 覆盖普通导航、New Conversation、完整会话、七个设置分类、队员半身照与可点击 Runtime
  角标、记忆 Workbench、通知/提案 Drawer、确认/错误/风险 Dialog；
- [ ] 保留迁移前与迁移后两个可独立启动的本地 App，并记录可复核的 `app.asar` SHA-256。

## 完成条件

- [ ] 生产 Renderer 与本版本、UI 详规及真实 App 截图一致；
- [ ] P2 视觉已覆盖用户要求的页面和浮层，没有丢失生产功能或引入原型假字段；
- [ ] 旧 Arctic Dawn 色彩层、角色专属消息底色、A2A 冒号文案、窄 2K Composer 与当前项目无底色
  等旧断言已经删除或更新；
- [ ] 所有自动化与打包 App 验收通过，版本 `implementation_status` 与本计划状态同步为 complete。

## 计划验证命令

```bash
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm package:mac
pnpm accept:sidebar-ui
pnpm accept:runtime-activity-ui
pnpm accept:structured-mentions-ui
pnpm accept:memory-ui
pnpm accept:member-avatar-ui
pnpm accept:member-lifecycle-ui
pnpm accept:notification-ui
pnpm accept:diagnostics-ui
node scripts/accept-new-conversation-ui.mjs
pnpm docs:test
pnpm docs:check
pnpm docs:adr:generate -- --check
git diff --check
```

完成后在本节替换计划命令为实际通过的命令、测试数量、截图/fixture 位置与新旧包 SHA-256；
不得在执行前把计划写成验收事实。
