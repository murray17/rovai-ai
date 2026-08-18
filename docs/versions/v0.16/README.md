---
document_type: version-overview
version: v0.16
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-28
---

# Rovai-ai v0.16 Runtime 权限归属与 Workspace 语义收敛

> 状态：协议决策与编码检查点 3/3 已完成；本机真实 Runtime 与打包 App 验收通过
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.15 成员生命周期与 Camp 执行准入](../v0.15/README.md)
>
> 跨版本决策：
> [ADR-0059](decisions.md#adr-0059) ·
> [ADR-0060](decisions.md#adr-0060)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.16 取消 Rovai-ai Core 对 Agent 文件、Shell、Git、网络和 Runtime 工具资源权限
的二次裁决，让每个接收 Agent 使用自己冻结的 Adapter 原生权限配置。

本版本解决的现实问题是：A2A 目标 Run 当前复制发送方完整 `workspace_json`，其中的
`read_only | write` 会覆盖接收 Agent 的实际配置；同时 Core 会在 Runtime 原生申请
到达用户前按 `executionRoot` 和通用 Action Policy 拒绝请求，导致拥有可用 Runtime
权限机制的 Agent 无法完成正常协作。

目标边界是：

```text
Core
├── 负责业务身份、协作、准入、持久化、fencing 与应用自有文件安全
└── 不负责 Agent 的 filesystem / Shell / Git / network 资源授权

Agent Runtime
├── 使用接收 Agent 自己冻结的 Adapter Permission Configuration
├── 决定资源访问和原生 sandbox 行为
└── 有结构化申请时，经 Rovai-ai 向用户展示并接收原生选项
```

## 已确认范围

### 1. 新 Run 默认使用 Runtime-managed 权限

每个新 AgentRun 从接收 AgentProfile 解析并冻结：

- Adapter Installation；
- 模型与 Adapter-specific 模型选项；
- Adapter Permission Configuration；
- Binding Compatibility Digest 与 Host 配置摘要。

发送方的模型、Runtime、权限或 Workspace access 不进入接收方配置。Profile 后续
修改只影响新 Run；既有 Run 和恢复中的同一 Run 使用原快照。

### 2. Core 停止资源权限判断

`runtime_managed_v2` Run 不再执行：

- `executionRoot` 包含关系授权；
- `read_only | write` 文件写入拦截；
- Runtime permission grant 不得扩大 Workspace 的检查；
- 通用 Action Permission Envelope 的 allow/ask/deny 资源策略；
- 发送方和接收方资源权限交集；
- 因 Core 资源 Capability 缺失而隐藏真实 Runtime permission request。

Core 仍可在启动前确认工作目录为可用的绝对目录，但 Agent 启动后的其他路径访问由
Runtime 决定。

### 3. Workspace 只表示 Run 工作目录

逻辑 Workspace 收敛为：

```rust
struct Workspace {
    path: PathBuf,
}
```

该路径只用于一个 AgentRun 的启动和恢复，并在 Run 内保持不变。它不是 sandbox
root、权限边界、Task 字段或仓库所有权。

为降低升级风险，本版本暂时保留 `execution_root`、`access`、`workspace_json`、
`isolation`、`repository_scope_id` 和 `base_git_commit` 等物理字段。对
`runtime_managed_v2` 而言，只有工作目录路径参与 Runtime 启动；旧权限字段不参与
资源拦截。

### 4. A2A Team Tool 合同不变

`team.post_message` 不增加任何字段。模型仍只能提供：

- `recipientAgentId`；
- `body`；
- `references`；
- `inReplyToMessageId`。

Core 创建目标 Run 时：

- 按规则复制源 Run 的工作目录路径，不复制源 Workspace 权限；
- 使用接收 Agent 自己的冻结 Runtime 配置；
- 不继承源 Run 的领域 Task；
- 从认证 Binding 派生 parent/root Run 和 A2A depth；
- 按现有 ContextManifest 规则组装接收方上下文。

如果 Agent 1 希望 Agent 2 到另一目录工作，由 Agent 1 在消息正文或持久 Task 描述
中明确路径。Agent 2 读取要求后，通过自己的 Runtime 切换或直接操作目标目录。
Core 不把这段自然语言解析成 A2A 字段或权限。

### 5. Runtime 原生权限申请继续展示

对支持结构化动态审批的 Adapter，Rovai-ai 必须保存并展示真实请求：

- 请求能力、命令或路径；
- Runtime 给出的原生选项；
- 每个选项的作用域和生命周期；
- 请求所属 Agent、Run、Turn 和阻塞影响。

用户选择的是原生选项，而不是 Rovai-ai 发明的跨 Runtime 通用权限档位。允许一次、
允许本 Session、拒绝或取消等选项只在当前 Runtime 实际提供时展示。

一次性选择不修改 AgentProfile 权限配置。Session 选择保持 Runtime 原生含义。
不能无损往返的请求明确失败并显示 Adapter 诊断，不能猜测、扩大或自动批准。

没有结构化动态审批能力的 Runtime 继续按其冻结配置执行；产品明确显示能力限制，
不合成 Approval，也不恢复 Core 资源策略作为 fallback。

### 6. Action/Approval 降为真实请求与报告的记录

本版本保留 Action、Approval、Runtime delivery 和 recovery 基础设施，但改变其边界：

- Runtime 确实发出 permission request 时才创建对应记录；
- Runtime 确实报告动作/结果时才记录观察事实；
- Core 自己中介的应用/领域操作继续按其专属授权记录；
- 不为 Runtime 未请求、未报告的文件/Shell/Git/网络动作合成 Action 或 Approval；
- 没有记录不等于证明没有发生资源操作。

已记录请求继续使用稳定 ID、摘要、Native request identity、epoch fencing、投递 ACK
和诚实的 unknown/recovery 状态。

### 7. Core 业务安全保持

下列规则不受本版本影响：

- Member Presence、CampMember 和目标可用性；
- Task 创建/更新等 Rovai-ai 业务 Capability；
- Team Tool Binding、调用身份、幂等、A2A depth/turn quota；
- Runtime Installation、Readiness、模型及配置结构校验；
- Conversation 单活动 Run、execution epoch 和恢复 fencing；
- ContextManifest、公共/私有上下文可见性和边界；
- Rovai-ai 自有头像、Blob、Skill/MCP/Memory Projection、私有配置、凭据、
  Socket、日志、临时文件和数据库的文件安全。

### 8. 产品界面统一使用“执行引擎”

Runtime、Adapter 与 AdapterInstallation 继续作为内部架构、协议和持久化术语；普通
用户界面统一称为“执行引擎”：

- 成员设置区域标题显示为“Agent运行时”，其中 `Adapter Installation` 字段显示为
  “执行引擎”；
- 设置与诊断中的 generic Runtime 标题显示为“本机执行引擎／执行引擎能力”；
- Camp readiness、审批、空状态、Toast 和动态错误同样使用“执行引擎”；
- 需要区分具体实现时显示 Codex CLI、OpenCode CLI 等产品名，或使用“执行引擎类型／
  适配器”，不向用户暴露内部类型名。
- 新对话页使用与 Meridian 世界观一致的随机欢迎语，不展示初始 Lead 身份块、
  默认接收关系或 Readiness；`@ 添加成员`继续作为显式多成员入口。
- 新消息的 `@` 候选和正文使用全局唯一成员名；历史 `@handle` 在展示层转换为
  成员名，不追加括号 handle，也不改写历史消息。
- 成员创建/编辑不显示或提交 handle；Core 为新成员生成 12 位 Base58 内部 ID，
  名称冲突由 Desktop 提交前提示并由 Core 事务最终拒绝。
- 设置导航移除独立「上下文」页；摘要模型复用原合同，移动到成员详情中默认折叠的
  「高级设置」，并明确这是 Camp 共享配置。表单不再提供执行引擎选择器：自动回退
  之外，只能选择当前成员自己的 Agent运行时默认模型或该运行时报告的明确模型。

执行引擎术语只收敛产品文案。成员身份收口会移除创建/更新 Contract 的 handle 输入，
但保留 Rust 兼容反序列化和 SQLite 旧字段；摘要配置 Contract 与 Core 逻辑不变。

### 9. 大厅读取不执行可执行文件指纹计算

成员列表和大厅的 Runtime Readiness 是基于最新持久化
`AdapterInstallation` capability snapshot 的只读投影。普通 Profile 读取不得打开或
哈希执行引擎文件；App 启动和 Camp 打开不自动探测或刷新执行引擎。成员页、诊断页
按需发起 Runtime discovery，用户显式刷新安装时才更新 snapshot。创建新 AgentRun
前的权威准入仍会重新计算当前可执行文件指纹，并在 snapshot 已过期时拒绝启动。

Renderer 首次加载大厅时从已经取得的成员列表推导展示用 Camp creation preflight，
不再同步发出第二次完整成员读取。用户进入新会话或提交消息时仍请求 Core 的权威
preflight，Core 的最终 Run 创建事务仍独立执行 Presence、CampMember、配置和执行
引擎指纹校验。展示投影不能替代执行准入。

健康检查与安装刷新属于长请求，Core 将其调度到普通交互请求队列之外；探测期间
Camp 打开仍执行 Lead reconciliation 和一次权威 snapshot，事件订阅直接沿用该
snapshot 的 sequence marker，不再重复请求初始 snapshot。

### 10. Camp 实时展示执行摘要与步骤

Codex AgentRun 的 Turn 明确请求 provider reasoning summary，并将 Agent 进展说明、
计划更新、推理摘要、命令、文件变更与工具调用等原生通知投影到当前 Camp 的实时
执行过程。界面只展示 Runtime 明确报告的说明、摘要和结构化步骤，不展示、推断或
伪造未公开的原始思维链。
这些高频进度通知是当前运行期的瞬时投影，只供用户在当前会话界面观察；不会写入
CampMessage、摘要或检索索引，也不会被 `context.search`、后续 AgentRun 输入或 A2A
上下文读取。公共最终消息、Action、Approval 和领域审计仍按各自既有持久化合同保存。

Camp 中的用户消息同时支持原生文本选择和明确的「复制」操作；复制正文使用当前
成员名称展示结果，不把内部 handle 重新暴露给用户。

Antigravity App 可被用户直接 `@` 启动，也可作为 `team.post_message` 创建的 A2A
目标 Run；接收方只需自己的 Runtime ready，不需要具备发送方的 Team MCP capability。
官方文档与本机 Antigravity 2.0 App 均确认 Desktop App 支持标准 MCP，原先以 CLI
没有 `--mcp` 参数推导 App 不支持是错误的。Core 已移除 Antigravity Adapter 名称级
拒绝，发送侧只检查冻结 capability。当前 Rovai Adapter 实际仍执行 `agy --print`
companion，并未接入 Desktop App 的 workspace MCP 配置，所以它暂不声明
`team_tool.post_message`；这不影响它接收并完成叶子 A2A Run。

## 非目标

- 不向 `team.post_message` 增加 Workspace、Task 或 Run identity 参数。
- 不把 Workspace 存入 Task，也不通过 A2A 转移 Task 责任。
- 不让 LLM 生成 parent/root Run、execution epoch 或完整上下文 Blob。
- 不构建跨 Adapter 的通用 `read_only | write | unrestricted` 产品权限档位。
- 不让用户长期切换 `RuntimeManaged | CoreEnforced` 两套产品模式。
- 不立即删除全部 legacy Workspace、Action Policy 或 Approval 字段。
- 不承诺记录 Runtime 没有报告的每个文件或命令操作。
- 不削弱 Rovai-ai 自己管理文件和凭据时的安全检查。
- 不在本版本增加第三方动态 Adapter 加载或新的 Runtime。

## 升级策略

v0.16 使用 Migration v27：

- 为 AgentRun 增加不可变 `permission_semantics`；
- 迁移前仍非终态的 Run 标记为 `core_enforced_v1`，只为同一 Run 的恢复保留旧行为；
- Migration 后创建的 Run 明确写入 `runtime_managed_v2`；
- 迁移前终态 Run 永不恢复执行，不需要进入 v1 活动分支；其既有 Workspace、
  Action 与 Approval 继续保留历史事实；
- 不改写既有 AgentProfile Adapter Permission Configuration；
- 不删除或重解释历史 `workspace_json`、Action、Approval 或 Runtime delivery；
- v1/v2 读取和恢复必须可区分，不能依赖“字段是否为空”猜测语义。

`core_enforced_v1` 只用于兼容存量 Run，不出现在成员设置或普通产品 UI 中。待所有
可恢复 v1 Run 消失后，再以独立版本删除旧行为和无用字段。

## 验收模型

自动验证至少覆盖：

- fresh 数据库与 v0.15 fixture 升级到 Migration v27；
- 既有非终态 Run 标记 v1、新 Run 标记 v2、恢复不改变语义；
- A2A sender read-only/recipient write 与 sender write/recipient restricted 的双向
  隔离；
- `team.post_message` Schema 字节级合同不增加 Workspace/Task/parent Run 参数；
- A2A 只传工作目录路径，Task 仍为空，parent/root/depth 仍由 Core 派生；
- v2 Run 访问 Workspace 外路径时 Core 不返回 scope/access denial；
- Codex 与 ACP 原生 permission request 的选项、选择、投递和 ACK 往返；
- 一次性与 Session 选择不改 AgentProfile；
- unsupported/unroundtrippable Runtime request 明确失败且绝不自动批准；
- Runtime 报告与未报告操作的审计语义；
- v1 Action/Approval recovery 与 v2 Runtime request recovery；
- Rovai-ai 受管文件 traversal/symlink/size/atomic-write 回归不退化；
- Approval UI Day/Night、键盘、最安全初始焦点和双尺寸布局。
- 设置导航不再包含「上下文」，成员高级设置默认折叠，展开后仍通过既有摘要模型
  API 读取和保存自动回退、当前成员 Agent运行时默认模型或该运行时的明确模型；
- 新成员 handle 为 12 位 Base58 且不接受客户端指定值；名称重复在 Desktop 与 Core
  均被拒绝，名称编辑不改变内部 handle；
- Composer、历史消息、Camp 标题、最近会话和导航中的 `@` 均显示成员名称。

真实 Runtime Smoke 至少覆盖当前本机可验证的 Codex 与 ACP 路径，并对其他 Adapter
记录明确的结构化审批 Capability 结果。不得用 Mock 通过替代真实协议往返证据。

## 当前版本状态

ADR-0059、Migration v27、per-Run `permission_semantics`、path-only Read Model、
接收方独立 Runtime 快照、Codex/ACP exact option relay、Renderer 原生选项卡与兼容
恢复分支均已实现。新 Run 固定为 `runtime_managed_v2`；只有升级时仍非终态的旧 Run
进入 `core_enforced_v1`。普通 Renderer 文案已统一使用“执行引擎”，并通过动态错误
映射、渲染反向断言和打包 App 术语断言防止内部 Runtime/AdapterInstallation 名称
重新泄漏。大厅首次展示复用成员 Read Model，普通 Runtime Readiness 读取只使用已
持久化 snapshot；可执行文件指纹只在安装刷新和新 Run 权威准入路径计算。

本机已通过 Codex CLI 0.145.0、OpenCode 1.18.0 与 GitHub Copilot CLI 1.0.75 的
真实请求/允许/拒绝往返，并通过双 Agent A2A、Core/Renderer 单元测试、macOS arm64
打包及严格 codesign 校验。具体命令与结果见
[实施计划的当前证据](implementation-plan.md#当前证据)。
