---
document_type: implementation-plan
version: v0.61
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-12
---

# v0.61 实施与验收计划

## Checkpoint 0：交互与规范

- [x] 确认只有具体 Camp 形成精确返回目标，directory Project 与快速对话 Camp 同等处理；
- [x] 确认 Memory、Quick Chat 首页和启动直达队员页统一返回 App；
- [x] 冻结瞬时 Renderer 状态、权威 Camp 重开、失效回退与脏 Runtime 草稿保护边界；
- [x] 完成 v0.60 → v0.61 生命周期切换并更新跨版本 UI 真源。

## Checkpoint 1：Renderer 导航

- [x] 增加可单测的 `MemberReturnTarget` 两态模型，只在从可见 Camp 进入成员页时捕获目标；
- [x] 所有进入成员页的生产入口统一捕获来源，包括 Camp Runtime 配置入口；
- [x] 返回会话复用 `activateCamp` 读取最新 Snapshot；删除或读取失败安全回到 App；
- [x] 返回 App 清除活动 Camp 投影并提交既有 Quick Chat Restorable Location；
- [x] Settings 往返成员页时保留原返回目标，不新增历史栈或持久化副本。

## Checkpoint 2：成员名册 UI 与输入

- [x] 用 54px 开放式 Steel 上下文书签替换 icon-only“返回首页”，队员标题与操作栏保持独立；
- [x] conversation 两行显示上下文与 Camp 标题，app 单行显示“返回 App”，长文案单行截断；
- [x] `⌘[` 与点击共用同一返回动作，Dialog/Menu 打开时不穿透；
- [x] 保留 270px 侧栏、名册独立滚动、现有成员操作、半身照、Runtime 入口和全局 focus ring。

## Checkpoint 3：自动化与成品验收

- [x] 纯函数覆盖 directory Camp、Quick Chat Camp、非 Camp 来源与无稳定目标四类情况；
- [x] MemberSidebar SSR 覆盖 conversation/app 文案、可访问名称、Keycap、Runtime 行与 0/1/20/21/100 队员；
- [x] 快捷键单测覆盖修饰键、重复按键和临时浮层阻断；
- [x] 打包 App 验证从 Quick Chat Camp 与 directory Camp 精确返回、Memory 返回 App、目标失效回退；
- [x] 打包 App 验证点击与 `⌘[`、未保存 Runtime 草稿继续编辑/放弃、1440×920、1040×700、
  200% zoom、reduced motion、Forced Colors 和无横向溢出；
- [x] 留存 conversation/app 两态、超长标题省略截图和 JSON 验收结果。

## Checkpoint 4：完整门禁与收口

- [x] TypeScript、Vitest/Node、文档门禁、Desktop build 与 diff check 全部通过；
- [x] `pnpm package:mac`、arm64/签名检查与 `pnpm accept:member-lifecycle-ui` 通过；
- [x] 完成 UI result critique，确认真实成品比旧 icon-only 返回更清楚且未形成卡片墙；
- [x] 上述证据齐全后把本计划和版本概览标记为 `complete`。

## 验收证据

- `pnpm typecheck` 通过；`pnpm test` 通过 41 个 Vitest 文件 / 280 项、154 项 Node 测试与
  21 项文档治理测试；
- `pnpm docs:check` 通过 v0.61 / 61 个版本目录及 162 个 ADR，
  `pnpm docs:adr:generate -- --check` 通过；
- `pnpm build:desktop`、`pnpm package:mac` 通过，App、Core、CLI 与原生预热器均为 arm64，
  `codesign --verify --deep --strict` 及三个内置产物签名检查通过；
- `pnpm accept:member-lifecycle-ui` 使用隔离数据通过，报告
  `member-lifecycle-acceptance.json` 记录 App fallback、Quick Chat Camp、directory Camp、
  超长标题、省略、`⌘[`、Dialog 阻断、Settings 往返、失效目标回退、脏草稿与无横向溢出；
- 视觉复核确认返回区使用开放 Porcelain 表面、单一 Steel 结构轨与轻量箭头 tile；App 态单行、
  Camp 态两行，长标题稳定省略，未恢复卡片墙、空拖拽栏或第二套会话树。
