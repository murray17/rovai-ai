---
document_type: version-decisions
version: v1.21
lifecycle: historical
last_updated: 2026-08-21
---

# v1.21 决策记录

本文件解释普通用户自动化的产品 seam 与 Diagnostic Trial 的权威边界；当前字段和行为由 Architecture 与
Contract 直接拥有。

<a id="v1-21-d01"></a>

## V1.21-D01：一个 binary 保留两个 namespace，User Automation 由 Electron Main 独占

### 背景

Computer Use 可以操作 Camp，但不适合作为可重复 Runtime 诊断的唯一入口。直接复用 `rovai send` 的 Agent
transport 会把 process-private Run lease 提升为普通用户 credential；另起 `rovai-app` binary/daemon 则增加安装、
发现、生命周期和“该用哪个命令”的负担。Core 自己拥有第二个 socket 也无法自然执行 window navigation。

### 决定

安装包继续只有一个 `rovai`，已有命令走 Agent CLI transport，新 `rovai app ...` 走独立 User Automation
transport。Electron Main 独占 endpoint、credential、closed dispatcher 与 Renderer navigation；Core 继续只拥有
领域方法和 read model。V1 要求 Desktop 已运行，绝不隐式启动。

### 后果

- 普通用户只有一个安装入口，但两类 principal、credential 和能力目录保持结构性隔离；
- 自动化与 Desktop 生命周期一致，Camp open 可以复用真实 window/Renderer activation；
- Desktop 未运行是显式可预测错误；批处理方需自行决定何时启动 App；
- 新 operation 必须显式进入 dispatcher 和合同，不能借 generic invoke 越过 API review。

### 被拒绝方案

- 两个 binary：权限边界直观，但给用户制造不必要的安装和命令选择；
- 独立 automation daemon：产生第二生命周期、credential owner 和 Core 协调者；
- 复用 Agent CLI endpoint：把短期 Run lease 与普通用户长期能力混为一体；
- CLI 自动启动 Desktop：让状态检查和 mutation 产生隐藏的 GUI/进程副作用。

### 当前权威影响

- [User Automation v1](../../contracts/user-automation-v1.md)
- [User Automation Architecture](../../architecture/user-automation.md)
- [Built-in 运输不变量](../../architecture/foundational-invariants.md#skills-builtin-transport)

<a id="v1-21-d02"></a>

## V1.21-D02：Trial 由 CLI 编排，Core 只提供正式 mutation、预算、事实和安全诊断投影

### 背景

一次 Runtime 排障需要创建隔离 Camp、发送任务、等待 Run 并导出证据，但这不具备正式 Benchmark 所要求的
case protocol、replica、judge、comparison 和 admission。若在 Core 建 Trial entity，会过早固化评测领域；若
CLI 导出 raw Runtime payload/config，则诊断便利会扩大秘密、环境和 Authority path 的披露面。仅依赖一条
Evidence cursor 也不能可靠判断领域终态。

### 决定

Trial 是 CLI-owned durable workflow：第一次 mutation 前落 journal，创建单成员 Camp，只接受一个 root Run，
冻结 `maxAgentRunResponsibilities=1`、`maxAcceptedA2a=0` 与 elapsed timeout，并以 global domain sequence 和
Run-local evidence sequence 双 cursor 观察。终态只读 AgentRun。Core 新增 allowlist diagnostic projection；
公共输出只来自正式 CampMessage，raw Runtime final output 永不作为替代。bundle 明示
`formalQualification: false`。

### 后果

- 诊断闭环可重复、可恢复且复用真实产品执行路径，不污染 Core 领域模型；
- CLI crash/断连后可通过 journal 与稳定 ID 复核，不盲目重发 mutation；
- 导出能够比较冻结配置和公开结果，但不能访问秘密、原始上下文或未发布 Runtime output；
- Trial 结果不能自动晋升为 Benchmark 或 Runtime 资格，正式评测仍走既有协议。

### 被拒绝方案

- Core Trial/Benchmark entity：在没有正式评测语义时制造长期迁移和状态机成本；
- 导出 raw effective config/context/final output：扩大凭据、环境、路径和私有结果泄露；
- 用 Evidence terminal 或进程退出推断 Run terminal：混淆观察记录与领域权威；
- 接受多个 root AgentRun：让一个 Trial 的目标 Runtime 与结果身份不再唯一；
- 兼容非空 `pendingExecution`：V1 无法解释未来执行身份和 settlement，必须升级合同。

### 当前权威影响

- [User Automation v1](../../contracts/user-automation-v1.md)
- [User Automation Architecture](../../architecture/user-automation.md)
- [Evidence 不变量](../../architecture/foundational-invariants.md#evidence-usage)
- [Qualification/Benchmark 不变量](../../architecture/foundational-invariants.md#qualification-evidence)

<a id="v1-21-d03"></a>

## V1.21-D03：同一 binary 的能力隔离由 Managed Process OS policy 强制，而不是同 UID 文件权限

### 背景

User Automation context 的 `0700/0600` 能阻止其他 OS 用户，却不能阻止以同一用户运行的 Agent Runtime。
Runtime 也能找到安装包内同一枚 `rovai` binary；仅靠隐藏 help、检查 Run 环境变量或从 PATH 删除入口，都会被
绝对路径、环境清除或后代进程绕过。拆分 binary 仍不能解决同 UID credential 文件可读性。

### 决定

macOS Core 初始化一个实例级 protected tree，并要求所有 Managed Process purpose——Probe、Host、one-shot 及其
后代——继承对完整 `automation-v1` tree 的 OS 级 read/write deny。无法建立 sandbox 时 Runtime launch 在输入
投递前 fail closed。`rovai` 在受管 Run 环境隐藏并拒绝 `app` namespace，但该检查只作纵深防御；普通用户自己
启动的终端进程仍保留 User Automation 能力。

### 后果

- Runtime 即使知道绝对 CLI/context 路径，也不能读取 credential 或连接 User Automation；
- 所有 Adapter 通过一个 Managed Process seam 获得一致保护，新增 Runtime 不需要复制安全逻辑；
- macOS sandbox facility 成为 Runtime launch 前置条件，但不是 Desktop/Core 自身的启动前置条件；
- 用户级 Automation 仍是同 UID 本机能力，不被误写成系统级多 principal 服务。

### 被拒绝方案

- 只依赖 `0600`：同 UID Runtime 可读；
- 只检查环境变量或 PATH：Runtime 可清除环境并使用绝对路径；
- 拆分 `rovai-app` binary：改善命令外观但不保护 credential 文件；
- 为每个 Adapter 单独加 deny：容易遗漏 Probe、后代或新 Adapter，不能形成统一 launch invariant。

### 当前权威影响

- [User Automation v1](../../contracts/user-automation-v1.md)
- [User Automation Architecture](../../architecture/user-automation.md)
- [Managed Runtime Process v1](../../contracts/managed-runtime-process-v1.md)
- [User Automation 不变量](../../architecture/foundational-invariants.md#user-automation-trial)

<a id="v1-21-d04"></a>

## V1.21-D04：Automation Camp send 是一个 Core Domain Command，不借用用户 Composer

### 背景

由 Electron Main 依次读取草稿、保存临时 mention/body、再调用正式 send，会把一个公共 mutation 拆成三个 Core
请求。若最后一步断连或失败，重试可能遇到残留草稿；同时 Automation 会覆盖用户正在编辑的 Composer，且一个
`commandId` 无法原子覆盖全部效果。即便把临时草稿藏进同一数据库事务，也会让独立 Automation API 继续耦合
Renderer Composer authority。

### 决定

Main 对 `camp.send` 只调用一次 `userAutomation.camp.send`。Core 使用一个 User Actor Domain Command transaction
直接物化显式成员 mention、CampMessage、可选 CampTurn 与 AgentRun，复用正式准入、预算和 idempotency
gateway，但不读取、创建、更新或消费 `camp_composer_draft`/prepared attachments。相同 command/payload 重放原
结果；payload 冲突继续由 Domain Command gateway 拒绝。

### 后果

- CLI 的一个 mutation 对应一个可重放 receipt，不存在跨请求半完成状态；
- Automation 与用户 Composer 可并存，成功、拒绝、错误和重放都保留草稿原样；
- Automation V1 明确不携带 Composer attachment/reply/continuation 语义；未来需要时必须扩展自己的 command
  contract，而不是暗中读取 Renderer state；
- Message/Turn/Run 的正式领域规则仍只有 Core 一份。

### 被拒绝方案

- Main get/save/send choreography：非原子且会遗留/覆盖草稿；
- 事务内插入 reserved staging draft 再删除：避免持久残留，但仍耦合 Composer 表、revision 与 attachment cleanup；
- 直接由 Main 写 SQLite 或调用 Runtime：绕过领域授权、预算、幂等和执行权威。

### 当前权威影响

- [User Automation v1](../../contracts/user-automation-v1.md)
- [User Automation Architecture](../../architecture/user-automation.md)
- [User Automation 不变量](../../architecture/foundational-invariants.md#user-automation-trial)
