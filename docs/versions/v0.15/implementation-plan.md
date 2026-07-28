---
document_type: implementation-plan
version: v0.15
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-27
---

# Rovai-ai v0.15 实施计划与验收清单

> 状态：协议检查点 1/1；编码检查点 3/3，实施与验收完成
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0057](../../adr/0057-member-presence-and-retained-removal.md) ·
> [ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md)

检查点按依赖顺序实施。`[x]` 只表示存在代码、Migration、测试或可复现 App 证据；
本文、外部设计包或 ADR `accepted` 不能作为实现完成证据。

## 检查点 0：协议切换

- [x] v0.14 三份版本文档冻结为 `historical`，v0.15 成为唯一 `current`。
- [x] ADR-0057 替代 ADR-0041，冻结 Presence、暂时离队和保留式永久移除。
- [x] ADR-0058 替代 ADR-0012，完整承接 Camp/Task 并冻结 Lead 修复与执行准入。
- [x] CONTEXT 更新 Member Presence、Member Order、removed identity 和执行准入术语。
- [x] Meridian 更新成员页、首页 Composer 与双状态视觉约束。
- [x] 外部 member-management design 降为设计输入，不作为实现真源。

## 编码检查点

### 1. Presence、Migration 与保留式永久移除

- [x] Contracts 将 `status` 收敛为 `presence: present | away | removed`，增加
  `removedAt`，移除 `defaultLeadSuccessors`。
- [x] Runtime Readiness 移除 `profile_inactive`；away/removed 改为独立的执行
  准入 blocker，不能覆盖执行引擎配置/健康状态。
- [x] Migration v26 原子映射 active→present、disabled/archived→away，增加并约束
  removed_at；新库 Seed 与升级库一致。
- [x] `agents.presence.set` 只处理 present/away，不查询 Camp，不改变 Runtime、
  Memory、MCP、头像、Task 或 Run。
- [x] `agents.remove` 使用 exact handle + expectedVersion；removed 终态不可编辑/
  恢复，handle 永久占用。
- [x] removal preview 与命令内复查只把非终态 AgentRun 作为 blocker。
- [x] away 不打断既有 Run；removed 命令不自动 cancel。
- [x] `agents.list/get`、Member Order、identity lookup 分离活动管理读取与历史身份读取。
- [x] removed Profile 的 Runtime/MCP 引用不参与启动、探测或活动引用计数。
- [x] 清理所有当前 `active AgentProfile/CampMember` 谓词：身份资格改用 Presence，
  实际执行继续叠加 Runtime/Capability/Camp/safety admission。
- [x] Companion/Relationship Memory 数据保留，但 away/removed 不进入活动
  projection、retrieval、proposal counterparty 或 Run Context。
- [x] 受管头像引用和文件全部保留；历史 identity summary 继续解析头像。

必须测试：

- fresh、v0.14、mixed active/disabled/archived fixture 与 Migration rollback；
- Presence 全转换、removed terminal、removedAt 约束、version conflict 和幂等重放；
- 无 Runtime 新成员仍 present，set/clear/probe Runtime 不改 Presence；
- away Profile 仍保留独立 Runtime 状态，准入以 `member_away` 拒绝；
- away 对 Camp/Task/Run/Memory/MCP/头像零级联；
- removed Run blocker race、handle conflict/永久占用和重启恢复；
- removed 在每个活动查询/投影中消失，但历史 identity/Task/Run 保持；
- AdapterInstallation 删除不被 removed 惰性 Runtime 引用阻塞。

### 2. Camp Lead 修复与原子执行准入

- [x] 增加幂等 `camp.default_lead.reconcile`；`camps.snapshot` 保持纯读取。
- [x] Lead validity 只检查 current CampMember + Profile present，不检查 Runtime。
- [x] 无效 Lead 按最新 memberOrder/id 选择第一位；无候选写 null；有效 Lead 不因
  reorder/归队被替换。
- [x] Renderer 进入 Camp 时先 reconcile 再 snapshot；并发失败刷新而不猜测。
- [x] 首页初始 Lead 选择第一位 present + Runtime 配置完整成员，不按健康状态跳过。
- [x] 新 Camp membership 包含全部 present Profile；away/removed 排除。
- [x] Default 地址不 fallback；Explicit/Broadcast 使用 present CampMembers。
- [x] mention discovery 显示全部 present 成员并单独展示 Runtime 状态。
- [x] Core exact-handle parser 查询全局保留 handle 索引；away/removed/非本 Camp
  精确 mention 明确拒绝，Renderer 无需枚举 removed Profile。
- [x] 多目标和 `@所有成员` 必须全目标通过才原子创建消息/Turn/Runs。
- [x] 准入失败不创建消息、Run 或空 Camp；结构化错误足以生成定向 Toast。
- [x] away/removed Task Assignee 保留；新执行拒绝，只有用户显式改派。

必须测试：

- current Lead valid/no-op、away/removed、null、有/无 successor、重复 reconcile；
- reorder 后未来继承、旧 Lead 后继而非循环、归队不抢回；
- present Lead 无 Runtime、Runtime unhealthy、其他成员 Ready 时不 fallback；
- 首页无 Runtime、第一配置成员 unhealthy、后续成员 Ready 时不跳人；
- stale snapshot 与提交竞态；
- Default/Explicit/Broadcast、重复目标、部分目标 blocker、away/removed handle；
- rejected preflight 前后所有 Camp/消息/Turn/Run 业务表不变，只新增唯一且不含
  正文的 `command.result(rejected)`，无业务事件或 Wake；
- Task unavailable marker、手动改派和既有 Run 继续。

### 3. Member Workbench、Composer UX 与打包 App 验收

- [x] 成员页改为 roster + detail 单一表面，按在队/暂时离队分组，removed 过滤。
- [x] Presence 与 Runtime 状态独立；未配置/需要检查不改变分组或整行可读性。
- [x] 详情沿用 MemberPortrait，删除格言、统计卡和 Camp membership 面板。
- [x] 离队/归队靠近身份头、直接提交并 Toast；永久移除位于页面末尾。
- [x] 永久移除 Dialog 输入唯一 handle，准确说明数据保留与活动资格终止。
- [x] Runtime form 保留 Adapter-specific model/options/permission descriptors，只中文化。
- [x] 首页与 Camp Composer 不因无 Lead/Runtime 禁用文本输入；仅空文本/提交中禁用
  Send。
- [x] `onSend` 只在 applied 后清空；rejected/error 保留草稿和焦点。
- [x] 主题切换不重建表单，不丢当前成员、草稿、滚动或焦点。
- [x] 本版本成员 Dialog 使用 Radix 焦点约束，支持 Escape、焦点返回和 reduced
  motion；本版本未新增 Popover。
- [x] Day/Night 文字、状态、focus-visible 和边界达到 WCAG 2.2 AA。
- [x] 新增 packaged-App v0.15 验收脚本，覆盖 fresh/upgrade/restart 和双尺寸。
- [x] 更新实现状态和验收证据，三个编码检查点均有可复现证据。

必须测试：

- create/edit/reorder/leave/rejoin/remove/cancel/version conflict；
- 无 Runtime 新成员在队、Runtime 清除不离队、Readiness 变化不换组；
- removed 从名册/详情/候选消失，历史头像与姓名保留且不可点击；
- no Lead、no Runtime、unhealthy Runtime、atomic multi-target 的 Toast 与草稿；
- Runtime descriptor 对 Codex/OpenCode/Copilot/Claude/Antigravity 的模型和权限回归；
- Day/Night × 1440×920/1040×700 × mouse/keyboard；
- 主题切换、焦点陷阱、Escape、焦点返回、aria-live 和 reduced motion。

## 最终证据

截至 2026-07-27 的本地实现证据：

- `cargo fmt --check`：通过；
- `cargo test --workspace`：lib 175/175 通过；bin 33/33 通过，4 个手动真实
  Runtime smoke 保持 ignored；
- `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm typecheck`：通过；
- `pnpm test`：18 个文件、86 个测试全部通过；
- `pnpm smoke:core`、`pnpm smoke:member-config`：fresh 数据库、无空 Camp、
  Presence/Runtime 独立和重启持久化通过；
- `pnpm package:mac`：Main、Preload、Renderer、Release Core 与
  `dist/mac-arm64/Rovai-ai.app` 均构建成功；
- `pnpm accept:member-lifecycle-ui`：隔离的 fresh schema v26 与 v0.14
  active/disabled/archived fixture→v26 均通过；真实按钮/键盘覆盖离队、归队、清除
  Runtime、永久移除、Escape/焦点返回、无继承人 `Lead=null`、Member Order 继承与
  冷重启，且草稿/焦点在拒绝时保留；
- 打包 App 视觉矩阵生成 8 张成员页截图（fresh/upgrade × Day/Night ×
  `1440×920`/`1040×700`），另生成无继承人 Night `1040×700` 与继承后 Day
  `1440×920` Camp 截图；自动横向溢出检查和人工视觉复核均通过；
- `codesign --verify --deep --strict dist/mac-arm64/Rovai-ai.app`：通过。

最终可复现命令：

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm test
pnpm smoke:core
pnpm smoke:member-config
pnpm package:mac
pnpm accept:member-lifecycle-ui
codesign --verify --deep --strict <packaged-app>
```

验收脚本不调用模型，也不读写日常 Rovai-ai 数据；成功输出会保留隔离 fixture 与
10 张截图的绝对路径。任一 Migration、状态保留、Toast/草稿/焦点、截图尺寸、横向
溢出或重启断言失败都会以非零状态退出。
