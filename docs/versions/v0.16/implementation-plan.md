---
document_type: implementation-plan
version: v0.16
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-28
---

# Rovai-ai v0.16 实施计划与验收清单

> 状态：协议检查点 1/1；编码检查点 3/3，实施与本机验收完成
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0059](../../adr/0059-runtime-owned-resource-permissions.md) ·
> [ADR-0060](../../adr/0060-opaque-member-routing-identity.md)

检查点按依赖顺序实施。`[x]` 只表示存在对应文档、代码、Migration、测试或可复现
App 证据；ADR `accepted` 不表示代码已经实现。

## 实施启动门

本计划完成后必须停在代码实施之前通知用户。只有用户收到文档交付与实现触点说明并
明确要求继续，才能修改生产代码、Migration、Contracts、Renderer 或测试。

- [x] 共享理解逐项确认完成。
- [x] ADR、版本设计和验收边界已形成。
- [x] 用户在“即将开始实施代码”的停点后明确要求继续。

## 检查点 0：协议切换

- [x] v0.15 三份版本文档冻结为 `historical`，v0.16 成为唯一 `current`。
- [x] ADR-0059 替代 ADR-0015，冻结 Runtime-owned resource permission 边界。
- [x] ADR 索引、版本索引、根文档导航、README 与 AGENTS 指向 v0.16。
- [x] CONTEXT 增加 Runtime-managed Permission、Run Workspace、A2A lineage/context
  和应用自有文件安全术语。
- [x] UI 规范明确 Approval 展示 Runtime 原生选项，不发明跨 Adapter 权限档位。
- [x] `team.post_message`、Task、ContextManifest 和 A2A parent/root/depth 的现有合同
  边界保持不变。

## 编码检查点

### 1. Migration、Run semantics 与 Workspace path

- [x] Migration v27 为 `agent_run` 增加受约束、不可变的
  `permission_semantics`。
- [x] 迁移前非终态 Run 标记 `core_enforced_v1`；迁移后所有新 Run 明确写
  `runtime_managed_v2`；终态历史不进入 v1 活动分支。
- [x] 同一 v1 Run recovery 保持旧语义；retry/rework/successor 等新 Run 使用 v2。
- [x] 新增 typed `PermissionSemantics`，禁止用数据库版本、status 或 JSON 字段为空
  猜测行为。
- [x] 为 Workspace 建立只返回绝对 cwd 的 typed path projection/accessor。
- [x] v2 dispatch/restore 只从 Workspace 读取 cwd；`access` 不进入授权或 Adapter
  参数推导。
- [x] 普通 Run 从 `Camp.projectPath` 冻结 cwd；Core 只检查它可作为启动目录。
- [x] A2A 保持 `TeamPostMessageInput` 与 Tool Schema 不变，只从 source Run 提取
  cwd path 并重新构造 target Workspace 兼容快照。
- [x] A2A target 继续 `task_id = NULL`，parent/root/depth 由当前 Binding 派生。
- [x] A2A target 从 recipient Profile/Conversation 独立冻结 Runtime config，
  不复制 sender model/permissions/effective resource policy。
- [x] `workspace.bind` 不再影响 v2 Workspace access、Core admission 或 Adapter
  sandbox；legacy 数据暂时保留。
- [x] Read Model 暴露明确的 Run permission semantics 和有效 Workspace path，
  不把 legacy access 显示成 v2 当前权限。

必须测试：

- fresh schema v27、v0.15 fixture→v27、重复打开与 Migration rollback；
- non-terminal 历史 Run 为 v1，terminal 历史不进入 v1 活动分支，新建每一种 Run
  均为 v2；
- v1 同 Run recovery 与 v1→new successor v2；
- 非绝对/缺失 cwd 在 dispatch 前明确失败；
- v2 外部目录访问不触发 Core scope/access denial；
- A2A sender `read_only` + recipient permissive，以及 sender permissive + recipient
  restricted，接收方配置都只等于 recipient snapshot；
- `team.post_message` JSON Schema、unknown-field rejection、Task null、lineage/depth/quota
  全部保持；
- source Workspace 附带 legacy access/isolation/repository 字段时，target 不继承其
  资源权限含义。

### 2. Runtime permission relay、Action 语义与恢复

- [x] v2 effective config 不再生成 Shell/file/Git/network/runtime grant 的默认 Core
  ask/allow/deny 规则。
- [x] v1 `evaluate_policy`、Workspace scope/access 和 legacy recovery 分支保留且只
  可由 v1 Run 到达。
- [x] v2 intercepted Runtime request 绕过 Core resource policy、
  `validate_workspace_scope`、`workspace.bind` 和 legacy `action.request` gate。
- [x] 引入不可变 `RuntimePermissionRequest` 与 `RuntimePermissionOption`，冻结 raw
  request、options、stable option ID、native response digest 和 request digest。
- [x] Resolution command 从 `approve | deny` 改为当前请求内的 exact `optionId`；
  Renderer 不能提交任意 native response JSON。
- [x] Codex command/file/permissions 方法按实际协议冻结
  `accept/acceptForSession/decline/cancel` 等可用选项。
- [x] ACP `session/request_permission.options` 全量冻结，选择原始 `optionId`，删除
  自动寻找统一 allow-once/reject-once 的产品语义。
- [x] Codex sandbox/approval config 只来自 frozen Codex permissions，不再由
  `workspace.access` 改写。
- [x] OpenCode/Copilot Host/session permission config 只来自各自 frozen Adapter
  permissions，不再因 Workspace access 拒绝 file/execute request。
- [x] Claude Code/Antigravity 只声明真实探测到的 structured dynamic approval；
  unsupported 路径显示 capability limitation，不合成 Approval。
- [x] 无法无损往返的 request/options 产生明确 Adapter diagnostic 并 fail closed，
  绝不自动批准、扩大或猜测选择。
- [x] 一次性或 Session 选择只形成 Runtime decision/delivery，不修改 AgentProfile。
- [x] Runtime request 的重复、digest conflict、stale epoch、lost delivery、ACK、
  restart 和 cancellation 使用稳定 fencing 与诚实状态。
- [x] Runtime reported action/result 继续形成审计记录；未报告操作不合成记录。
- [x] Core-mediated 应用/领域 Action 继续使用其专属 Capability、attempt 与 unknown
  reconciliation，不依赖 Workspace access。
- [x] Rovai-ai 管理的头像、Blob、Projection、凭据、Socket、日志、临时文件与数据库
  路径安全测试保持。

必须测试：

- v1/v2 相同 Runtime request 的不同处理分支；
- Codex 每种 request method 的 option freeze、exact response 和 unsupported choice；
- ACP option 顺序/ID保留、allow once/session（若 Runtime 提供）、reject/cancel；
- Runtime request 路径位于 cwd 外、含 symlink 或目标尚未存在时，Core 不做资源
  authorization；Adapter/Runtime 自己的结果被如实返回；
- permission request 不受 legacy Action Permission Envelope 或 `action.request`
  Capability 抑制；
- optionId 伪造、stale version、request digest 冲突和跨 Run/epoch resolution 拒绝；
- one-off/session decision 前后 AgentProfile permission JSON 字节不变；
- Core restart 前 pending request、resolution 已持久化但未 ACK、Runtime request
  丢失和已报告 unknown effect；
- Runtime 自动允许且未发 request 时不出现 synthetic Approval；
- Runtime 报告 action 时 UI/audit 不写成“Core 已授权”；
- 应用自有文件 traversal、symlink、权限、大小和 atomic write 回归。

### 3. Contracts、Renderer 与真实验收

- [x] Read Model schema 升级，Contracts 同步增加 Run semantics、Workspace path、
  Runtime permission options 和 option resolution。
- [x] 删除 Renderer 公共 `approve | deny` 假设；所有 Approval 操作从冻结 options
  渲染。
- [x] Approval 时间线与 Inspector 显示 Agent/Runtime、精确命令或路径、原因、
  scope/lifetime、阻塞影响及每个选项后果。
- [x] deny/cancel 等最安全选项优先并获得初始焦点；Runtime 未提供的 Session 按钮
  不出现。
- [x] resolving、stale、delivery pending、delivery failed、recovery 和 terminal
  状态有明确文案，重复点击被禁用。
- [x] Member Runtime descriptor 旁显示是否支持“运行中在 Rovai-ai 内申请权限”，
  不新增通用权限档位。
- [x] 普通 Renderer 文案统一使用“执行引擎”，移除 `Adapter Installation`、
  `Agent Runtime`、裸 `Runtime` 及 Runtime readiness 英文状态；内部合同名不变。
- [x] 成员设置区域使用“Agent运行时”标题；Composer、公共消息、Camp 标题和导航
  使用成员名，历史 handle 只做展示兼容，不再追加括号 handle。
- [x] 成员配置移除 handle；Core 为新成员生成 12 位 Base58 内部 ID，名称由
  Desktop 提交前校验和 Core 事务共同保证全局不重复。
- [x] 删除设置导航的独立「上下文」页；摘要模型移入成员默认折叠的高级设置，
  继续复用既有 get/set API、Contract 和 Core 选择逻辑。
- [x] Codex Turn 请求 `summary: auto`；Agent 进展说明、reasoning summary、plan 与
  工具生命周期通过现有 Core 事件通道进入有上限的 Renderer live projection，并按
  AgentRun 展示「进展说明／思考摘要／计划／步骤」。
- [x] Live execution projection 仅供当前会话界面展示；不写入消息、摘要或检索索引，
  不进入 `context.search`、后续 AgentRun 或 A2A 上下文。
- [x] Runtime 公开的 reasoning summary/visible thought 可进入实时界面；未公开的隐藏
  reasoning 不进入产品界面，Runtime 不报告时不合成执行内容。
- [x] Camp 用户消息支持文本选择及显式复制，复制成员名称展示结果。
- [x] 已用当前用户数据库确认眠枝 direct Antigravity Run 正常；A2A 接收不再要求
  接收 Runtime 具备 `team_tool.post_message`，Antigravity 可作为叶子目标。
- [x] 已核对官方文档并本机启动 Antigravity 2.0 Desktop App：App 支持标准 MCP；
  Core 移除 Adapter 名称级发送限制，当前 `agy --print` companion 仍因未声明冻结
  capability 而不能主动继续 A2A。
- [x] Core/Adapter 动态错误、权限选项和说明在普通 UI 边界做术语归一化。
- [x] AgentProfile 普通 Readiness 只读取已持久化 installation snapshot，不同步打开
  或哈希执行引擎文件；新 Run 准入仍计算当前 executable fingerprint。
- [x] 大厅首次展示从已加载成员列表推导 presentation preflight，移除重复的
  `camps.creationPreflight` 成员读取；进入新会话和提交消息保留 Core 权威预检。
- [x] App 启动与 Camp 打开不再自动执行 Runtime health 或逐安装刷新；成员页和
  诊断页按需发现，安装刷新只由用户显式操作触发。
- [x] `health.check` 与 `runtime.installations.refresh` 使用独立长请求调度，
  不阻塞 Camp reconciliation、snapshot 和消息等交互请求。
- [x] Core stdin 对 macOS 瞬时 `WouldBlock/EAGAIN` 退避重试，避免长请求并发后
  空闲读取竞态导致 Core 重启。
- [x] Camp 打开只读取一次初始权威 snapshot；事件轮询沿用其 sequence marker，
  不再因 active Camp 变化重复读取同一 snapshot。
- [x] 新对话欢迎语按草稿随机且稳定；移除默认 Lead 欢迎文案、身份 chip 和空输入
  接收者提示、大厅文件解释和可见快捷键提示，保留显式 `@ 添加成员`、已选目标
  反馈及实际键盘快捷键。
- [x] A2A 消息/Task 中的目录说明保持普通文本，不被 Renderer/Core 解析为字段。
- [x] Day/Night、键盘、focus-visible、aria-live、reduced motion 和双尺寸布局通过。
- [x] Core/Renderer/Contracts 单元测试、Smoke、真实 Runtime 与 packaged App 验收
  全部更新。
- [x] 实施完成后逐项回填真实证据；不得用文档或 Mock 代替 Runtime 往返。

必须测试：

- Contract 对每种 option kind、unknown option、无 option diagnostic 和旧 snapshot
  兼容；
- Approval 卡选项数量 2/3/4/unknown、长命令、长路径和窄窗口换行；
- 成员、Camp、设置与诊断的渲染文案不再出现 generic
  `Adapter Installation`、`Agent Runtime` 或裸 `Runtime`；
- 初始焦点、Tab 顺序、Enter/Space、stale refresh、焦点返回和错误播报；
- 修改可执行文件后普通 Profile 读取不做文件 I/O，但新 Run 准入仍返回
  `runtime_snapshot_stale`；
- 大厅 presentation preflight 的成员顺序、Presence、Runtime 配置选择规则与 Core
  一致，且 Runtime health 不改变“已配置”的初始 Lead 选择；
- 新对话三条欢迎语均可被选择，同一草稿不因重渲染或主题切换改变；未显式提及时
  DOM 不渲染默认 Lead 名称、身份 chip、接收者辅助行、大厅文件解释或快捷键提示；
- 设置导航没有「上下文」，成员高级设置默认折叠，展开后能用既有 API 读取和保存
  摘要模型；
- 新成员内部 handle 符合 12 位 Base58，名称冲突在表单和 Core 均被阻止，改名不
  改内部 handle；
- 新旧消息、最近会话和导航的 `@` 可见文本统一为成员名称；
- Day/Night × 1440×920/1040×700；
- Codex 真实一次性/Session（协议提供时）目录或命令申请；
- OpenCode/Copilot 至少一个真实 ACP 外部目录或写入申请与 exact option round-trip；
- Claude Code/Antigravity 当前能力显示与实际启动行为一致；
- A2A Agent 1→Agent 2：发送方权限不影响接收方、正文指示另一目录可由接收 Runtime
  自主处理；
- Core 冷重启恢复 pending permission request 或给出无法恢复的诚实终态。

## 最终验证命令

实施完成后至少运行：

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm test
pnpm smoke:core
pnpm smoke:member-config
pnpm package:mac
codesign --verify --deep --strict <packaged-app>
```

v0.16 专属命令为 `pnpm accept:v0.16`。它组合 Migration、A2A 权限隔离、
native option round-trip、重启 fail-closed、Approval 组件渲染测试及本机真实
Codex/OpenCode/Copilot Runtime 验收。

## 当前证据

截至 2026-07-28：

- 协议采访与共享理解已确认；
- ADR-0059、v0.16 README、架构设计、实施计划、CONTEXT 和 UI 约束已建立；
- Migration v27、不可变 per-Run semantics、v1 活动 Run backfill 与 v2 新 Run
  默认值已由 migration/unit tests 验证；
- A2A `team.post_message` Schema 未增加 Workspace 字段；target `task_id = NULL`，
  cwd 只复制 path，recipient Runtime permission snapshot 独立冻结；
- v2 Runtime request 绕过 legacy Capability、Workspace scope/access 与通用
  Action policy；v1 同请求仍走兼容 gate；
- Codex 与 ACP 审批保存完整私有 request digest、公开安全 option metadata，
  Renderer 只提交 exact `optionId`，超时按被冻结的拒绝/取消响应 fail closed；
- Read Model schema 为 8，Run Workspace 只公开 `{path}`；Renderer 安全选项优先，
  成员页明确显示结构化运行中权限申请能力；
- `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
  `pnpm typecheck` 与 `pnpm test` 通过；
- `cargo test --workspace` 最终通过：Core library 181 项、binary 34 项，另有 4 项
  标注为手工本机 Runtime smoke 的 ignored test；首次回归发现的 queued Run path
  projection 缺口已修复；
- `pnpm test` 最终通过 20 个测试文件、96 项测试；覆盖产品术语、无阻塞大厅
  preflight、设置导航移除「上下文」、高级设置默认折叠、摘要模型既有 API、
  名称冲突和 `@` 名称展示；
- Core 成员测试覆盖 12 位 Base58 内部 handle、客户端 handle 被忽略、名称全局
  冲突、改名不改内部 ID 和 removed 历史身份保留；
- 使用当前用户数据库的隔离副本验证：修复前串行启动请求在
  `camps.creationPreflight` 完成时约为 5.27 秒；修复后 Renderer 所需四项大厅读取
  连续三次分别约为 0.65、0.50、0.54 秒，单独 Core preflight 约为 1.8 毫秒。
- 使用同一数据库的隔离副本并发执行强制 Runtime health 与 3 个 installation
  refresh 时，Camp Lead reconciliation 在约 9.8 毫秒返回，权威 snapshot 在约
  11.8 毫秒返回；四个长请求当时均仍在运行。
- `pnpm smoke:core`、`pnpm smoke:member-config` 通过；
- `pnpm smoke:runtime-permissions` 通过 Codex 0.145.0 的项目外命令 exact option
  审批及洛可→沐瓦双 Agent A2A；
- `pnpm smoke:acp-runtime` 通过 OpenCode 1.18.0 与 Copilot CLI 1.0.75 的原生允许、
  拒绝、文件未越权创建和同 Native Session 续接；
- `pnpm accept:v0.16` 已通过，将上述 Migration、A2A、重启恢复、Renderer 与真实
  Runtime 证据收敛为一个可复现验收入口；
- 重建 App 后 `pnpm accept:member-lifecycle-ui` 通过 fresh/v0.14 upgrade、
  Day/Night、双尺寸、Presence/Runtime 独立、Lead 继承与产品术语断言；验收脚本会
  在成员页仍出现 `Adapter Installation`、`未配置 Runtime` 等旧文案时直接失败；
  同一验收还确认 `@` 候选插入成员名、设置导航无「上下文」、摘要高级设置默认
  折叠且通过既有 API 保存，以及成员 handle 不展示、重复名称在表单内被阻止；
- `pnpm package:mac` 生成 `dist/mac-arm64/Rovai-ai.app`，
  `codesign --verify --deep --strict` 通过；本机未配置 Apple notarization 凭据，
  因而未执行公证。
