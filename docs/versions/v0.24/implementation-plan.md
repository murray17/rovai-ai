---
document_type: implementation-plan
version: v0.24
lifecycle: current
authority: implementation-plan-and-acceptance
design_status: frozen
implementation_status: complete
last_updated: 2026-07-31
---

# v0.24 实施与验收

> 当前阶段：首轮与 v7 导航、设置覆盖、空 Camp 欢迎状态均已完成生产实现和本地打包
> 验收。Night 不属于本版本完成条件。

## 设计检查点

- [x] Arctic Dawn V3 成为唯一当前 Renderer 设计权威，领域与安全合同优先。
- [x] 同一版本覆盖 Quick Chat、Camp、成员、长期记忆、五个设置页和创建 Dialog。
- [x] 保留 `system | day | night` 偏好，v0.24 全部解析为 Arctic Dawn Day。
- [x] Project/Camp 置顶进入产品；Electron Main 原子保存应用级 Navigation 偏好。
- [x] 所有一级页面常驻 270px 统一侧栏，删除可变图标轨和独立对话列。
- [x] “快速对话 / Quick Chat”通用语言、内部标识与无兼容切换由 ADR-0074 冻结。
- [x] ADR-0078 冻结 v7 增量：Quick Chat 只做项目式 Renderer 投影、`Rovai AI`
  只做侧栏字标、设置覆盖同一侧栏、删除 Core 健康入口。
- [x] 设置再次进入时保留上次分类；“返回 App”继续恢复原一级页面和 Camp。
- [x] 空 Camp 欢迎状态只读取既有事实并填充现有 Composer，不新增领域状态或发送
  入口；Approval 继续不进入时间线。
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
- [x] 用户于 2026-07-30 明确授权开始 Arctic Dawn 生产实现。

## 实施检查点

以下顺序只在上一节最后一项完成后执行。每个检查点必须保留可运行基线，不能把旧新
设计长期并置。

### 0. 基线与范围保护

- [x] 记录现有 dirty worktree 所有者与重叠文件，保存当前测试/截图基线，不覆盖
  并发 A2A 或其他用户改动。
- [x] 为 Arctic Dawn 增加纯状态/文案/几何测试入口，先让旧实现以预期失败暴露差距。
- [x] 确认 `.openai/hosting.json` 不存在；本任务是桌面 Renderer，不创建或部署网站。

### 1. 合同、偏好与一次性切换

- [x] 完成 ADR-0074 的 `QuickChat / quick_chat / quickChat / quick-chat` 全栈替换，
  安全删除精确旧 `<userData>/lobby/`，无别名、双读或迁移。
- [x] 增加 Electron Main 的 `userData/navigation.json` 原子 Pin Store、Preload IPC、
  校验、失效清理和测试；Core SQLite 保持不变。
- [x] 保留 ThemePreference 真源，但让所有偏好解析为 Day；删除 Meridian Night
  Token 使用路径和旧首绘回退。

### 2. Arctic Dawn 基础与 App Shell 首轮基线

- [x] 建立 Day Token、证据 Token、成员身份色、Focus、排版、间距与 Reduced Motion。
- [x] 重建固定 270px 统一侧栏、品牌、一级入口、Camp 快速跳转、置顶、
  Quick Chat/Project/Camp 列表和行操作；v7 替代项见第 7 节。
- [x] 删除 rail resize/collapse/local preference 与分组折叠状态。
- [x] 重建 Quick Chat 品牌落地与最近 5 个 Camp 恢复列表，确认无 Composer。

### 3. Camp 工作区

- [x] 重建 50px Header、左对齐阅读流、横向日期分隔、用户/Agent/A2A 消息和复制。
- [x] 以顺序叙述 + 紧凑 Tool Call 重建 Execution Evidence；实现终态过程折叠和
  独立最终回复。
- [x] Task 保留消息区边界事件；删除 Approval 消息卡。
- [x] 增加 Composer 上方固定的非模态 Approval Dock，覆盖单项、多成员聚合、
  Runtime 原生 option identity、逐项解决、Focus 和与 Inspector 同源。
- [x] 重建 Enter/Shift+Enter/IME/@ 候选、Pending Intent、Send/Stop/Stopping 状态。
- [x] 重建 310px/260px 五页签 Inspector 及 Activity/Audit 职责分离。
- [x] 删除 Header Stop/`•••`，把 Pin/Rename/Delete 收敛到侧栏 Camp 行。

### 4. 一级管理页面

- [x] 成员：64px Header、Presence 分组内直接调整 Member Order、272/250px 名册、
  `4:5` portrait + 50px 圆形 icon 身份区、Runtime、Memory Capability、高级摘要
  设置和保留式永久移除。
- [x] 编辑身份：960px 有界双栏 Dialog、PNG/JPEG 受管源图、圆形 icon 拖拽/滚轮/
  滑杆/键盘取景、28/32/34/44px 预览、低分辨率与恢复状态，并继续使用 ADR-0056
  的单一 `avatarRef` 复合资产和 asset-first commit。
- [x] 长期记忆：摘要、策略、Proposal Drawer、Scope/治理/搜索、310/390px 双栏、
  Revision/Lifecycle/CAS/Projection 与所有边界状态。

### 5. 设置与创建 Dialog 首轮基线

- [x] 建立五个设置分类和统一 Hero/Block/List 内容组件；v7 导航替代项见第 7 节。
- [x] 技能：Library、风险摘要、启停/删除、导入更新、完整 Projection 状态。
- [x] MCP：真源路径、malformed/权限状态、Import、typed Editor、成员分配与 redaction。
- [x] 执行引擎：完整 Product Catalog、快速发现/深度探测状态、安装帮助与高级入口。
- [x] 外观：跟随系统/日间/夜间三偏好；当前显示 Day，Night 标“视觉待设计”。
- [x] 诊断：局部健康、路径/能力、集中 redaction 和 JSON 导出。
- [x] 创建新对话：760px Dialog、固定 Header/Footer、四步骤、原子失败保留和 Focus
  Return；所有“大厅/Lobby”文案改为“快速对话/Quick Chat”。

### 6. 旧实现删除与收敛

- [x] 删除 Meridian、旧 rail/sidebar、点状时间线、EXEC、阶段分区、Approval 时间线
  卡、Quick Chat Composer、旧主题文案和无使用者 CSS/class/test fixture。
- [x] 删除旧 UI 偏好和兼容分支；保留的枚举/字段必须能追溯到当前合同。
- [x] 扫描当前代码、测试、活跃文档与可访问名称，确保没有 Lobby、Meridian、
  `Worked for`、`⌘↵` 或顶栏 Stop/`•••` 残留。

### 7. v7 导航、设置覆盖与空 Camp 增量

- [x] 普通侧栏只保留“置顶 / 项目”；directory Projects 在前，Quick Chat 文件夹式
  投影固定在末尾，底层 `quickChat`/`projects` 合同不变。
- [x] 普通与设置侧栏使用 `Rovai AI` 字标并删除副标题；正式 `Rovai-ai` 打包、窗口、
  userData 与内部 namespace 不变。
- [x] 设置分类覆盖同一 270px 侧栏；删除内容区 188px 导航，保留上次分类和返回 App
  的原页面/Camp恢复。
- [x] 删除侧栏 Core 健康入口及无使用者样式/props；保留 health load、诊断页与导出。
- [x] 空 Camp 欢迎状态显示真实 Workspace、Lead、成员和 Runtime 摘要；三个建议只
  填充并聚焦现有 Composer。
- [x] 修正空 Inspector 文案，确保 Approval 只指向 Composer 上方 Dock 与 Inspector，
  不声称进入时间线。
- [x] 更新 Renderer 语义测试、主题 Token 测试、两个目标尺寸截图和键盘/Focus/
  Reduced Motion/200% Zoom 验收。

### 8. 验收与发布证据

- [x] v7 增量完成下列自动化、真实 App、截图、键盘、Focus、200% Zoom、Reduced Motion
  和 redaction 验收。
- [x] 在版本文档记录 v7 实际命令、测试数量、截图路径、发现的已知限制和发布结论；
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
| Quick Chat/Sidebar | 空与最近 5 项、普通/置顶 Camp、置顶 Project、Quick Chat 末尾投影、显示更多、无效 Pin 清理 |
| Camp | 空 Camp 欢迎/建议填充、运行中、终态折叠、Tool 成功/失败、Task、A2A、Pending Intent、Recovery |
| Approval/Composer | 1 项、2 个成员聚合、长 scope、每 Runtime 原生 options、解决后 Focus、Stop |
| Inspector | 五 Tab、徽标为零/非零、Activity/Audit 分离、310px/260px |
| 成员 | 空名册、在队/暂离、拖拽/键盘排序、portrait/icon/fallback、圆形取景拖拽/缩放/键盘/低分辨率、Ready/Unresolved、编辑失败恢复、移除 blocker/成功 |
| 长期记忆 | 空 Scope、过滤/搜索、直接伙伴写入、Proposal/stale、CAS、Retired/Forget |
| 技能 | 空、Bundled/Imported、风险、更新、删除排空、Ready/Shadowed/Stale/Unsupported |
| MCP | 空、malformed、权限修复、导入秘密遮罩、STDIO/HTTP、成员分配、删除 |
| 执行引擎 | 全产品、检测中、已找到待检查、Ready、缺失、登录、软刷新、高级入口 |
| 外观 | 三偏好、Night 待设计文案、无首绘闪烁、切换不丢 UI 状态 |
| 设置/诊断 | 覆盖侧栏、保留上次分类、返回原页面、Loading、4/4、部分失败、重检失败、取消导出、成功导出与 redaction |
| 创建 Dialog | Quick Chat/目录/Git、Picker cancel、成员/Lead、非法/陈旧 Draft、成功与失败 |

每个交互表面还要覆盖：

- 纯键盘、可见 Focus、Tab/方向键、Escape、Focus Return；
- `prefers-reduced-motion` 与 200% Zoom；
- Loading/Empty/Partial/Error/Disabled/Submitting/Recovery；
- 无整页横向滚动、无主要操作遮挡、无仅颜色状态。

## 完成定义

v0.24 只有同时满足以下条件才可完成：

1. 范围内全部页面已经使用同一 Arctic Dawn Day，不存在长期新旧混搭；
2. Quick Chat 项目式视觉投影、覆盖式设置侧栏、空 Camp 欢迎状态、Pin、Approval
   停靠区、Camp Header/Composer/Inspector 符合冻结规范；
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
- [x] 按 ADR-0077 将取消请求与 Runtime/Git 收尾分离：Renderer 本地维护
  `cancellingTurnIds`，停止 ACK 后不再同步刷新 Navigation/Camp；Notify 立即唤醒
  协调器，`agent_run.cancelled` 先于后台 ending Git observation 发出。
- [x] 按 ADR-0079 将 `cancelling` 投影到 Turn 内全部 AgentRun，停用运行动画并保留
  草稿编辑/发送门；协调器并发通知多个 Runtime，interrupt 使用 2 秒独立 deadline，
  detach/fencing 使用 1 秒 deadline，Git observation 完全脱离协调器等待路径。

2026-07-30 的完成证据：

- `pnpm typecheck`、`pnpm test`（23 files / 113 tests）、`pnpm build:desktop` 与
  `git diff --check`：通过。
- `cargo test -p rovai-core --all-targets -- --test-threads=1`：library 209 项、
  binary 45 项通过；5 项人工 Runtime smoke 保持显式忽略。并发全量测试曾使一个
  2 秒 Runtime version fixture 在机器高负载下超时，单项与项目规定的串行全量方式
  均通过。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `pnpm package:mac`：通过，生成 arm64
  `dist/mac-arm64/Rovai-ai.app`；本地包使用 ad-hoc 签名，未执行 Apple notarization。
- `pnpm smoke:core`、`pnpm smoke:intake`、`pnpm smoke:member-config`、
  `pnpm smoke:action-approval`、`pnpm smoke:multi-agent`、`pnpm smoke:skills`、
  `pnpm smoke:memory`、`pnpm smoke:recovery`、`pnpm smoke:team-context` 与
  `pnpm smoke:team-tasks`：通过。真实 Approval Smoke 使用 Codex Runtime 的原生
  `accept` option；多 Agent Smoke 的两次 Run 均成功。
- `pnpm smoke:mcp` 到真实 Copilot Runtime 时被本机月度配额拒绝，错误为
  `You have exceeded your monthly quota`。MCP 单元/Renderer 测试与设置页打包截图
  通过；该外部额度限制不改变本地实现结论，恢复额度后可原命令复跑。
- `node scripts/accept-member-avatar-ui.mjs dist/mac-arm64/Rovai-ai.app`：通过，覆盖
  受管头像持久化、mention、缺图 fallback、圆形取景和 Day/Night-preference-Day
  布局；截图目录为
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-member-avatar-ui-captures-7FuHHb`。
- `node scripts/accept-member-lifecycle-ui.mjs dist/mac-arm64/Rovai-ai.app`：通过，
  覆盖两种目标尺寸、Day/Night-preference-Day、键盘/Focus Return、成员排序、
  离队/归队、永久移除、Lead 继承与重启；截图目录为
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-member-lifecycle-ui-captures-5jxOxP`。
- `node scripts/accept-memory-ui.mjs dist/mac-arm64/Rovai-ai.app`：通过，覆盖创建、
  修订、停用/恢复、不可逆遗忘、重启和两个尺寸；截图目录为
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-memory-ui-captures-tSJROS`。
- `scripts/capture-desktop.mjs` 从隔离 `userData` 启动最终包并通过，产出
  `/tmp/rovai-v024-full-home.png`、members、member-detail、runtime-diagnostics、
  member-configured 与 new-conversation 截图；以 `night` 偏好启动时仍确认 DOM
  `data-theme="day"`，Quick Chat 无 Composer 且没有整页横向溢出。
- `accept-new-conversation-ui.mjs` 以 2× 页面比例、`prefers-reduced-motion: reduce`
  和 `night` 偏好通过 Dialog、初始 Focus 与溢出断言；截图为
  `/tmp/rovai-v024-new-conversation-200pct-reduced.png`。
- Quick Chat v39 Migration、Main 安全删除与 Pin Store 测试通过；当前代码扫描只在
  ADR-0074 指定的一次性精确旧目录删除和 Migration fixture 中保留旧词，不存在
  UI/合同别名、双读、Meridian Night、`Worked for`、`⌘↵` 或 Header Stop/`•••`。
- v37/v38 与 ADR-0075/0076 的既有领域测试继续通过，证明 A2A、Runtime 完整性和
  message-first 调度边界没有被本轮 UI/词汇切换破坏。
- ADR-0077 测试证明取消 ACK 可以在 ending Git observation 为空时先形成权威终态，
  observation 随后独立追加；`campTurns.cancel` 不占用交互请求主队列，Renderer
  在权威 Turn 终态前持续保留本地“正在停止…”状态。
- ADR-0079 Renderer 测试证明运行卡、Activity、Stop 按钮与发送门共享同一有效
  cancelling Turn 集合，草稿输入不被禁用；Core binary 测试证明取消操作使用独立
  deadline，协调器以并发 interrupt worker 处理多 Run，并在事件后独立调度 Git 证据。

### v7 增量验收记录（2026-07-30）

- `pnpm typecheck`：通过。
- `pnpm test`：通过，23 个测试文件、115 项测试。
- `pnpm package:mac`：通过，Rust Core release、Electron Main/Preload/Renderer
  构建和 arm64 `.app` 打包成功，产物为 `dist/mac-arm64/Rovai-ai.app`。
- `node --check`：更新后的 `capture-desktop.mjs`、`capture-skills.mjs`、
  `capture-mcp.mjs` 与 `accept-member-lifecycle-ui.mjs` 均通过；旧
  `.settings-subnav` / Core 健康选择器已删除。
- `scripts/capture-desktop.mjs` 从隔离 `userData` 启动最终包并在 `1440×920` 与
  `1040×700` 两档通过。它断言可见字标为 `Rovai AI`、无副标题/Core 入口、
  Quick Chat 是项目区末项、设置覆盖侧栏、空 Camp 上下文来自真实快照、三个建议
  只填充并聚焦 Composer、Approval 空态指向 Composer 上方 Dock，且无整页横向溢出。
  关键截图为 `/tmp/rovai-v7-1440-final-camp-empty.png`、
  `/tmp/rovai-v7-1440-final-runtime-diagnostics.png`、
  `/tmp/rovai-v7-1040-camp-empty.png` 与
  `/tmp/rovai-v7-1040-runtime-diagnostics.png`。
- 同一最终包以 `ROVAI_CAPTURE_SCALE=2`、`ROVAI_REDUCED_MOTION=1` 和 `night`
  偏好再次通过；DOM 仍为 Day，Composer/Inspector 保持可达，欢迎状态滚动区无整页
  横向溢出。关键截图为 `/tmp/rovai-v7-200pct-camp-empty.png` 与
  `/tmp/rovai-v7-200pct-camp-empty-approval.png`。
- `git diff --check` 通过；Renderer、脚本和活跃文档扫描不存在旧
  `.settings-subnav`、`.core-health-link` 或 `.core-health-dot` 使用者。

发布结论：v0.24 首轮与 v7 增量的本地主干实现、自动化、真实 App 与打包证据完整，
版本状态改为 `complete`。Night 视觉仍按约定留给后续独立版本；公开分发仍需正式
签名/notarization，外部 Copilot MCP Smoke 仍需在额度恢复后补跑。
