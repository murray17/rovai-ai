---
document_type: implementation-plan
version: v0.24
lifecycle: current
authority: implementation-plan-and-acceptance
design_status: frozen
implementation_status: awaiting_user_confirmation
last_updated: 2026-07-30
---

# v0.24 实施与验收

> 当前阶段：设计已冻结，等待用户明确授权生产实现。Night 不属于本版本完成条件。

## 设计检查点

- [x] Arctic Dawn V3 成为唯一当前 Renderer 设计权威，领域与安全合同优先。
- [x] 同一版本覆盖 Quick Chat、Camp、成员、长期记忆、五个设置页和创建 Dialog。
- [x] 保留 `system | day | night` 偏好，v0.24 全部解析为 Arctic Dawn Day。
- [x] Project/Camp 置顶进入产品；Electron Main 原子保存应用级 Navigation 偏好。
- [x] 所有一级页面常驻 270px 统一侧栏，删除可变图标轨和独立对话列。
- [x] “快速对话 / Quick Chat”通用语言、内部标识与无兼容切换由 ADR-0074 冻结。
- [x] Quick Chat 不含 Composer；“新对话”先提交原子 New Conversation Draft。
- [x] Camp 主阅读流左对齐，删除点状竖轨、EXEC 菱形与阶段分区。
- [x] 终态过程折叠为 `处理过程 · {本地化耗时}`，最终回复保持独立可见。
- [x] 命令、文件操作及其失败都作为处理过程内 Tool Call；Task 保留边界事件。
- [x] Approval 不进入消息区；pending 队列使用 Composer 上方的非模态停靠式审批
  弹框，多项聚合为“N 项待审批”，每项保留 Runtime 原生合同。
- [x] Composer 使用 `Enter` 发送、`Shift+Enter` 换行；停止只占用发送位置。
- [x] Camp Inspector 固定五页签；310px/260px 两档，始终可见且不可拖拽。
- [x] Camp Header 右侧没有“停止”或 `•••`，只显示 Run/审批状态摘要。
- [x] 成员 v4 的 portrait + 圆形 icon、Memory、Skill、MCP、Runtime、Appearance、
  Diagnostics 和 Dialog 的信息架构、状态、适配与安全边界已经冻结。
- [x] 旧 Meridian 与独立长期记忆 UI 的有效规则迁入 Arctic Dawn。
- [x] 响应式、无障碍、迁移、清理和验收矩阵已经定义。
- [ ] 用户明确授权开始 Arctic Dawn 生产实现。

## 实施检查点

以下顺序只在上一节最后一项完成后执行。每个检查点必须保留可运行基线，不能把旧新
设计长期并置。

### 0. 基线与范围保护

- [ ] 记录现有 dirty worktree 所有者与重叠文件，保存当前测试/截图基线，不覆盖
  并发 A2A 或其他用户改动。
- [ ] 为 Arctic Dawn 增加纯状态/文案/几何测试入口，先让旧实现以预期失败暴露差距。
- [ ] 确认 `.openai/hosting.json` 不存在；本任务是桌面 Renderer，不创建或部署网站。

### 1. 合同、偏好与一次性切换

- [ ] 完成 ADR-0074 的 `QuickChat / quick_chat / quickChat / quick-chat` 全栈替换，
  安全删除精确旧 `<userData>/lobby/`，无别名、双读或迁移。
- [ ] 增加 Electron Main 的 `userData/navigation.json` 原子 Pin Store、Preload IPC、
  校验、失效清理和测试；Core SQLite 保持不变。
- [ ] 保留 ThemePreference 真源，但让所有偏好解析为 Day；删除 Meridian Night
  Token 使用路径和旧首绘回退。

### 2. Arctic Dawn 基础与 App Shell

- [ ] 建立 Day Token、证据 Token、成员身份色、Focus、排版、间距与 Reduced Motion。
- [ ] 重建固定 270px 统一侧栏、品牌、一级入口、Camp 快速跳转、置顶、Quick Chat、
  Project/Camp 列表、行操作和 Core 健康入口。
- [ ] 删除 rail resize/collapse/local preference 与分组折叠状态。
- [ ] 重建 Quick Chat 品牌落地与最近 5 个 Camp 恢复列表，确认无 Composer。

### 3. Camp 工作区

- [ ] 重建 50px Header、左对齐阅读流、横向日期分隔、用户/Agent/A2A 消息和复制。
- [ ] 以顺序叙述 + 紧凑 Tool Call 重建 Execution Evidence；实现终态过程折叠和
  独立最终回复。
- [ ] Task 保留消息区边界事件；删除 Approval 消息卡。
- [ ] 增加 Composer 上方固定的非模态 Approval Dock，覆盖单项、多成员聚合、
  Runtime 原生 option identity、逐项解决、Focus 和与 Inspector 同源。
- [ ] 重建 Enter/Shift+Enter/IME/@ 候选、Pending Intent、Send/Stop/Stopping 状态。
- [ ] 重建 310px/260px 五页签 Inspector 及 Activity/Audit 职责分离。
- [ ] 删除 Header Stop/`•••`，把 Pin/Rename/Delete 收敛到侧栏 Camp 行。

### 4. 一级管理页面

- [ ] 成员：64px Header、Presence 分组内直接调整 Member Order、272/250px 名册、
  `4:5` portrait + 50px 圆形 icon 身份区、Runtime、Memory Capability、高级摘要
  设置和保留式永久移除。
- [ ] 编辑身份：960px 有界双栏 Dialog、PNG/JPEG 受管源图、圆形 icon 拖拽/滚轮/
  滑杆/键盘取景、28/32/34/44px 预览、低分辨率与恢复状态，并继续使用 ADR-0056
  的单一 `avatarRef` 复合资产和 asset-first commit。
- [ ] 长期记忆：摘要、策略、Proposal Drawer、Scope/治理/搜索、310/390px 双栏、
  Revision/Lifecycle/CAS/Projection 与所有边界状态。

### 5. 设置与创建 Dialog

- [ ] 建立固定 188px 设置导航和统一 Hero/Block/List 组件。
- [ ] 技能：Library、风险摘要、启停/删除、导入更新、完整 Projection 状态。
- [ ] MCP：真源路径、malformed/权限状态、Import、typed Editor、成员分配与 redaction。
- [ ] 执行引擎：完整 Product Catalog、快速发现/深度探测状态、安装帮助与高级入口。
- [ ] 外观：跟随系统/日间/夜间三偏好；当前显示 Day，Night 标“视觉待设计”。
- [ ] 诊断：局部健康、路径/能力、集中 redaction 和 JSON 导出。
- [ ] 创建新对话：760px Dialog、固定 Header/Footer、四步骤、原子失败保留和 Focus
  Return；所有“大厅/Lobby”文案改为“快速对话/Quick Chat”。

### 6. 旧实现删除与收敛

- [ ] 删除 Meridian、旧 rail/sidebar、点状时间线、EXEC、阶段分区、Approval 时间线
  卡、Quick Chat Composer、旧主题文案和无使用者 CSS/class/test fixture。
- [ ] 删除旧 UI 偏好和兼容分支；保留的枚举/字段必须能追溯到当前合同。
- [ ] 扫描当前代码、测试、活跃文档与可访问名称，确保没有 Lobby、Meridian、
  `Worked for`、`⌘↵` 或顶栏 Stop/`•••` 残留。

### 7. 验收与发布证据

- [ ] 完成下列自动化、真实 App、截图、键盘、Focus、200% Zoom、Reduced Motion
  和 redaction 验收。
- [ ] 在版本文档记录实际命令、测试数量、截图路径、发现的已知限制和发布结论；
  不从清单勾选推断测试已经执行。

## 自动化验收

基础门禁：

```bash
pnpm typecheck
pnpm test
pnpm build:desktop
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

与本版本改动直接相关的隔离验证：

```bash
pnpm smoke:core
pnpm smoke:member-config
pnpm smoke:intake
pnpm smoke:skills
pnpm smoke:mcp
pnpm smoke:memory
pnpm smoke:recovery
pnpm smoke:action-approval
pnpm smoke:multi-agent
pnpm smoke:team-context
pnpm smoke:team-tasks
pnpm package:mac
```

- Quick Chat/Pin 必须新增隔离 `userData` 的冷启动、原子写、失效清理、安全删除与
  symlink fail-closed 测试。
- Renderer 测试必须验证语义和可访问关系，不继续用被删除的 legacy class 名作为
  产品合同。
- Runtime Approval 至少用真实支持动态审批的 Adapter 覆盖单项、两个成员并发、
  deny、allow、重复点击 fencing 和重启恢复；每种 Adapter 只能呈现自己实际 options。
- Diagnostics/MCP/Skill/Memory 的导出、错误和截图不得包含凭据或用户正文。

## 真实 App 截图与交互矩阵

所有页面至少验证 Arctic Dawn Day 的 `1440×920` 与 `1040×700`。`system/day/night`
三种偏好都要截取关键页，证明三者使用同一 Day，而不是把 Night 当作暗色验收。

| 表面 | 必测场景 |
|---|---|
| Quick Chat/Sidebar | 空与最近 5 项、普通/置顶 Camp、置顶 Project、显示更多、无效 Pin 清理 |
| Camp | 空 Camp、运行中、终态折叠、Tool 成功/失败、Task、A2A、Pending Intent、Recovery |
| Approval/Composer | 1 项、2 个成员聚合、长 scope、每 Runtime 原生 options、解决后 Focus、Stop |
| Inspector | 五 Tab、徽标为零/非零、Activity/Audit 分离、310px/260px |
| 成员 | 空名册、在队/暂离、拖拽/键盘排序、portrait/icon/fallback、圆形取景拖拽/缩放/键盘/低分辨率、Ready/Unresolved、编辑失败恢复、移除 blocker/成功 |
| 长期记忆 | 空 Scope、过滤/搜索、直接伙伴写入、Proposal/stale、CAS、Retired/Forget |
| 技能 | 空、Bundled/Imported、风险、更新、删除排空、Ready/Shadowed/Stale/Unsupported |
| MCP | 空、malformed、权限修复、导入秘密遮罩、STDIO/HTTP、成员分配、删除 |
| 执行引擎 | 全产品、检测中、已找到待检查、Ready、缺失、登录、软刷新、高级入口 |
| 外观 | 三偏好、Night 待设计文案、无首绘闪烁、切换不丢 UI 状态 |
| 诊断 | Loading、4/4、部分失败、重检失败、取消导出、成功导出与 redaction |
| 创建 Dialog | Quick Chat/目录/Git、Picker cancel、成员/Lead、非法/陈旧 Draft、成功与失败 |

每个交互表面还要覆盖：

- 纯键盘、可见 Focus、Tab/方向键、Escape、Focus Return；
- `prefers-reduced-motion` 与 200% Zoom；
- Loading/Empty/Partial/Error/Disabled/Submitting/Recovery；
- 无整页横向滚动、无主要操作遮挡、无仅颜色状态。

## 完成定义

v0.24 只有同时满足以下条件才可完成：

1. 范围内全部页面已经使用同一 Arctic Dawn Day，不存在长期新旧混搭；
2. Quick Chat、Pin、Approval 停靠区、Camp Header/Composer/Inspector 符合冻结规范；
3. Night 仍保留偏好但没有伪实现或旧主题回退；
4. 旧 UI 代码、文档真源、兼容分支、CSS 和测试 fixture 已清理；
5. 自动化与真实 App 矩阵通过，版本文档记录可复现证据。

## 已独立完成的 v0.24 领域修正

- [x] 移除 A2A `request_accepted/result_received` 系统 CampMessage，Camp Snapshot
  提供跨来源顺序，Renderer 以 `发送者 → @接收者`显示已投递 InboxMessage，并迁移
  隐藏历史 `a2a-state` 卡。
- [x] 按 ADR-0075 将 Runtime 完整 SHA-256 移出消息发送热路径；v38 持久保存轻量
  文件身份，AgentRun/Context Compaction 只在身份变化或记录缺失时于实际执行边界
  重新完整校验，失败不撤回用户消息。
- [x] 按 ADR-0076 将消息提交与 AgentRun 启动检查分离：Renderer 立即乐观显示并用
  权威消息 ID 对账，`camp.messages.send` 原子保存消息/Turn/queued Run 后返回；
  Workspace、Runtime 与 starting Git observation 统一由后台调度器处理。

2026-07-30 的现有证据：

- `cargo test -p rovai-core`：library 208 项、binary 44 项通过；5 项人工 Runtime
  smoke 保持显式忽略。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `pnpm typecheck`、`pnpm test`（21 files / 105 tests）与
  `pnpm build:desktop`：通过。
- `pnpm package:mac`：通过，生成签名的 arm64 `dist/mac-arm64/Rovai-ai.app`。
- `pnpm smoke:member-config`：通过，覆盖未配置成员、Product Runtime unresolved、
  无隐式 fallback 与冷重启持久化。
- v37 Migration 测试证明旧 `a2a-state` CampMessage 被 tombstone、FTS 与上下文索引
  被清理；Team Tool 测试证明投递和目标完成都不再生成系统 receipt。
- v38 Migration、轻量文件身份和 Runtime 配置测试证明发送准入不读取可执行内容，
  同路径替换会在执行边界触发重新完整校验并把不一致状态收敛为需要修复。
- ADR-0076 测试证明旧 Pending Execution Intent 不再阻止消息/Run 入库，后台工作区
  检查失败会保留 CampMessage、在未写 `started_at`/Git observation 的情况下关闭 Run；
  Renderer 测试证明 Core 回执前已形成去重的乐观用户消息。
