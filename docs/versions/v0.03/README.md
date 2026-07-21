# Lumen AI v0.03 多 Runtime 成员管理

> 状态：实施中；检查点 1 已完成，检查点 2 待实施
>
> 前置版本：[v0.02 多 Agent 协作架构基线](../v0.02/README.md)
>
> 实施计划：[implementation-plan.md](implementation-plan.md)
>
> 更新日期：2026-07-22

## 版本目标

v0.03 要在 v0.02 的多 Agent 协作基础上，允许用户管理成员的长期身份与默认 Runtime 配置，并通过本机已安装的 Coding Agent CLI 运行这些成员。

首批目标 Runtime：

- Codex CLI
- OpenCode CLI
- GitHub Copilot CLI
- Antigravity CLI（`agy`）

本版本还需要提供成员管理界面，使用户能够创建和编辑成员，并在对应 Runtime 确实支持时选择模型及模型参数。

## 已确认决策

### TM-01 成员的领域边界

- **状态**：已确认
- “成员”是 UI 和产品语言，不新增 `Member` 领域实体。
- 新增成员创建的是全局 `AgentProfile`。
- `AgentProfile` 保存稳定身份、角色与默认 Runtime 偏好，不属于某个特定 Camp。
- 只有将成员加入某个 Camp 时，才创建 `CampMember`。
- “新增并加入当前 Camp”可以是 UI 组合操作，但不能把 `AgentProfile` 与 `CampMember` 合并为一个对象。

```text
新增成员
→ AgentProfile

加入 Camp
→ CampMember(AgentProfile, Camp)
```

### RT-01 四种 Adapter 的 v0.03 支持口径

- **状态**：已确认
- Codex CLI、OpenCode CLI、GitHub Copilot CLI 和 Antigravity CLI 都必须能够真正启动并完成最小 `AgentRun`；只能保存配置但不能运行，不算支持。
- 四种 Adapter 可以具有不同能力与成熟度，缺失能力必须通过能力探测显式报告，不能模拟或静默降级。
- 最小共同能力包括：探测安装与版本、判断认证可用性、使用 Runtime 默认模型或选择已发现模型、执行并接收输出、中断执行、保存 Runtime 能提供的 Native Session 标识。
- 初始成熟度为：Codex `stable`、OpenCode `beta`、Copilot `beta`、Antigravity `experimental`。
- 成熟度描述 Lumen 对相应集成的验证程度，不等同于上游产品本身的稳定级别。

### TM-02 成员的 Runtime 初始选择

- **状态**：已确认
- 新建 `AgentProfile` 时不预选任何 Adapter、安装或模型。
- Runtime 配置是可空的；用户可以先只创建成员身份，之后再显式选择。
- Lumen 即使检测到本机只有一个可用 Adapter，也不得自动替用户绑定。
- 未配置 Runtime 的成员可以保存，但不具备启动 `AgentRun` 的条件；UI 必须明确显示“尚未配置 Runtime”，不能把它伪装成 Runtime 故障。

### RT-02 AdapterInstallation 与 CLI 升级

- **状态**：已确认
- 用户选择 Adapter 后，`AgentProfile` 引用具体 `AdapterInstallation`，而不是只保存 Adapter 类型。
- `AdapterInstallation` 表达稳定的本机启动入口与配置/认证作用域，不代表某个不可变化的二进制版本。
- 对 Homebrew 等稳定入口，应保存用户实际选择的调用路径，而不能把绑定固化到带版本号的 Cellar 目标路径。
- `observedVersion`、二进制指纹、能力与模型目录都是探测事实，可以随原地升级更新。
- 应在应用启动、用户刷新和启动 Runtime 前重新探测；同一安装入口升级后，成员绑定保持不变，新 `AgentRun` 自动使用新版本。
- 已创建的 `AgentRun` 必须冻结实际启动时的安装 ID、版本、能力摘要和有效模型配置，不能被后续升级改写。
- 已在运行的 Host/Run 不热切换二进制；升级后的版本只对后续新建或安全重启后的 Host 生效。
- 如果原入口消失，Lumen 可以发现并推荐其他候选安装，但不能未经用户确认静默改绑。

### TM-03 模型选择与升级兼容

- **状态**：已确认
- 成员选择 Adapter 后，模型配置支持 `runtime_default` 与 `explicit` 两种模式。
- `runtime_default` 不固化模型 ID；每次新建 `AgentRun` 时使用当前安装报告的默认模型。
- `explicit` 保存当前安装报告的稳定模型 ID，以及经该模型能力目录校验过的显式选项。
- CLI 升级或能力刷新后，如果显式模型消失、被隐藏或选项不再合法，成员配置进入 `needs_attention`，并阻止新 `AgentRun`。
- Lumen 不得静默更换显式模型、降低 reasoning effort、删除选项或回退到 Runtime 默认值。
- 已创建的 `AgentRun` 保留当时解析出的有效模型与选项，不因目录刷新而改变。

```ts
type ModelSelection =
  | { mode: "runtime_default" }
  | {
      mode: "explicit";
      modelId: string;
      options: Record<string, unknown>;
    };
```

### RT-03 Runtime 集成层与命名

- **状态**：已确认
- Rust Core 面向 Runtime 的唯一统一接口命名为 `AgentRuntimeAdapter`，不再引入 `AgentAdapter`。
- 四个内置实现分别为 `CodexCliRuntimeAdapter`、`OpenCodeCliRuntimeAdapter`、`CopilotCliRuntimeAdapter` 与 `AgyCliRuntimeAdapter`。
- `AgentRuntimeHostManager` / `AgentRuntimeHost` 只负责进程、连接、复用与生命周期，不是领域实体，也不是所有 Adapter 必须遵守的固定进程拓扑。
- 协议客户端位于 Adapter 内部：Codex 使用 App Server Client；OpenCode 与 Copilot 可以共享 ACP Client；AGY 首版使用 CLI Process 集成。
- Rust Core 不直接依赖 App Server、ACP 或 CLI 输出格式；协议差异由具体 Adapter 吸收。
- v0.03 不建立动态插件 ABI；四种 Adapter 作为内置实现注册。

```text
Rust Core
└── AgentRuntimeAdapter
    ├── CodexCliRuntimeAdapter   ──> CodexAppServerClient
    ├── OpenCodeCliRuntimeAdapter ─> AcpClient
    ├── CopilotCliRuntimeAdapter ─> AcpClient
    └── AgyCliRuntimeAdapter     ──> AgyCliProcess

AgentRuntimeHostManager
└── AgentRuntimeHost（按 Adapter 能力选择长期复用或单次运行）
```

### RT-04 AdapterInstallation 的所有权

- **状态**：已确认
- `AdapterInstallation` 是应用级共享资源，不属于任何一个 `AgentProfile` 或 Camp。
- 多个成员可以引用同一安装实例，同时分别保存自己的模型选择与模型选项。
- 安装实例的身份由 Adapter 类型、稳定启动入口及配置/认证作用域共同确定；同一种 CLI 的不同路径或作用域是不同安装实例。
- 安装路径、探测版本、认证可用性、能力与模型目录由安装实例统一维护，不能复制到每个成员形成多个真源。
- 删除成员、移出 Camp 或清空成员 Runtime 配置均不得删除安装记录。
- Lumen 不保存上游 CLI Token；凭证继续由 CLI 自身配置和操作系统安全设施管理。

### RT-05 CLI 的安装与升级边界

- **状态**：已确认
- v0.03 只发现、验证并引用用户本机已有的 Coding Agent CLI，不负责下载安装或升级。
- 自动发现覆盖当前应用环境的 `PATH` 和各平台已知的稳定官方入口；用户还可以显式添加非标准可执行文件路径。
- 探测负责确认 Adapter 类型、可执行性、版本、认证可用性、协议能力和模型目录，不能只按文件名猜测类型。
- CLI 缺失时，Lumen 可以展示官方安装说明或打开官方页面，但不能直接执行包管理器或远程安装脚本。
- 需要认证时，Lumen 可以启动上游 CLI 提供的官方认证流程，但不读取、复制或保存 Token。
- CLI 升级由用户或上游自更新机制负责；Lumen 只在后续探测时更新 `AdapterInstallation` 的观察事实。

### RT-06 能力与模型目录快照

- **状态**：已确认
- 每个 `AdapterInstallation` 保存最近一次成功的能力与模型目录快照，成员配置页先读取快照，再异步刷新。
- 快照必须记录探测时间、Adapter/CLI 版本、二进制指纹、认证作用域标识、来源和新鲜度；它是外部能力的最近观察，不是永久真源。
- CLI 升级、二进制指纹变化、配置/认证作用域变化、用户手动刷新或 TTL 到期都会使快照失效并触发重新探测。
- 刷新失败时保留最近成功快照用于解释已有配置，但标记为 `stale` 并展示最后更新时间与错误，不能宣称其中模型当前可用。
- 启动新 `AgentRun` 前，过期快照必须刷新或通过 Adapter 做等价的配置校验；显式配置未经当前能力确认时不得启动。
- 无法可靠发现模型的 Adapter 只暴露 `runtime_default`，不使用 Lumen 内置的猜测列表伪造当前账户能力。
- 快照由安装实例共享，不能为每个成员复制一份独立目录。

### RT-07 Runtime 继承与跨 Adapter 交接

- **状态**：已确认
- 有效 Runtime 配置按 `AgentProfile 默认值 → Conversation 可选显式覆盖 → AgentRun 冻结值` 解析。
- Conversation 未设置 Override 时，未来新 Run 实时继承成员最新默认配置；显式 Override 不随成员默认值变化。
- 活动中或已经创建的 `AgentRun` 始终使用其冻结配置，不受后续成员或 Conversation 编辑影响。
- Native Binding 必须同时标识 `adapterInstallationId`、`nativeSessionId` 与 `bindingCompatibilityDigest`；Native Session ID 不能脱离所属安装和创建该 Session 的有效配置单独解释。
- 同一 Adapter 安装内优先 Resume 当前 Native Session；跨 Adapter 切换时不得把旧 Session ID 交给新 Adapter 尝试 Resume。
- 跨 Adapter 交接只保证 Lumen 持有的 Conversation 消息、摘要、水位、当前职责和稳定引用连续，不承诺迁移上游 Runtime 的隐藏推理、内部压缩状态、未公开工具状态或其他私有上下文。
- 新 Adapter 必须先成功创建 Session 并准备可移植上下文，再使用 Conversation 版本、旧安装 ID、旧 Session ID 与旧兼容摘要做 CAS 原子换绑；失败时保留旧绑定。
- 换绑成功后停止旧 Host 对该 Conversation 的事件路由；旧 Native Session 的远端/本地清理由对应 Adapter 以最佳努力处理，不阻塞权威绑定提交。

```ts
type NativeBinding = {
  adapterInstallationId: string;
  nativeSessionId: string;
  bindingCompatibilityDigest: string;
};
```

`bindingCompatibilityDigest` 由 Adapter 根据会影响 Native Session 恢复语义的 Host/Session 级配置规范化生成；纯 Run 级选项不得无故触发 Session 迁移。CLI 版本是否进入摘要由 Adapter 的兼容能力决定，不能全局硬编码。

### TM-04 模型参数的输入边界

- **状态**：已确认
- 成员配置页只允许选择当前 Adapter 能力目录明确声明的结构化模型参数，不提供自由 JSON 或任意 key/value 输入。
- Adapter 负责把上游能力转换为带类型、可选值、默认值和显示标签的 `ModelOptionDescriptor`；Core 负责在保存配置和启动 `AgentRun` 前校验取值。
- v0.03 首先支持实际可发现的枚举型 `reasoning_effort`；某个 Adapter 或模型未声明该参数时，UI 不显示对应控件。
- 不根据模型名称猜测参数，不共享一份跨 Adapter 的硬编码 effort 列表，也不把未知参数未经验证直接传给 CLI。
- Adapter 可以在未来增加新的结构化选项类型，但必须保持能力驱动、显式校验和向后兼容。

```ts
type ModelOptionDescriptor = {
  key: string;
  valueType: "enum";
  values: Array<{ value: string; label: string }>;
  defaultValue: string | null;
};
```

### TM-05 通用成员身份与角色外观

- **状态**：已确认
- `AgentProfile` 是可由用户创建的通用成员身份，不再假定成员只能是洛可、沐瓦、眠枝和绮露四个内置角色。
- `handle` 与 `displayName` 是身份字段；头像、角色标签、身份强调色和短角色标题是可选展示字段。
- 现有动物角色信息保留，但从必填 `species` 迁移为可空 `personaLabel`，新成员不必具有动物设定。
- `roleDescription` 表达长期角色定位，`instructions` 保存实际注入 Runtime 的详细行为指令，两者不能继续混用一个 `roleContract` 字段。
- `accent` 只用于头像、身份标记和所有权提示，不能表示运行、成功、警告或危险状态。
- 废弃 `runtimeEnabled`；成员能否启动 Run 由 Profile 状态、Runtime 配置完整性、安装/认证/能力探测和 Camp/Run 条件共同派生。

```ts
type AgentProfileIdentity = {
  id: string;
  handle: string;
  displayName: string;
  avatarRef: string | null;
  personaLabel: string | null;
  accent: string | null;
  roleTitle: string | null;
  roleDescription: string;
  instructions: string;
  status: "active" | "disabled" | "archived";
};
```

迁移映射：

```text
slug            → handle
species         → personaLabel
role_contract   → roleDescription
runtime_enabled → 删除，由 Runtime Readiness 派生
```

### TM-06 Adapter 原生权限配置

- **状态**：已确认
- v0.03 不建立跨 Adapter 的统一 Runtime 权限等级；成员页直接展示所选 Adapter 已声明的原生权限字段、名称、取值与说明。
- Codex 可以展示 `sandbox_mode` 与 `approval_policy`；其他 Adapter 按各自真实能力展示 permission rules、allow/deny、sandbox 或自动批准等字段，不要求具有相同数量或语义。
- Adapter 通过带版本的结构化描述符声明可编辑权限字段；UI 只渲染描述符中的布尔、枚举、列表或规则控件，不提供任意 CLI 参数文本框。
- `AgentProfile` 保存带 `adapterKind` 与 `schemaVersion` 的 `AdapterPermissionConfig`；更换 Adapter 后旧权限配置失效，必须重新配置。
- `AgentRun` 冻结本次实际使用的原生权限配置；CLI 升级后 Adapter 重新校验字段和值，失效时成员进入 `needs_attention`。
- Adapter 负责把结构化值翻译为 App Server/ACP Session 配置、进程参数或隔离配置；Rust Core 和 Renderer 不拼接 CLI 参数。
- Lumen 的 Task、委派、完成等业务 Capability 继续独立存在，不从 Runtime 权限字段推导。
- 不同 Adapter 的原生选项不宣称等价；UI 必须展示上游说明和明确风险，危险选项不能被中性文案弱化。

```ts
type AdapterPermissionConfig = {
  adapterKind: "codex-cli" | "opencode-cli" | "copilot-cli" | "agy-cli";
  schemaVersion: number;
  values: Record<string, unknown>;
};
```

### TM-07 权限值与首次配置默认值

- **状态**：已确认
- `AgentProfile` 必须保存明确的 Adapter 权限值，不提供运行时动态继承上游 CLI 全局默认配置的模式。
- 成员首次选择 Adapter 时，由该 Adapter 提供一套适合其真实权限模型的推荐值并预填表单，以降低初次配置成本。
- 推荐值必须完整显示且可由用户修改；只有用户保存后才成为成员配置，不能作为隐藏默认值直接运行。
- 预填推荐值在保存前只属于配置页草稿；缺少已保存权限配置的成员不得进入 Runtime Ready，也不得据此启动 AgentRun。
- Adapter 推荐值带描述符版本；后续 Lumen 或 CLI 升级可以更新新建配置的推荐值，但不得静默改写已有成员保存的值。
- 可以提供“读取当前 CLI 配置”辅助填充，但读取结果也必须展示、校验并显式保存为成员自己的配置快照。
- Adapter 只能推荐能在该成员的 Run/Session 上可靠应用的字段；只能修改共享全局配置、会影响其他成员的选项不能伪装成成员级权限。

### TM-08 Adapter 权限配置隔离

- **状态**：已确认
- Lumen 可以在自己的应用数据目录或受管临时目录中，为不同的有效 `AdapterPermissionConfig` 生成隔离的 Runtime 配置；不得修改用户的全局 CLI 配置文件。
- Adapter 必须优先使用上游正式支持的进程参数、环境变量、Session 配置或独立配置入口注入权限。Renderer 和 Rust Core 不直接了解这些传输细节。
- 隔离配置只表达 Lumen 已保存的成员级 Runtime 选项，不复制或接管用户的认证凭据；CLI 仍使用用户自行维护的本机登录状态。
- 若权限选项在一个 Runtime Host 内对全部 Session 生效，则其规范化配置摘要必须进入 `RuntimeHostKey`。只有安装、认证作用域及 Host 级配置兼容的 AgentProfile 才能共享 Host。
- 相同有效配置可以复用同一个 Host，不要求机械地为每个 AgentProfile 启动独立进程；不同 Host 级权限配置不得共享 Host。
- 若某 Adapter 无法通过受支持方式隔离某项设置，v0.03 不在成员页暴露该设置；不得通过修改用户全局配置来伪造成员级能力。
- 受管配置必须限制文件权限，并在 Host 关闭或配置失效后按清理策略回收；诊断信息不得输出凭据或敏感配置正文。
- “读取当前 CLI 配置”仍只是显式导入操作。导入后生成 Lumen 自己的已保存快照，不建立对用户全局配置的动态继承关系。

### TM-09 首次权限配置的推荐基线

- **状态**：已确认
- 各 Adapter 的首次配置推荐值遵循“可工作但不越权”：允许读取和修改当前 `executionRoot`，超出当前工作目录或明显扩大副作用范围的动作使用该 Adapter 的原生询问机制。
- Shell、网络访问和工作目录外访问在 Adapter 支持时默认要求确认；不得在推荐值中默认启用无条件批准或跳过权限检查。
- 推荐值不得默认选择 `danger-full-access`、`allow-all`、`always-proceed`、`dangerously-skip-permissions`，或语义等价的开放模式。
- 该基线不是跨 Adapter 的统一权限协议。每个 Adapter 必须把它翻译为自己真实支持且可可靠注入的明确字段和值，并在成员页展示上游原生名称与含义。
- 当某 Adapter 无法精确表达该基线时，优先选择更保守的可用配置，并明确显示差异；不得为了表面一致而放宽权限。
- 这些值仍只是首次配置草稿。用户确认保存后才写入 `AgentProfile`，随后按 TM-07 的明确值和版本规则管理。

### TM-10 原生询问模式与 Lumen Approval

- **状态**：已确认
- Adapter 必须在能力描述中明确报告是否能把原生权限请求可靠转换为结构化 Runtime Request；协议名称本身不能替代实际能力验证。
- Codex App Server 或 ACP 等结构化权限请求统一桥接到 v0.02 已有的 `Action` / `Approval` 协议，不建立 Adapter 专属审批真源。
- Lumen 可以如实展示 Adapter 的全部已识别原生权限选项，但只有当前安装与集成方式能够可靠执行的取值才可选择和保存；暂不支持的取值必须禁用并说明原因。
- Adapter 不得通过匹配终端输出文字、提示语或 ANSI/TUI 内容来推断审批请求，也不得静默批准、伪造拒绝或让 `AgentRun` 无限等待输入。
- 如果已保存的询问模式在 CLI 升级、协议切换或能力刷新后失去结构化桥接能力，成员配置进入 `needs_attention`，新 `AgentRun` 在 Preflight 阶段被阻止。
- 无结构化请求通道的 Adapter 只能提供经过验证的非交互权限模式；推荐值仍须遵守 TM-09，并在无法精确表达时选择更保守的可用配置。
- 未来只有在 Adapter 提供稳定机器协议，或 Lumen 实现并验证等价的类型化接口后，才可启用此前禁用的询问取值。

### TM-11 成员 Runtime 变更的惰性交接

- **状态**：已确认
- 保存 `AgentProfile` 默认 Runtime 配置只更新长期偏好，不批量启动 Host、创建 Native Session 或立即迁移该成员的全部 Conversation。
- 已创建或正在执行的 `AgentRun` 继续使用冻结配置；配置变更不能中断、热切换或改写这些 Run。
- 未设置 Conversation Override 的 Conversation 在读取模型中显示“下次运行使用新配置”；现有 Native Binding 在真正交接成功前保持有效。
- 下一次新建 `AgentRun` 的 Preflight 发现有效 Adapter Installation 或 `bindingCompatibilityDigest` 与当前 Native Binding 不兼容时，必须先按 RT-07 创建新 Session、注入 Lumen 可移植上下文，再通过 CAS 原子换绑。
- 新 Session 创建、上下文物化或 CAS 任一步失败时，保留旧 Native Binding，不创建或启动使用半迁移上下文的 AgentRun，并返回结构化阻塞原因。
- 换绑成功后，新 Run 才能进入调度；旧 Session 与旧 Host 的停止和清理由原 Adapter 最佳努力完成，不阻塞权威绑定。
- 显式 Conversation Override 不受 AgentProfile 默认值变化影响；v0.03 虽不提供 Override UI，解析边界仍按 RT-07 保留。

### TM-12 Starter 成员

- **状态**：已确认
- 全新安装继续预置洛可、沐瓦、眠枝和绮露四个 Starter `AgentProfile`，保留 Lumen 的角色身份、长期职责与默认协作体验。
- Starter Profile 与用户创建的 AgentProfile 使用同一领域模型，不引入内置成员类型、不可变系统角色或特殊运行分支。
- 四个 Starter Profile 初始都不绑定 Adapter Installation，不预选模型，也不保存权限配置；用户必须在成员页显式完成各自的 Runtime 配置。
- 未配置 Runtime 不影响 Profile 被查看、编辑或加入 Camp，但该成员不能启动 `AgentRun`，并明确显示 `runtime_not_configured`。
- 用户可以编辑、禁用或归档 Starter Profile，也可以创建任意自定义成员；系统不得在用户归档后自动重新生成同一 Profile。

### TM-13 旧版本 Runtime 数据迁移

- **状态**：已确认
- v0.03 迁移优先保留 AgentProfile、Camp、Conversation、CampMessage、Task 及其他仍符合新领域边界的 Lumen 数据，但不承诺延续旧 Runtime 的隐藏上下文或原生执行状态。
- 旧 `default_provider`、`default_model` 与 `runtime_enabled` 缺少 Adapter Installation、认证作用域和明确权限快照，不得自动转换为可运行的 v0.03 Runtime 配置。
- 升级后所有尚未具有完整新配置的成员进入 `runtime_not_configured`；用户必须显式选择 Installation、模型和权限。
- 旧 `native_session_id` 不作为可用 Native Binding 自动 Resume。实现可以保留为只读迁移信息，也可以在新 Schema 中不再迁入；新执行不得依赖它。
- 迁移时仍处于非终态、且缺少完整冻结 Runtime 配置的旧 AgentRun 不尝试恢复；Recovery 必须以明确的迁移中断原因结束旧执行，避免留下永久 running/queued 状态。对应 Task 可在成员配置完成后创建新的 Run 继续处理。
- 用户完成 Runtime 配置后的首次运行，从 Lumen 仍保留的 Conversation 消息、摘要和稳定引用创建全新 Native Session；不为上游私有历史实现专用转换器。
- 若某类旧历史记录的兼容迁移会显著增加实现复杂度，允许将其降级为只读记录或不迁移，但不得破坏新版本权威状态的一致性，也不得伪装为已成功恢复。

### UI-01 成员管理入口

- **状态**：已确认
- “成员”是应用左侧栏的一级导航，与大厅、项目、任务和诊断并列。
- 成员管理不放入诊断/设置；它是多 Agent 产品的核心工作面，而不是系统故障配置。
- 首页已有成员卡片保留为紧凑概览，点击后进入对应成员详情，不在首页内嵌完整编辑表单。
- 诊断页继续负责安装探测详情、Runtime 健康、日志和故障排查，不承担成员身份与默认模型编辑。

```text
大厅
项目
任务
成员
诊断
```

### UI-02 成员页与 Camp 成员关系的边界

- **状态**：已确认
- 全局成员页只管理 `AgentProfile` 的身份、角色、指令、状态和默认 Runtime 配置。
- 把成员加入或移出 Camp、设置 Default Lead 以及配置 Camp 内权限，继续由对应 Camp 页面管理。
- 成员详情可以只读展示该成员已加入的 Camp，并提供跳转，但不能在全局成员页直接修改 `CampMember`。
- Camp 页面可以提供“新增成员并加入当前 Camp”的组合流程；其结果仍是分别创建 `AgentProfile` 与 `CampMember`，不能合并两者。

### UI-03 共享 Runtime 安装的管理入口

- **状态**：已确认
- 成员页只选择一个已有 `AdapterInstallation`、模型与结构化参数，并展示该安装的简要健康状态。
- “设置与诊断”增加“本机 Runtime”区域，统一负责自动发现、刷新、添加非标准路径、版本与认证状态、能力目录、登录入口及引用成员查询。
- 成员页提供“管理本机 Runtime…”跳转，但不能在成员表单内直接修改共享安装的路径、认证作用域或生命周期。
- 对共享安装的变更必须展示受影响成员；被成员引用或仍有活动 Run/Host 的安装不能被直接遗忘。

### UI-04 Conversation Override 的版本范围

- **状态**：已确认
- v0.03 只实现成员级默认 Runtime 配置，不提供 Camp/Conversation 级 Runtime Override 编辑界面。
- 所有未显式覆盖的现有 Conversation 对未来新 Run 实时继承成员默认值。
- 数据模型和有效配置解析保留 Conversation 可选 Override 边界，但不得因为内部字段存在就在 UI 中暴露半成品入口。
- 当前数据库中的 `provider_override` / `model_override` 默认均为空；迁移时不得把继承值复制成显式 Override。
- 未来出现同一成员需要在不同 Camp 使用不同 Runtime 的真实需求时，再设计 Override 的展示、重置与 Native Session 换绑交互。

## 已验证的本机集成事实

| Runtime | 本机版本 | 可用集成面 | 模型发现现状 |
|---|---:|---|---|
| Codex CLI | 0.144.6 | App Server / 双向 JSON-RPC | `model/list` 返回结构化模型、默认值与 reasoning effort |
| OpenCode CLI | 1.18.0 | ACP / nd-JSON | `opencode models` 返回本机配置可用模型 |
| GitHub Copilot CLI | 1.0.73 | ACP（Public Preview） | 支持指定 model/effort；账户级动态目录仍待验证 |
| Antigravity CLI | 1.1.4 | CLI/TUI 进程接口 | `agy models` 可列出模型；支持 `--continue` 与 `--conversation`，尚未发现正式宿主协议 |

以上版本只是本次能力探测结果，不构成 Lumen 对 CLI 版本的固定依赖。实现必须在运行时探测安装、版本与能力，不能按该表硬编码功能。

## 设计约束

- 领域侧统一接口继续使用 `AgentRuntimeAdapter`。
- 不假定四种 Runtime 拥有相同协议、模型目录、会话恢复或审批能力。
- 模型和参数必须来自当前安装的能力探测；无法可靠发现时允许使用 Runtime 默认值，不伪造完整目录。
- v0.03 架构访谈已经收口；实现必须按已确认边界和 [实施计划](implementation-plan.md) 分阶段推进，发现新产品决策时再暂停实施并补充本文。
