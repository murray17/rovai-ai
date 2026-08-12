---
document_type: implementation-plan
version: v0.63
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-12
---

# v0.63 实施与验收计划

## Checkpoint 0：交互与规范

- [x] 比较三种分配结构并确认 Variant B“队员分配工作台”；
- [x] 冻结真实头像、长名册有界滚动、MCP 搜索筛选、稳定身份色与 Skill 家族开放列表；
- [x] 冻结单一分配写入口、普通 UI 无风险分类、JSON 真源与已有 Runtime Projection 边界；
- [x] 完成 v0.62 → v0.63 生命周期切换并更新跨版本 UI 真源。

## Checkpoint 1：Renderer 工作台

- [x] 用受控头像与可键盘选择的主从 roster 替换队员 tofu 与原生 `details` picker；
- [x] 名册在桌面高度内独立滚动，窄宽切为有界横向队员带；
- [x] chooser 覆盖名称、Endpoint、Transport、来源搜索和全部、已分配、未分配筛选；
- [x] checkbox 继续即时保存；风险分类不显示标签、筛选或额外确认，批量选择与清空覆盖全部筛选结果；
- [x] 批量 mutation 使用前一次响应的新 `configDigest`，冲突时重新读取并停止后续写入。

## Checkpoint 2：MCP Library

- [x] 用开放列表替换 Server tofu 卡片墙，mark 由稳定 `serverId` 映射到身份色 Token；
- [x] 行内保留名称、Transport、Endpoint、来源、真实队员头像摘要与启停，不投影风险标签；
- [x] 详情箭头、展开事实、编辑 JSON 与删除形成一个明确的渐进披露入口；
- [x] Library 队员摘要保持只读，不新增第二套 assignment picker。

## Checkpoint 3：自动化与成品验收

- [x] 单测覆盖 12 位队员、真实头像、搜索筛选、稳定 mark、开放行与统一批量 mutation；
- [x] 打包 App 覆盖导入、新增、分配、启停、权限修复、详情、删除与真实 Core 收敛；
- [x] 1440×920 验证长名册纵向滚动，1040×700 验证 chooser 单列，200% zoom 验证横向队员带；
- [x] 键盘验证 roster Arrow/Home/End、搜索、筛选、checkbox、Switch、详情与 Dialog；
- [x] 完成 workbench / Library clean 截图与 UI result critique，确认新成品优于旧队员下拉和 MCP 卡片墙。

## Checkpoint 4：完整门禁与收口

- [x] `pnpm typecheck`、相关 Vitest、完整 `pnpm test`、文档门禁与 `git diff --check` 通过；
- [x] `pnpm build:desktop` 与 packaged MCP acceptance 通过；
- [x] 全部证据齐全后把本计划和版本概览标记为 `complete`。

## 当前证据

- `CI=true pnpm typecheck` 通过；`CI=true pnpm test` 通过 44 个 Vitest 文件 / 293 项、154 项
  Node 测试与 21 项文档治理测试；
- `pnpm build:desktop` 通过；隔离 worktree 生成 arm64 打包 App，`codesign --verify --deep --strict`
  通过，App、Core、CLI 与原生预热器均为 arm64，`app.asar` SHA-256 为
  `18fdbe3226edf27a1629e141fe4fe60977d75d19648b838846a6a3a62d07e5c7`；
- `scripts/capture-mcp.mjs` 使用临时 HOME 与 Electron `userData` 对打包 App 验收通过：12 位队员
  名册在 1440×920、1040×700 内纵向滚动，520×700 下变为横向队员带，三档均无整页横向溢出；
- 同一验收覆盖真实 roster Home/End、标题栏搜索、筛选、覆盖全部结果的批量选择/清空、原高风险
  fixture 的普通路径分配、单项分配、导入、新增、启停、0600 权限修复、详情与删除；来源明文
  secret 未进入 Renderer，页面无风险标签、筛选、额外确认、分配状态文字或生效提示；
- 视觉复核 `rovai-mcp-v063-final-day-clean.png` 与 `rovai-mcp-v063-final-library-clean.png`：名册标题
  与列表之间无横线，普通队员行保持白底，只有当前行使用 Steel soft wash 与 2px 短轨；搜索固定在
  chooser 标题右侧。Library 使用稳定多色 mark 和开放行，详情箭头与文字对齐，未恢复卡片墙、常态
  阴影或第二套 assignment picker。
