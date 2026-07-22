# Lumen AI v0.03 实施计划与验收清单

> 状态：五个实施检查点已完成
>
> 架构真源：[README.md](README.md)
>
> 更新日期：2026-07-22

## 实施原则

- 分为五个可独立验证的检查点；每个检查点完成迁移、Core、Contracts、Renderer 和相关测试后再提交。
- 先把现有 Codex 路径无行为回归地迁入 `AgentRuntimeAdapter`，再增加其他 Adapter；不得一边抽象边同时接入四种协议。
- 外部 CLI 的版本、模型、权限和能力全部来自运行时探测，不把本机当前版本硬编码成产品依赖。
- 任一 Adapter 缺少能力时显式报告，不静默换模型、放宽权限、解析终端审批文字或伪造 Session 恢复。
- 每个阶段保持数据库权威状态可恢复；UI 不直接写 SQLite，也不维护第二套 Runtime 真源。

## 当前进度

- **检查点 1 已完成**：v9 Migration、通用 AgentProfile、AdapterInstallation、最近能力快照、成员 Runtime 偏好与 Readiness、Native Binding/AgentRun 冻结字段、Core RPC、Contracts 和独立 Smoke 已落地。
- **检查点 2 已完成**：`AgentRuntimeAdapter` 与内置 Registry 已建立；Codex App Server 执行链已迁入 `CodexCliRuntimeAdapter`，支持按 Installation 路径探测、动态 `model/list`、原生权限映射、冻结运行配置和兼容 Host 复用。
- **检查点 3 已完成**：Renderer 已增加一级“成员”入口与本机 Runtime 管理；支持显式创建/选择成员、身份维护、Runtime Readiness、共享 Installation、动态模型与原生权限配置，以及只读 Camp 关系。
- **检查点 4 已完成**：共享类型化 ACP Host 已落地；OpenCode 与 Copilot 可从本机能力目录读取模型和原生权限，以独立 Adapter 完成 Run、复用 Native Session，并把结构化权限请求接入既有 Action/Approval 链。
- **检查点 5 已完成**：AGY CLI Process Adapter、动态模型探测、原生权限、私有日志生命周期、同 Session 续接和跨 Adapter 惰性交接已落地；四 Runtime 与打包 App 验收通过。
- 新建 AgentRun 会在同一业务事务中解析并冻结实际安装、可执行文件指纹、协议、模型、模型选项、权限及兼容摘要；配置不完整或快照过期时不会留下半成品 Turn/Run。
- Native Binding 以 Installation、Native Session 和兼容摘要组成 CAS 边界；Run 级模型选项不破坏 Session 连续性，Session 级权限变化会在下一次 Run 惰性建立新 Session。
- v10 Migration 会将缺少完整冻结配置的旧非终态 AgentRun 明确收敛为可人工重试的失败，而不是用当前配置伪恢复。
- Codex、OpenCode、Copilot 与 AGY 均具备真实执行 Adapter。Adapter 成熟度与限制继续显式展示；功能检查点完成不等于产品已进入正式发布阶段。

## 检查点 1：数据模型、迁移与 Core API（已完成）

目标：先固定 v0.03 的持久边界，不启动新的外部 Runtime。

实施内容：

- 新增 `AdapterKind`、`AdapterInstallation`、探测快照、模型目录、结构化模型/权限描述符与成员 Runtime 配置的 Contracts。
- 为 `AgentProfile` 增加可空的 Installation、模型选择和带版本权限配置；废弃 `runtime_enabled`、`default_provider` 与 `default_model` 的权威语义。
- Native Binding 增加 `adapterInstallationId` 与 `bindingCompatibilityDigest`；AgentRun 冻结实际安装、版本、能力、模型、权限与配置摘要。
- 增加 AgentProfile CRUD、Runtime 配置保存/清空、Installation 查询/自定义路径、能力快照写入边界等强类型命令和读取 DTO；真实刷新执行留给检查点 2 的 Adapter Probe。
- 实现 TM-13 迁移：保留兼容业务数据，不自动激活旧 Runtime 配置；不可恢复的旧非终态 Run 明确结束。
- Starter Profile 使用新通用模型初始化，四者均为 `runtime_not_configured`。

完成门：

- 新库与旧库迁移测试均通过，重复启动迁移幂等。
- AgentProfile、CampMember、Conversation 和 AgentRun 的既有领域测试无回归。
- 未配置 Runtime 的成员可保存、可加入 Camp，但 Core 拒绝启动 Run，并返回稳定 blocker。

## 检查点 2：Adapter 边界与 Codex 等价迁移（已完成）

目标：用现有 Codex 能力验证统一边界，保持当前产品链可运行。

实施内容：

- 建立 `AgentRuntimeAdapter`、内置 Adapter Registry、`AgentRuntimeHostManager` 和协议客户端边界。
- 将现有 Codex App Server 代码迁入 `CodexCliRuntimeAdapter`，Core 不再直接依赖 Codex 协议类型。
- 实现 Installation 探测、App Server `model/list`、模型选项、权限描述符、Host Key 和配置兼容摘要。
- Codex 结构化权限请求继续桥接现有 Action/Approval，不建立第二套审批状态。
- 保留多 Conversation、多 Native Thread、事件分流、Epoch fencing、中断与恢复行为。

完成门：

- 现有 Codex 单 Agent、多 Agent、Action/Approval 与 Recovery Smoke 全部通过。
- Codex 使用 `runtime_default` 和显式模型均可完成最小 AgentRun。
- 修改 Run 级选项不会无故重建 Session；修改不兼容的 Session/Host 级配置会在下次运行惰性交接。

验证记录（2026-07-22）：Rust 48 个库测试与 17 个 Core 二进制测试、Clippy、TypeScript 类型检查、14 个前端测试及桌面生产构建通过；Core、成员配置、Intake、Recovery、真实 Codex AgentRun、Action/Approval 和双 Agent Smoke 通过。

## 检查点 3：本机 Runtime 与成员管理界面（已完成）

目标：用户能够发现本机 CLI，并完整创建、编辑和配置成员。

实施内容：

- 左侧栏增加一级“成员”入口，实现成员列表、创建、编辑、禁用/归档和 Runtime Readiness。
- 成员详情选择共享 Installation、`runtime_default`/显式模型、能力驱动模型选项及 Adapter 原生权限字段。
- 首次权限推荐值只作为可见草稿；保存后成为明确配置。危险值有明确风险文案，未知字段不渲染。
- “设置与诊断”增加“本机 Runtime”：自动发现、刷新、添加自定义路径、版本/认证/能力状态和引用成员。
- 模型目录先读最近成功快照，再异步刷新；stale、认证失败、安装消失与 `needs_attention` 均有独立 UI 状态。
- 成员页只读展示已加入 Camp；CampMember、Default Lead 和 Camp 权限仍在 Camp 页面管理。

完成门：

- 新建成员不自动绑定唯一可用 CLI；用户保存前不能启动 Run。
- 应用重启后成员身份、模型与明确权限值完整恢复。
- CLI 升级或模型消失不会静默改绑或回退，页面给出可操作的阻塞原因。
- 1040×700 下成员页关键流程可用，键盘焦点、表单标签、错误和禁用状态符合 `docs/UI_STYLE.md`。

验证记录（2026-07-22）：Rust 49 个库测试与 17 个 Core 二进制测试、Clippy、TypeScript 类型检查、17 个前端测试、桌面生产构建及 macOS 打包通过；成员配置进程 Smoke 通过；打包 App 在 1440×920 与 1040×700 下完成“发现 Codex → 用户纳入 Lumen → 选择成员 → 显式保存动态模型/权限配置 → Readiness 可启动”的真实流程。

## 检查点 4：OpenCode 与 Copilot ACP Adapter（已完成）

目标：复用同一个类型化 ACP Client，分别实现两个真实 Agent 产品的语义。

实施内容：

- 实现 ACP stdio 传输、请求关联、Session 生命周期、事件规范化、中断和结构化 permission request。
- 分别实现 `OpenCodeCliRuntimeAdapter` 与 `CopilotCliRuntimeAdapter`；共享协议驱动，不共享产品能力假设。
- OpenCode 使用受支持的进程级隔离配置；不得修改用户全局 OpenCode 配置。
- Copilot Host 级权限摘要进入 RuntimeHostKey；不同 Host 级配置不得错误共享同一 ACP Server。
- 无法可靠读取账户模型目录时只提供 `runtime_default`，不使用网页或内置列表冒充本机真源。
- OpenCode `permission=ask` 与 Copilot `allow_all=off` 的结构化请求进入同一 Action/Approval 链；批准和拒绝均按一次性原生选项回传。
- 用户显式选择 OpenCode `allow` 或 Copilot `allow_all=on` 时，上游可能在无请求回调的情况下直接产生副作用。Lumen 不伪造 Approval，而以 `control_mode=observed` 的降级 Action 审计事实记录可验证摘要，并在审计写入失败时令 Run 失败。
- Runtime 探测保留 Homebrew 等稳定入口；大文件指纹在阻塞线程池并行计算，避免首次健康检查阻塞 Core 请求循环。

完成门：

- 两个 Adapter 分别完成发现、认证检查、最小 AgentRun、中断和可用的 Native Session 连续性测试。
- ACP 权限请求经同一 Action/Approval 链批准、拒绝并跨重启恢复；不出现重复执行。
- 不同权限配置的 Copilot 成员不会共享不兼容 Host；相同兼容配置可以复用。

验证记录（2026-07-22）：Rust 53 个库测试与 23 个 Core 二进制测试、Clippy、TypeScript 类型检查、17 个前端测试、桌面生产构建和 macOS 打包通过；OpenCode 1.18.0 与 Copilot 1.0.73 分别完成动态模型发现、最小 Run、同一 Conversation 的 Native Session 连续、批准写入与拒绝写入；两种开放权限值另行验证为无 Approval 的 observed Action。Codex AgentRun、Action/Approval、双 Agent 共享 Host 和重启恢复 Smoke 均无回归；打包 App 在 1440×920 与 1040×700 下完成 Runtime 诊断、成员显式选择和保存流程。

## 检查点 5：AGY、惰性交接与完整产品验收（已完成）

目标：完成第四种实验性 Adapter，并验证跨 Adapter 与故障路径。

实施内容：

- 实现 `AgyCliRuntimeAdapter` 的安装/认证/模型探测、非交互执行、中断和可验证的 Session 标识。
- 直接暴露当前 AGY 非交互模式可可靠注入的 `mode`、`sandbox` 与 `dangerously-skip-permissions`；不解析 TUI 文本、不伪造结构化 Approval，开放值必须显示危险提示。
- 完成受管隔离配置的权限、生命周期和清理；不得接管认证文件或输出敏感正文。
- 完成 Profile 配置变化后的惰性交接：准备可移植上下文、新建 Session、CAS 换绑、失败保留旧绑定。
- 完成 CLI 原地升级、安装消失、认证过期、能力目录变化、应用中断和重启恢复测试。
- 完成四种 Adapter 的真实本机 App Smoke，并补齐诊断信息和用户可见错误。

完成门：

- 四个 Adapter 都能真正完成至少一次最小 AgentRun；成熟度标签与实际验证范围一致。
- Adapter 切换后 Conversation 逻辑身份和 Lumen 消息连续，旧 Runtime 隐藏上下文不被宣称已迁移。
- 交接任一步失败都不会留下半绑定、重复 Run、永久等待或错误放宽权限。
- 全量 Core、TypeScript、Renderer、Smoke 和打包构建验证通过。

验证记录（2026-07-22）：Rust 55 个库测试与 27 个 Core 二进制测试、Clippy、TypeScript 类型检查、17 个前端测试、桌面生产构建和 macOS 打包通过；Core、成员配置、Intake、Codex AgentRun、OpenCode/Copilot ACP、AGY、Action/Approval、双 Agent 和 Recovery Smoke 全部通过。AGY 1.1.5 验证了 11 个动态模型、Runtime 默认与显式模型、同一 Native Session 续接、AGY → Codex 换绑及私有日志清理。打包 App 在 1440×920 与 1040×700 下完成 AGY 发现、显式纳入、成员初始不选中、模型/权限配置、危险值提示和 Readiness 验收。

## 产品验收矩阵

| 编号 | 场景 | 预期结果 |
|---|---|---|
| AC-01 | 全新安装 | 出现四个 Starter 成员，均未绑定 Runtime |
| AC-02 | 创建自定义成员 | 只创建 AgentProfile；不会自动加入 Camp 或选择 Adapter |
| AC-03 | 发现本机 CLI | 显示稳定路径、实际版本、认证和能力；不固定版本号 |
| AC-04 | 保存成员配置 | Installation、模型、参数和权限均为可见明确值，重启后不变 |
| AC-05 | 推荐权限 | 默认可工作但不越权，且不默认启用无条件批准模式 |
| AC-06 | CLI 全局配置 | Lumen 运行前后用户全局配置文件没有被修改 |
| AC-07 | 模型失效 | 显式模型进入 `needs_attention`；不会静默使用其他模型 |
| AC-08 | CLI 原地升级 | Installation 引用保持，观察版本刷新，新 Run 使用新版本 |
| AC-09 | Codex | App Server 完成最小 Run、Session 连续和结构化 Approval |
| AC-10 | OpenCode | ACP 完成最小 Run、隔离权限配置和结构化 Approval |
| AC-11 | Copilot | ACP 完成最小 Run，Host 级权限得到正确隔离 |
| AC-12 | AGY | CLI 完成最小 Run；无结构化审批回调的限制与开放权限风险被明确解释 |
| AC-13 | 切换 Adapter | 当前 Run 不变；下一 Run 前新建 Session 并原子换绑 |
| AC-14 | 交接中杀进程 | 重启后只有旧绑定或完整新绑定，不存在半迁移状态 |
| AC-15 | 权限拒绝 | Action 不执行，Approval/Action/Run 状态可解释且可恢复 |
| AC-16 | 多成员共享安装 | 兼容配置可复用 Host，不兼容权限配置严格隔离 |

## 每个检查点的验证基线

按改动范围至少执行：

```text
cargo fmt --check
cargo test -p lumen-core
pnpm typecheck
pnpm test
pnpm smoke:core
```

涉及 Runtime 时追加对应 Agent Runtime、Approval、Multi-Agent 和 Recovery Smoke；涉及 Renderer 时启动真实 Electron App 完成键盘、窗口尺寸、错误态与重启验证。最终检查点执行完整构建与 macOS 打包验证。

## v0.03 完成定义

- 五个检查点均通过各自完成门并形成独立提交。
- 四种 Adapter 的能力差异在 UI、日志和错误中可见，没有隐式降级。
- AgentProfile、Conversation、AgentRun、Native Binding 与 AdapterInstallation 的边界与架构文档一致。
- 权限配置明确、隔离、可审计；Lumen 不修改全局 CLI 配置，也不保存上游 Token。
- 应用重启、CLI 升级、Adapter 切换和审批中断均能恢复到确定状态。
- README、ADR、版本实施状态与实际代码和测试结果同步更新。
